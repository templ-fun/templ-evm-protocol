import { getAddress } from 'ethers';
import { Client as NodeXmtpClient, generateInboxId, getInboxIdForIdentifier } from '@xmtp/node-sdk';
import { syncXMTP } from '../../../shared/xmtp.js';
import { waitForInboxReady } from '../xmtp/index.js';
import {
  resolveXmtpEnv,
  isFastEnv,
  allowDeterministicInbox,
  shouldVerifyContracts
} from '../xmtp/options.js';
import { ensureContractDeployed } from './contractValidation.js';
import { fetchTemplMetadata } from './templMetadata.js';

function templError(message, statusCode) {
  return Object.assign(new Error(message), { statusCode });
}

function normaliseAddress(value, field) {
  if (!value || typeof value !== 'string') {
    throw templError(`Missing ${field}`, 400);
  }
  try {
    return getAddress(value).toLowerCase();
  } catch {
    throw templError(`Invalid ${field}`, 400);
  }
}

function normaliseHex(value) {
  return String(value || '').replace(/^0x/i, '').toLowerCase();
}

function canonicalInboxId(value) {
  const norm = normaliseHex(value);
  return norm ? `0x${norm}` : null;
}

function parseProvidedInboxId(value) {
  try {
    const raw = String(value || '').trim();
    if (!raw) return null;
    if (/^[0-9a-fA-F]+$/i.test(raw)) {
      return canonicalInboxId(raw);
    }
  } catch {/* ignore */}
  return null;
}

function buildLinks(contract) {
  const baseUrl = typeof process.env.APP_BASE_URL === 'string' && process.env.APP_BASE_URL.trim().length
    ? process.env.APP_BASE_URL.trim().replace(/\/$/, '')
    : null;
  if (!baseUrl) return {};
  return {
    templ: `${baseUrl}/templs/${contract}`,
    join: `${baseUrl}/templs/join?address=${contract}`,
    chat: `${baseUrl}/templs/${contract}/chat`
  };
}

async function hydrateGroup(record, { ensureGroup, xmtp, logger }) {
  if (!record) return null;
  if (record.group && typeof record.group.send === 'function') {
    return record.group;
  }
  let hydrated = null;
  if (ensureGroup) {
    try {
      hydrated = await ensureGroup(record);
    } catch (err) {
      logger?.warn?.({ err: String(err?.message || err) }, 'ensureGroup execution failed');
    }
  }
  if (!hydrated && record.groupId && xmtp?.conversations?.getConversationById) {
    try {
      hydrated = await xmtp.conversations.getConversationById(record.groupId);
    } catch (err) {
      logger?.warn?.({ err: String(err?.message || err) }, 'Hydrate via getConversationById failed');
    }
  }
  if (hydrated) {
    record.group = hydrated;
  }
  return hydrated;
}

async function waitForInboxId({ identifier, xmtp, allowDeterministic, providedInboxId, logger }) {
  const envOpt = resolveXmtpEnv();
  const fast = isFastEnv();
  let tries = fast ? 8 : 180;
  const delayMs = envOpt === 'local' ? 200 : fast ? 150 : 1000;
  for (let i = 0; i < tries; i++) {
    try {
      if (typeof xmtp?.findInboxIdByIdentifier === 'function') {
        const local = await xmtp.findInboxIdByIdentifier(identifier);
        if (local) return canonicalInboxId(local);
      }
    } catch {/* ignore */}
    try {
      const found = await getInboxIdForIdentifier(identifier, envOpt);
      if (found) return canonicalInboxId(found);
    } catch {/* ignore */}
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  if (allowDeterministic && providedInboxId) {
    return canonicalInboxId(providedInboxId);
  }
  if (allowDeterministic) {
    try {
      return canonicalInboxId(generateInboxId(identifier));
    } catch (err) {
      logger?.warn?.({ err: String(err?.message || err) }, 'Deterministic inbox generation failed during join');
    }
  }
  return null;
}

async function ensureInstallationsReady({ inboxId, xmtp, logger }) {
  if (!xmtp || !inboxId) return;
  const envOpt = resolveXmtpEnv();
  const isLocal = envOpt === 'local';
  const max = isLocal ? 40 : 60;
  const delay = isLocal ? 150 : 500;
  let candidateInstallationIds = [];
  for (let i = 0; i < max; i++) {
    try {
      if (typeof NodeXmtpClient.inboxStateFromInboxIds === 'function') {
        const states = await NodeXmtpClient.inboxStateFromInboxIds([inboxId], envOpt);
        const state = Array.isArray(states) && states[0] ? states[0] : null;
        candidateInstallationIds = Array.isArray(state?.installations)
          ? state.installations.map((inst) => String(inst?.id || '')).filter(Boolean)
          : [];
        if (candidateInstallationIds.length) break;
      }
    } catch {/* ignore */}
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  if (!candidateInstallationIds.length || typeof xmtp?.getKeyPackageStatusesForInstallationIds !== 'function') {
    logger?.debug?.({ inboxId, candidateInstallationIds }, 'Installation identifiers not ready');
    return;
  }
  for (let i = 0; i < Math.min(max, 60); i++) {
    try {
      const statusMap = await xmtp.getKeyPackageStatusesForInstallationIds(candidateInstallationIds);
      const ids = Object.keys(statusMap || {});
      const ready = ids.some((id) => {
        const status = statusMap[id];
        if (!status) return false;
        const notAfter = /** @type {any} */ (status).lifetime?.notAfter;
        const notBefore = /** @type {any} */ (status).lifetime?.notBefore;
        if (typeof notAfter === 'bigint' || typeof notAfter === 'number') {
          const now = BigInt(Math.floor(Date.now() / 1000));
          const na = BigInt(notAfter);
          const nb = notBefore != null ? BigInt(notBefore) : now - 1n;
          return nb <= now && now < na;
        }
        return true;
      });
      if (ready) break;
    } catch {/* ignore */}
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

async function addMemberToGroup({ group, inboxId, memberIdentifier }) {
  if (!group) {
    throw templError('Group not ready yet; retry shortly', 503);
  }
  try {
    if (typeof group.addMembersByInboxId === 'function') {
      await group.addMembersByInboxId([inboxId]);
      return;
    }
    if (typeof group.addMembersByIdentifiers === 'function') {
      await group.addMembersByIdentifiers([memberIdentifier]);
      return;
    }
    if (typeof group.addMembers === 'function') {
      await group.addMembers([{ inboxId, identifier: memberIdentifier.identifier }]);
      return;
    }
    throw new Error('XMTP group does not support adding members');
  } catch (err) {
    if (!String(err?.message || '').includes('succeeded')) {
      throw err;
    }
  }
}

function trackMember(record, inboxId) {
  try {
    if (!record.memberSet || !(record.memberSet instanceof Set)) {
      record.memberSet = new Set();
    }
    record.memberSet.add(normaliseHex(inboxId));
  } catch {/* ignore */}
}

async function ensureMemberInGroup({ group, inboxId, record, xmtp }) {
  const target = normaliseHex(inboxId);
  if (!group) return;
  const envOpt = resolveXmtpEnv();
  const fast = isFastEnv();
  const max = fast ? 3 : envOpt === 'local' ? 30 : 60;
  const delay = fast ? 100 : envOpt === 'local' ? 150 : 500;

  const hasMember = async () => {
    if (typeof group.members?.list === 'function') {
      try {
        const members = await group.members.list();
        if (Array.isArray(members)) {
          const exists = members.some((member) => normaliseHex(member?.inboxId) === target);
          if (exists) return true;
        }
      } catch {/* ignore */}
    }
    if (record?.memberSet instanceof Set && record.memberSet.has(target)) {
      return true;
    }
    return false;
  };

  if (await hasMember()) return;

  for (let i = 0; i < max; i += 1) {
    try { await syncXMTP(xmtp); } catch {/* ignore */}
    try { await group?.sync?.(); } catch {/* ignore */}
    if (await hasMember()) return;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  throw templError('Member not yet visible in group; retry shortly', 503);
}

async function syncAndWarm({ group, xmtp, contractAddress, memberAddress }) {
  try {
    await syncXMTP(xmtp);
    if (group && typeof group.send === 'function') {
      await group.send(JSON.stringify({
        type: 'member-joined',
        member: memberAddress,
        contract: contractAddress
      }));
    }
  } catch {/* ignore */}
}

export async function joinTempl(body, context) {
  const { contractAddress, memberAddress, inboxId: rawInboxId } = body;
  const providedInboxId = parseProvidedInboxId(rawInboxId);
  const {
    hasJoined,
    templs,
    logger,
    xmtp,
    ensureGroup,
    provider
  } = context;

  const contract = normaliseAddress(contractAddress, 'contractAddress');
  const member = normaliseAddress(memberAddress, 'memberAddress');

  const record = templs.get(contract);
  if (!record) {
    throw templError('Templ not registered', 404);
  }

  if (!hasJoined || typeof hasJoined !== 'function') {
    throw templError('Membership verification unavailable', 500);
  }

  try {
    const joined = await hasJoined(contract, member);
    if (!joined) {
      throw templError('Membership not found', 403);
    }
  } catch (err) {
    if (err && typeof err === 'object' && 'statusCode' in err) {
      throw /** @type {Error & { statusCode?: number }} */ (err);
    }
    const errMessage = err instanceof Error ? err.message : String(err ?? 'Unknown error');
    logger?.warn?.({ err: errMessage, contract, member }, 'hasJoined check failed');
    throw templError('Unable to verify membership', 502);
  }

  if (shouldVerifyContracts()) {
    await ensureContractDeployed({ provider, contractAddress: contract, chainId: Number(body?.chainId) });
  }

  if (provider) {
    try {
      const metadata = await fetchTemplMetadata({ provider, contractAddress: contract, logger });
      if (metadata.priest) {
        record.priest = metadata.priest;
      }
      if (metadata.templHomeLink !== null && metadata.templHomeLink !== undefined) {
        record.templHomeLink = metadata.templHomeLink;
      }
    } catch (err) {
      logger?.warn?.({ err: String(err?.message || err), contract }, 'templ metadata fetch failed during join');
    }
  }

  const buildTemplPayload = () => ({
    contract,
    telegramChatId: record.telegramChatId ?? null,
    priest: record.priest ?? null,
    templHomeLink: record.templHomeLink ?? ''
  });

  if (!xmtp) {
    return {
      groupId: null,
      member: { address: member, isMember: true },
      templ: buildTemplPayload(),
      links: buildLinks(contract)
    };
  }

  record.groupId = record.groupId || record.xmtpGroupId || null;
  const group = await hydrateGroup(record, { ensureGroup, xmtp, logger });
  if (!group || !record.groupId) {
    throw templError('Group not ready yet; retry shortly', 503);
  }

  const memberIdentifier = { identifier: member.toLowerCase(), identifierKind: 0 };
  const allowDeterministic = allowDeterministicInbox();
  const resolvedInboxId = await waitForInboxId({
    identifier: memberIdentifier,
    xmtp,
    allowDeterministic,
    providedInboxId,
    logger
  });
  if (!resolvedInboxId) {
    throw templError('Member identity not registered yet; retry shortly', 503);
  }

  await ensureInstallationsReady({ inboxId: resolvedInboxId, xmtp, logger });
  const readyTries = isFastEnv() ? 2 : 60;
  const ready = await waitForInboxReady(resolvedInboxId, readyTries);
  logger?.info?.({ inboxId: resolvedInboxId, ready }, 'Member inbox readiness before add');

  await addMemberToGroup({ group, inboxId: resolvedInboxId, memberIdentifier });
  trackMember(record, resolvedInboxId);

  try {
    await syncXMTP(xmtp);
    if (group?.sync) await group.sync();
  } catch (err) {
    logger?.warn?.({ err: err?.message || err }, 'XMTP sync after join failed');
  }

  await ensureMemberInGroup({ group, inboxId: resolvedInboxId, record, xmtp });
  await syncAndWarm({ group, xmtp, contractAddress: contract, memberAddress: member });

  record.group = group;
  record.groupId = group.id;
  record.xmtpGroupId = group.id;
  templs.set(contract, record);

  return {
    groupId: group.id,
    member: {
      address: member,
      isMember: true
    },
    templ: buildTemplPayload(),
    links: buildLinks(contract)
  };
}
