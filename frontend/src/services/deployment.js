// @ts-check
import { BACKEND_URL } from '../config.js';
import { buildCreateTypedData } from '../../../shared/signing.js';
import { waitForConversation } from '../../../shared/xmtp.js';
import { addToTestRegistry, dlog, isDebugEnabled } from './utils.js';
import { postJson } from './http.js';

const TOTAL_PERCENT = 100n;

export function deriveDefaultSplit(protocolPercentInput) {
  const protocol = BigInt(protocolPercentInput ?? 0n);
  if (protocol < 0n || protocol > TOTAL_PERCENT) {
    throw new RangeError(`Invalid protocol percent: ${protocol.toString()}`);
  }
  const remaining = TOTAL_PERCENT - protocol;
  const baseShare = remaining / 3n;
  const remainder = remaining % 3n;

  let burn = baseShare;
  let treasury = baseShare;
  let member = baseShare;

  if (remainder > 0n) {
    burn += 1n;
    if (remainder > 1n) {
      treasury += 1n;
    }
  }

  return { burn, treasury, member };
}

/**
 * Deploy a new TEMPL contract and register a group with the backend.
 * @param {import('../flows.types').DeployRequest} params
 * @returns {Promise<import('../flows.types').DeployResponse>}
 */
export async function deployTempl({
  ethers,
  xmtp,
  signer,
  walletAddress,
  tokenAddress,
  entryFee,
  burnPercent,
  treasuryPercent,
  memberPoolPercent,
  quorumPercent,
  executionDelaySeconds,
  burnAddress,
  factoryAddress,
  factoryArtifact,
  templArtifact,
  backendUrl = BACKEND_URL,
  txOptions = {}
}) {
  if (!ethers || !signer || !walletAddress || !tokenAddress || !templArtifact) {
    throw new Error('Missing required deployTempl parameters');
  }
  if (!factoryAddress || !factoryArtifact) {
    throw new Error('TemplFactory configuration missing');
  }
  const factory = new ethers.Contract(factoryAddress, factoryArtifact.abi, signer);
  let protocolFeeRecipient;
  let protocolPercentRaw;
  try {
    [protocolFeeRecipient, protocolPercentRaw] = await Promise.all([
      factory.protocolFeeRecipient(),
      factory.protocolPercent?.() ?? factory.protocolBP()
    ]);
  } catch (err) {
    throw new Error(err?.message || 'Unable to read factory configuration');
  }
  if (!protocolFeeRecipient || protocolFeeRecipient === ethers.ZeroAddress) {
    throw new Error('Factory protocol fee recipient not configured');
  }
  const protocol = BigInt(protocolPercentRaw ?? 0n);
  const defaults = deriveDefaultSplit(protocol);
  const burn = BigInt(burnPercent ?? defaults.burn);
  const treasury = BigInt(treasuryPercent ?? defaults.treasury);
  const member = BigInt(memberPoolPercent ?? defaults.member);
  const totalSplit = burn + treasury + member + protocol;
  if (totalSplit !== 100n) {
    throw new Error(`Fee split must equal 100, received ${totalSplit}`);
  }
  let normalizedEntryFee;
  try {
    normalizedEntryFee = BigInt(entryFee);
  } catch {
    throw new Error('Invalid entry fee');
  }
  const normalizedToken = String(tokenAddress);
  const config = {
    priest: walletAddress,
    token: normalizedToken,
    entryFee: normalizedEntryFee,
    burnPercent: Number(burn),
    treasuryPercent: Number(treasury),
    memberPoolPercent: Number(member),
    burnAddress: burnAddress && ethers.isAddress?.(burnAddress)
      ? burnAddress
      : (ethers.ZeroAddress ?? '0x0000000000000000000000000000000000000000')
  };
  if (quorumPercent !== undefined && quorumPercent !== null) {
    config.quorumPercent = Number(quorumPercent);
  }
  if (executionDelaySeconds !== undefined && executionDelaySeconds !== null) {
    config.executionDelaySeconds = Number(executionDelaySeconds);
  }

  const zeroAddress = ethers.ZeroAddress ?? '0x0000000000000000000000000000000000000000';
  const defaultsRequested =
    burn === defaults.burn &&
    treasury === defaults.treasury &&
    member === defaults.member &&
    config.priest === walletAddress &&
    config.burnAddress === zeroAddress &&
    config.quorumPercent === undefined &&
    config.executionDelaySeconds === undefined;

  let contractAddress;
  if (defaultsRequested) {
    contractAddress = await factory.createTempl.staticCall(normalizedToken, normalizedEntryFee);
    const tx = await factory.createTempl(normalizedToken, normalizedEntryFee, txOptions);
    await tx.wait();
  } else {
    const templAddress = await factory.createTemplWithConfig.staticCall(config);
    const tx = await factory.createTemplWithConfig(config, txOptions);
    await tx.wait();
    contractAddress = templAddress;
  }
  // Record immediately for tests to discover, even before backend registration
  addToTestRegistry(contractAddress);
  const network = await signer.provider?.getNetwork?.();
  const chainId = Number(network?.chainId || 1337);
  const createTyped = buildCreateTypedData({ chainId, contractAddress: contractAddress.toLowerCase() });
  const signature = await signer.signTypedData(createTyped.domain, createTyped.types, createTyped.message);

  // Get the priest's inbox ID from XMTP client if available
  const priestInboxId = xmtp?.inboxId;
  if (!priestInboxId) {
    dlog('XMTP not ready at deploy; backend will resolve inboxId from network');
  }

  try { console.log('[deployTempl] calling /templs'); } catch {}
  const registerPayload = {
    contractAddress,
    priestAddress: walletAddress,
    signature,
    chainId,
    nonce: createTyped.message.nonce,
    issuedAt: createTyped.message.issuedAt,
    expiry: createTyped.message.expiry
  };
  dlog('deployTempl: sending register payload', registerPayload);
  const res = await postJson(`${backendUrl}/templs`, registerPayload);
  dlog('deployTempl: /templs status', res.status);
  try { console.log('[deployTempl] /templs status', res.status); } catch {}
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `Templ registration failed: ${res.status} ${res.statusText} ${body}`.trim()
    );
  }
  const data = await res.json();
  dlog('deployTempl: /templs response', data);
  if (!data || typeof data.groupId !== 'string' || data.groupId.length === 0) {
    throw new Error('Invalid /templs response: missing groupId');
  }
  if (isDebugEnabled()) {
    try {
      const templsDebug = await fetch(`${backendUrl}/templs?include=groupId`).then((r) => r.json());
      dlog('deployTempl: templs listing after registration', templsDebug);
    } catch (err) {
      dlog('deployTempl: templs listing fetch failed', err?.message || err);
    }
  }
  if (isDebugEnabled()) {
    try {
      const debugGroup = await fetch(`${backendUrl}/debug/group?contractAddress=${contractAddress}&refresh=1`).then((r) => r.json());
      dlog('deployTempl: debug group snapshot', debugGroup);
    } catch (err) {
      dlog('deployTempl: debug group fetch failed', err?.message || err);
    }
  }
  const groupId = String(data.groupId);
  // In e2e fast mode, return immediately; conversation discovery can happen later
  try {
    // @ts-ignore - vite injects env on import.meta
    if (import.meta?.env?.VITE_E2E_DEBUG === '1') {
      return { contractAddress, group: null, groupId };
    }
  } catch {}

  // If XMTP isn’t ready yet on the client, skip fetching the group for now.
  if (!xmtp) {
    return { contractAddress, group: null, groupId };
  }

  dlog('Syncing conversations to find group', groupId);
  const isFast = (() => { try { return import.meta?.env?.VITE_E2E_DEBUG === '1'; } catch { return false; } })();
  // Be more generous in e2e to reduce flakiness on prod XMTP
  const group = await waitForConversation({ xmtp, groupId, retries: isFast ? 12 : 6, delayMs: isFast ? 500 : 1000 });
  if (!group) {
    const resolveConversation = async () => {
      const fallback = await waitForConversation({ xmtp, groupId, retries: isFast ? 60 : 120, delayMs: isFast ? 500 : 1000 });
      if (!fallback) return null;
      return fallback;
    };
    const lazyGroup = {
      id: groupId,
      async send(content) {
        const resolved = await resolveConversation();
        if (!resolved?.send) {
          throw new Error('Group not yet available to send messages');
        }
        lazyGroup.send = resolved.send.bind(resolved);
        if (typeof resolved.sync === 'function') {
          lazyGroup.sync = resolved.sync.bind(resolved);
        }
        if (typeof resolved.updateName === 'function') {
          lazyGroup.updateName = resolved.updateName.bind(resolved);
        }
        if (typeof resolved.updateDescription === 'function') {
          lazyGroup.updateDescription = resolved.updateDescription.bind(resolved);
        }
        if (resolved.members !== undefined) {
          lazyGroup.members = resolved.members;
        }
        return lazyGroup.send(content);
      }
    };
    return { contractAddress, group: lazyGroup, groupId };
  }
  return { contractAddress, group, groupId };
}

export async function registerTemplBackend({ ethers, signer, walletAddress, templAddress, backendUrl = BACKEND_URL }) {
  let priest = walletAddress;
  if (!priest) {
    try { priest = await signer.getAddress(); } catch { priest = undefined; }
  }
  if (!priest) {
    throw new Error('registerTemplBackend requires priest wallet address');
  }
  const normalizedPriest = (() => {
    try { return ethers.getAddress(priest); }
    catch { return String(priest); }
  })();
  const network = await signer.provider?.getNetwork?.();
  const chainId = Number(network?.chainId || 1337);
  const createTyped = buildCreateTypedData({ chainId, contractAddress: templAddress.toLowerCase() });
  const signature = await signer.signTypedData(createTyped.domain, createTyped.types, createTyped.message);
  const payload = {
    contractAddress: templAddress,
    priestAddress: normalizedPriest,
    signature,
    chainId,
    nonce: createTyped.message.nonce,
    issuedAt: createTyped.message.issuedAt,
    expiry: createTyped.message.expiry
  };
  dlog('registerTemplBackend: payload', payload);
  const res = await fetch(`${backendUrl}/templs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  dlog('registerTemplBackend: status', res.status);
  if (res.status === 409) {
    dlog('registerTemplBackend: signature already used, retrying');
    const nextTyped = buildCreateTypedData({ chainId, contractAddress: templAddress.toLowerCase(), nonce: Date.now() });
    const nextSig = await signer.signTypedData(nextTyped.domain, nextTyped.types, nextTyped.message);
    const retryPayload = {
      contractAddress: templAddress,
      priestAddress: normalizedPriest,
      signature: nextSig,
      chainId,
      nonce: nextTyped.message.nonce,
      issuedAt: nextTyped.message.issuedAt,
      expiry: nextTyped.message.expiry
    };
    const retry = await postJson(`${backendUrl}/templs`, retryPayload);
    dlog('registerTemplBackend: retry status', retry.status);
    if (!retry.ok && retry.status !== 409) {
      const body = await retry.text().catch(() => '');
      throw new Error(`Templ re-registration failed: ${retry.status} ${retry.statusText} ${body}`.trim());
    }
    return retry.ok;
  }
  if (!res.ok && res.status !== 409) {
    const body = await res.text().catch(() => '');
    throw new Error(`Templ registration failed: ${res.status} ${res.statusText} ${body}`.trim());
  }
  return res.ok;
}
