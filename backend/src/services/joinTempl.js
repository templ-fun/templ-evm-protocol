import { Client as NodeXmtpClient, generateInboxId, getInboxIdForIdentifier } from '@xmtp/node-sdk';
import { waitForInboxReady, XMTP_ENV } from '../xmtp/index.js';
import { syncXMTP } from '../../../shared/xmtp.js';

/** @type {Array<'local'|'dev'|'production'>} */
const XMTP_ENV_VALUES = ['local', 'dev', 'production'];

/**
 * @param {string} value
 * @returns {value is 'local'|'dev'|'production'}
 */
function isValidEnv(value) {
  return XMTP_ENV_VALUES.some((option) => option === value);
}

/**
 * @returns {'local'|'dev'|'production'}
 */
function resolveXmtpEnv() {
  const env = String(XMTP_ENV || 'dev');
  if (isValidEnv(env)) {
    return env;
  }
  return 'dev';
}

function isFastEnv() {
  return process.env.NODE_ENV === 'test' || process.env.DISABLE_XMTP_WAIT === '1';
}

function allowDeterministicInbox() {
  return resolveXmtpEnv() === 'local' || process.env.NODE_ENV === 'test';
}

function requireVerification() {
  return process.env.REQUIRE_CONTRACT_VERIFY === '1' || process.env.NODE_ENV === 'production';
}

async function verifyContract({ contractAddress, provider, chainId }) {
  if (!requireVerification()) return;
  if (!provider) {
    throw Object.assign(new Error('Verification required but no provider configured'), { statusCode: 500 });
  }
  try {
    const net = await provider.getNetwork();
    const expectedChainId = Number(net.chainId);
    if (Number.isFinite(chainId) && chainId !== expectedChainId) {
      throw Object.assign(new Error('ChainId mismatch'), { statusCode: 400 });
    }
  } catch {/* ignore */}
  try {
    const code = await provider.getCode(contractAddress);
    if (!code || code === '0x') {
      throw Object.assign(new Error('Not a contract'), { statusCode: 400 });
    }
  } catch {
    throw Object.assign(new Error('Unable to verify contract'), { statusCode: 400 });
  }
}

async function ensureGroupHandle({ record, xmtp, ensureGroup, logger }) {
  try {
    if (!record.group && typeof ensureGroup === 'function') {
      record.group = await ensureGroup(record);
    }
    if (!record.group && record.groupId && xmtp?.conversations?.getConversationById) {
      const maybe = await xmtp.conversations.getConversationById(record.groupId);
      if (maybe) {
        record.group = maybe;
      }
    }
  } catch (err) {
    logger?.warn?.({ err: err?.message || err }, 'Rehydrate group failed');
  }
  return record.group;
}

function normaliseHex(value) {
  return String(value || '').replace(/^0x/i, '').toLowerCase();
}

function parseProvidedInboxId(value) {
  try {
    const raw = String(value || '').trim();
    if (!raw) return null;
    if (/^[0-9a-fA-F]+$/i.test(raw)) {
      return raw.replace(/^0x/i, '');
    }
  } catch {/* ignore */}
  return null;
}

async function waitForInboxId({ identifier, xmtp, allowDeterministic }) {
  /** @type {'local'|'dev'|'production'} */
  const envOpt = resolveXmtpEnv();
  const isTest = isFastEnv();
  let tries = isTest ? 8 : 180;
  const delayMs = envOpt === 'local' ? 200 : (isTest ? 150 : 1000);
  for (let i = 0; i < tries; i++) {
    try {
      if (typeof xmtp?.findInboxIdByIdentifier === 'function') {
        const local = await xmtp.findInboxIdByIdentifier(identifier);
        if (local) return local;
      }
    } catch {/* ignore */}
    try {
      const found = await getInboxIdForIdentifier(identifier, envOpt);
      if (found) return found;
    } catch {/* ignore */}
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  if (allowDeterministic) {
    try { return generateInboxId(identifier); } catch {/* ignore */}
  }
  return null;
}

async function ensureInstallationsReady({ inboxId, xmtp, lastJoin, logger }) {
  /** @type {'local'|'dev'|'production'} */
  const envOpt = resolveXmtpEnv();
  const isLocal = envOpt === 'local';
  const max = isLocal ? 40 : 60;
  const delay = isLocal ? 150 : 500;
  let candidateInstallationIds = [];
  let lastInboxState = null;
  for (let i = 0; i < max; i++) {
    try {
      if (typeof NodeXmtpClient.inboxStateFromInboxIds === 'function') {
        const states = await NodeXmtpClient.inboxStateFromInboxIds([inboxId], envOpt);
        const state = Array.isArray(states) && states[0] ? states[0] : null;
        lastInboxState = state;
        candidateInstallationIds = Array.isArray(state?.installations)
          ? state.installations.map((inst) => String(inst?.id || '')).filter(Boolean)
          : [];
        if (candidateInstallationIds.length) break;
      } else {
        break;
      }
    } catch {/* ignore */}
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  if (!candidateInstallationIds.length || typeof xmtp?.getKeyPackageStatusesForInstallationIds !== 'function') {
    return;
  }

  let lastStatuses = {};
  for (let i = 0; i < Math.min(max, 60); i++) {
    try {
      const statusMap = await xmtp.getKeyPackageStatusesForInstallationIds(candidateInstallationIds);
      lastStatuses = statusMap || {};
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

  try {
    lastJoin.at = Date.now();
    lastJoin.payload = lastJoin.payload || {};
    lastJoin.payload.keyPackageProbe = {
      installationIds: candidateInstallationIds,
      statuses: Object.keys(lastStatuses || {}),
    };
    lastJoin.payload.inboxStateProbe = {
      installationCount: Array.isArray(lastInboxState?.installations) ? lastInboxState.installations.length : null,
      identifierCount: Array.isArray(lastInboxState?.identifiers) ? lastInboxState.identifiers.length : null,
    };
  } catch (err) {
    logger?.warn?.({ err: err?.message || err }, 'Failed to record join probes');
  }
}

async function ensureMemberInGroup({ group, inboxId }) {
  /** @type {'local'|'dev'|'production'} */
  const env = resolveXmtpEnv();
  const isTest = isFastEnv();
  const max = isTest ? 3 : (env === 'local' ? 30 : 60);
  const delay = isTest ? 100 : (env === 'local' ? 150 : 500);
  for (let i = 0; i < max; i++) {
    try { await group?.sync?.(); } catch {/* ignore */}
    const members = Array.isArray(group?.members) ? group.members : [];
    const norm = (s) => normaliseHex(s);
    if (members.some((m) => norm(m) === norm(inboxId))) return;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

function trackMember(record, inboxId) {
  try {
    if (!record.memberSet) record.memberSet = new Set();
    record.memberSet.add(normaliseHex(inboxId));
  } catch {/* ignore */}
}

async function syncAndWarm({ group, xmtp, contractAddress, memberAddress }) {
  try {
    await syncXMTP(xmtp);
    try {
      if (group?.sync) await group.sync();
    } catch {/* ignore */}
  } catch {/* ignore */}
  try {
    if (typeof group?.send === 'function') {
      await group.send(JSON.stringify({ type: 'member-joined', address: memberAddress }));
    }
  } catch {/* ignore */}
  const META_UPDATES = process.env.XMTP_METADATA_UPDATES !== '0';
  if (!META_UPDATES) return;
  try {
    if (typeof group?.updateDescription === 'function') {
      await group.updateDescription('Member joined');
    }
  } catch (err) {
    if (!String(err?.message || '').includes('succeeded')) {/* ignore */}
  }
  try {
    if (typeof group?.updateName === 'function') {
      await group.updateName(`Templ ${contractAddress}`);
    }
  } catch (err) {
    if (!String(err?.message || '').includes('succeeded')) {/* ignore */}
  }
}

export async function joinTempl(body, context) {
  const {
    contractAddress,
    memberAddress,
    chainId,
  } = body;
  const {
    hasPurchased,
    groups,
    logger,
    lastJoin,
    provider,
    xmtp,
    ensureGroup,
  } = context;

  const record = groups.get(contractAddress.toLowerCase());
  if (!record) {
    throw Object.assign(new Error('Unknown Templ'), { statusCode: 404 });
  }

  let purchased;
  try {
    purchased = await hasPurchased(contractAddress, memberAddress);
  } catch {
    throw Object.assign(new Error('Purchase check failed'), { statusCode: 500 });
  }
  if (!purchased) {
    throw Object.assign(new Error('Access not purchased'), { statusCode: 403 });
  }

  await verifyContract({ contractAddress, provider, chainId: Number(chainId) });

  const group = await ensureGroupHandle({ record, xmtp, ensureGroup, logger });
  if (!group) {
    throw Object.assign(new Error('Group not ready yet; retry shortly'), { statusCode: 503 });
  }

  const memberIdentifier = { identifier: memberAddress.toLowerCase(), identifierKind: 0 };
  const allowDeterministic = allowDeterministicInbox();
  const providedInboxId = parseProvidedInboxId(body?.inboxId || body?.memberInboxId);
  const resolvedInboxId = await waitForInboxId({ identifier: memberIdentifier, xmtp, allowDeterministic });
  let inboxId = resolvedInboxId;
  if (!inboxId && allowDeterministic) {
    inboxId = providedInboxId || null;
  }
  if (!inboxId) {
    throw Object.assign(new Error('Member identity not registered yet; retry shortly'), { statusCode: 503 });
  }

  if (resolvedInboxId && providedInboxId && normaliseHex(resolvedInboxId) !== normaliseHex(providedInboxId)) {
    // prefer resolved value; no action needed besides logging
    logger?.info?.({ resolvedInboxId, providedInboxId }, 'Resolved inbox overrides provided value');
  }

  await ensureInstallationsReady({ inboxId, xmtp, lastJoin, logger });
  const readyTries = isFastEnv() ? 2 : 60;
  const ready = await waitForInboxReady(inboxId, readyTries);
  logger?.info?.({ inboxId, ready }, 'Member inbox readiness before add');

  const joinMeta = {
    contract: contractAddress.toLowerCase(),
    member: memberAddress.toLowerCase(),
    inboxId,
    serverInboxId: xmtp?.inboxId || null,
    groupId: group?.id || record.groupId || null,
  };
  const beforeAgg = xmtp?.debugInformation?.apiAggregateStatistics?.();
  logger?.info?.(joinMeta, 'Inviting member by inboxId');

  try {
    if (typeof group.addMembers === 'function') {
      await group.addMembers([inboxId]);
      logger?.info?.({ inboxId }, 'addMembers([inboxId]) succeeded');
    } else if (typeof group.addMembersByInboxId === 'function') {
      await group.addMembersByInboxId([inboxId]);
      logger?.info?.({ inboxId }, 'addMembersByInboxId([inboxId]) succeeded');
    } else if (typeof group.addMembersByIdentifiers === 'function') {
      await group.addMembersByIdentifiers([memberIdentifier]);
      logger?.info?.({ member: memberAddress.toLowerCase() }, 'addMembersByIdentifiers succeeded');
    } else {
      throw new Error('XMTP group does not support adding members');
    }
  } catch (err) {
    if (!String(err?.message || '').includes('succeeded')) {
      throw err;
    }
  }

  try {
    await syncXMTP(xmtp);
    try {
      if (group?.sync) await group.sync();
    } catch {/* ignore */}
  } catch (err) {
    logger?.warn?.({ err }, 'Server sync after join failed');
  }

  await ensureMemberInGroup({ group, inboxId });

  try {
    lastJoin.at = Date.now();
    lastJoin.payload = { joinMeta };
    try {
      const afterAgg = xmtp?.debugInformation?.apiAggregateStatistics?.();
      logger?.info?.({ beforeAgg, afterAgg }, 'XMTP API stats around member add');
      lastJoin.payload.afterAgg = afterAgg;
      lastJoin.payload.beforeAgg = beforeAgg;
    } catch {/* ignore */}
  } catch {/* ignore */}

  trackMember(record, inboxId);
  await syncAndWarm({ group, xmtp, contractAddress, memberAddress });
  try {
    await syncXMTP(xmtp);
    if (typeof group?.sync === 'function') {
      await group.sync();
    }
  } catch {/* ignore */}

  logger?.info?.({ contract: contractAddress, inboxId }, 'Member joined successfully');
  return { groupId: group.id };
}
