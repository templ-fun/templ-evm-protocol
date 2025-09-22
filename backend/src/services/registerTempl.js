import { ethers } from 'ethers';
import { generateInboxId, getInboxIdForIdentifier } from '@xmtp/node-sdk';
import { syncXMTP } from '../../../shared/xmtp.js';
import {
  resolveXmtpEnv,
  shouldSkipNetworkResolution,
  shouldUseEphemeralCreator,
  shouldUpdateMetadata,
  shouldVerifyContracts
} from '../xmtp/options.js';
import {
  ensureContractDeployed,
  ensurePriestMatchesOnChain
} from './contractValidation.js';

function normaliseInboxId(id) {
  return String(id || '').replace(/^0x/i, '');
}

async function resolvePriestInboxId({ priestIdentifier, xmtp, logger }) {
  const inboxIds = [];
  if (xmtp?.inboxId) {
    inboxIds.push(xmtp.inboxId);
  }

  const skipNetwork = shouldSkipNetworkResolution();
  const envOpt = resolveXmtpEnv();
  let priestInboxAdded = false;
  if (!skipNetwork) {
    try {
      const resolved = await getInboxIdForIdentifier(priestIdentifier, envOpt);
      if (resolved) {
        inboxIds.push(resolved);
        priestInboxAdded = true;
      }
    } catch (err) {
      logger?.warn?.({ err: String(err?.message || err) }, 'Priest inbox resolution failed');
    }
  }

  if (!priestInboxAdded) {
    try {
      const deterministic = generateInboxId(priestIdentifier);
      if (!inboxIds.some((id) => normaliseInboxId(id) === normaliseInboxId(deterministic))) {
        inboxIds.push(deterministic);
      }
    } catch (err) {
      logger?.warn?.({ err: String(err?.message || err) }, 'Deterministic inbox generation failed');
    }
  }
  return inboxIds;
}

async function createGroup({ contractAddress, inboxIds, xmtp, logger, useEphemeral, disableWait, createXmtpWithRotation }) {
  if (!inboxIds.length) {
    throw new Error('No inboxIds available for group creation');
  }
  if (!useEphemeral) {
    if (typeof xmtp?.conversations?.newGroup !== 'function') {
      throw new Error('XMTP client does not support newGroup(inboxIds)');
    }
    if (disableWait) {
      const timeoutMs = 3000;
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('newGroup timed out')), timeoutMs));
      return Promise.race([xmtp.conversations.newGroup(inboxIds), timeout]);
    }
    return xmtp.conversations.newGroup(inboxIds);
  }

  const ephWallet = ethers.Wallet.createRandom();
  const ephClient = await createXmtpWithRotation(ephWallet);
  try {
    if (typeof ephClient?.conversations?.newGroup !== 'function') {
      throw new Error('XMTP client does not support newGroup(inboxIds)');
    }
    const group = await ephClient.conversations.newGroup(inboxIds);
    if (shouldUpdateMetadata()) {
      try { await group.updateName?.(`Templ ${contractAddress}`); } catch {/* ignore */}
      try { await group.updateDescription?.('Private TEMPL group'); } catch {/* ignore */}
    }
    try {
      await syncXMTP(xmtp);
      const hydrated = await xmtp.conversations?.getConversationById?.(group.id);
      if (hydrated) {
        return hydrated;
      }
    } catch {/* ignore */}
    return group;
  } finally {
    try {
      const maybeClose = /** @type {any} */ (ephClient)?.close;
      if (typeof maybeClose === 'function') {
        await maybeClose.call(ephClient);
      }
    } catch (err) {
      logger?.warn?.({ err: String(err?.message || err) }, 'Failed to close ephemeral XMTP client');
    }
  }
}

async function findGroupByDiff({ xmtp, beforeIds, contractAddress, logger }) {
  try {
    const afterList = (await xmtp.conversations.list?.()) ?? [];
    const afterIds = afterList.map((c) => c.id);
    const diffIds = afterIds.filter((id) => !beforeIds.includes(id));
    const diffCandidates = afterList.filter((c) => diffIds.includes(c.id));
    const expectedName = `Templ ${contractAddress}`;
    let candidate = diffCandidates.find((c) => c.name === expectedName);
    if (candidate) return candidate;
    candidate = afterList.find((c) => c.name === expectedName);
    return candidate || null;
  } catch (err) {
    logger?.warn?.({ err: String(err?.message || err) }, 'Conversation diff scan failed');
    return null;
  }
}

async function warmGroup(group, contractAddress, logger) {
  try {
    if (typeof group?.send === 'function') {
      await group.send(JSON.stringify({ type: 'templ-created', contract: contractAddress }));
    }
  } catch (err) {
    logger?.warn?.({ err: String(err?.message || err) }, 'Unable to send templ-created message');
  }
}

async function finaliseRegistration({ contractAddress, priestAddress, group, groups, persist, watchContract }) {
  const record = {
    group,
    groupId: group?.id,
    priest: priestAddress.toLowerCase(),
    memberSet: new Set()
  };
  const key = contractAddress.toLowerCase();
  groups.set(key, record);
  persist(key, record);
  if (typeof watchContract === 'function') {
    watchContract(contractAddress, record);
  }
  return record;
}

function successResponse(group) {
  return { groupId: group.id };
}

export async function registerTempl(body, context) {
  const { contractAddress, priestAddress } = body;
  const { xmtp, provider, logger, groups, persist, watchContract, createXmtpWithRotation: createXmtp } = context;

  logger?.info?.({ contract: contractAddress, priest: priestAddress }, 'Received templ registration request');

  if (shouldVerifyContracts()) {
    await ensureContractDeployed({ provider, contractAddress, chainId: Number(body?.chainId) });
    await ensurePriestMatchesOnChain({ provider, contractAddress, priestAddress });
  }

  let beforeIds = [];
  try {
    await syncXMTP(xmtp);
    const beforeList = (await xmtp.conversations?.list?.()) ?? [];
    beforeIds = beforeList.map((c) => c.id);
  } catch (err) {
    logger?.warn?.({ err: String(err?.message || err) }, 'Initial XMTP sync failed');
  }

  const priestIdentifier = { identifier: priestAddress.toLowerCase(), identifierKind: 0 };
  const inboxIds = await resolvePriestInboxId({ priestIdentifier, xmtp, logger });
  const disableWait = shouldSkipNetworkResolution();
  const useEphemeral = !disableWait && shouldUseEphemeralCreator();

  let group;
  try {
    group = await createGroup({
      contractAddress,
      inboxIds,
      xmtp,
      logger,
      useEphemeral,
      disableWait,
      createXmtpWithRotation: createXmtp
    });
  } catch (err) {
    const msg = String(err?.message || '');
    logger?.warn?.({ err: msg }, 'Group creation initial attempt failed; attempting recovery');
    try { await syncXMTP(xmtp); } catch {/* ignore */}
    group = await findGroupByDiff({ xmtp, beforeIds, contractAddress, logger });
    if (!group) {
      throw err;
    }
  }

  await warmGroup(group, contractAddress, logger);

  logger?.info?.({
    contract: contractAddress.toLowerCase(),
    groupId: group.id,
    groupName: group.name
  }, 'Group created successfully');

  try {
    await syncXMTP(xmtp);
  } catch (err) {
    if (!String(err?.message || '').includes('succeeded')) {
      logger?.warn?.({ err: String(err?.message || err) }, 'XMTP sync after templ creation failed');
    } else {
      logger?.info?.({ message: err.message }, 'XMTP sync message after creation - ignoring');
    }
  }

  await finaliseRegistration({ contractAddress, priestAddress, group, groups, persist, watchContract });
  logger?.info?.({ contract: contractAddress.toLowerCase(), groupId: group.id }, 'Templ registered');

  return successResponse(group);
}
