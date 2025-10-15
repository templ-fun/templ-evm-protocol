// @ts-check
import { BACKEND_URL } from '../config.js';
import { buildCreateTypedData } from '@shared/signing.js';
import { waitForConversation } from '@shared/xmtp.js';
import { addToTestRegistry, dlog, isDebugEnabled } from './utils.js';
import { postJson } from './http.js';

const TOTAL_PERCENT_BPS = 10_000;
const PERCENT_PATTERN = /^\d+(\.\d{1,2})?$/;

function percentValueToBps(value, field) {
  const raw = value === undefined || value === null ? '' : String(value).trim();
  if (!PERCENT_PATTERN.test(raw)) {
    throw new Error(`${field} must be numeric with up to two decimal places`);
  }
  const [whole, fraction = ''] = raw.split('.');
  const wholeNum = Number(whole);
  if (!Number.isFinite(wholeNum)) {
    throw new Error(`${field} is invalid`);
  }
  const fractionDigits = (fraction + '00').slice(0, 2);
  return (wholeNum * 100) + Number(fractionDigits);
}

function formatBpsAsPercent(bps) {
  const percent = bps / 100;
  if (!Number.isFinite(percent)) return String(bps);
  const fixed = percent.toFixed(2);
  return fixed.endsWith('.00') ? fixed.slice(0, -3) : fixed.replace(/\.0$/, '');
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
  priestIsDictator,
  factoryAddress,
  factoryArtifact,
  templArtifact,
  maxMembers = 0,
  backendUrl = BACKEND_URL,
  txOptions = {},
  curveProvided = false,
  curveConfig = null,
  templHomeLink = null
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
  let protocolBps;
  try {
    if (typeof protocolPercentRaw === 'bigint') {
      protocolBps = Number(protocolPercentRaw);
    } else if (typeof protocolPercentRaw === 'number') {
      protocolBps = protocolPercentRaw;
    } else if (protocolPercentRaw && typeof protocolPercentRaw.toString === 'function') {
      protocolBps = Number(protocolPercentRaw.toString());
    } else {
      protocolBps = Number(protocolPercentRaw ?? 0);
    }
  } catch {
    protocolBps = Number(protocolPercentRaw ?? 0);
  }
  if (!Number.isFinite(protocolBps)) {
    throw new Error('Invalid protocol percent from factory');
  }
  let burnBps;
  let treasuryBps;
  let memberBps;
  try {
    burnBps = percentValueToBps(burnPercent ?? '0', 'Burn percent');
    treasuryBps = percentValueToBps(treasuryPercent ?? '0', 'Treasury percent');
    memberBps = percentValueToBps(memberPoolPercent ?? '0', 'Member pool percent');
  } catch (err) {
    throw new Error(err?.message || 'Invalid percentage input');
  }
  if (burnBps < 0 || treasuryBps < 0 || memberBps < 0) {
    throw new Error('Percentages cannot be negative');
  }
  const totalSplitBps = burnBps + treasuryBps + memberBps + protocolBps;
  if (totalSplitBps !== TOTAL_PERCENT_BPS) {
    throw new Error(`Fee split must equal 100, received ${formatBpsAsPercent(totalSplitBps)}`);
  }
  let normalizedEntryFee;
  try {
    normalizedEntryFee = BigInt(entryFee);
  } catch {
    throw new Error('Invalid entry fee');
  }
  let normalizedMaxMembers = 0n;
  try {
    normalizedMaxMembers = maxMembers !== undefined && maxMembers !== null ? BigInt(maxMembers) : 0n;
  } catch {
    throw new Error('Invalid max members');
  }
  if (normalizedMaxMembers < 0n) {
    throw new Error('Max members must be non-negative');
  }
  const normalizedToken = String(tokenAddress);
  const zeroAddress = ethers.ZeroAddress ?? '0x0000000000000000000000000000000000000000';
  const normalizedBurnAddress = burnAddress && ethers.isAddress?.(burnAddress)
    ? burnAddress
    : null;
  const useCustomCurve = Boolean(curveProvided && curveConfig);
  const defaultCurve = { primary: { style: 0, rateBps: 0 } };
  const curveStruct = useCustomCurve ? curveConfig : defaultCurve;
  const quorumValue = quorumPercent !== undefined && quorumPercent !== null ? Number(quorumPercent) : null;
  const executionDelayValue = executionDelaySeconds !== undefined && executionDelaySeconds !== null
    ? Number(executionDelaySeconds)
    : null;
  const homeLinkValue = templHomeLink ? String(templHomeLink) : '';
  const hasCustomQuorum = quorumValue !== null;
  const hasCustomDelay = executionDelayValue !== null;
  const hasCustomBurn = normalizedBurnAddress !== null;

  const config = {
    priest: walletAddress,
    token: normalizedToken,
    entryFee: normalizedEntryFee,
    burnPercent: burnBps,
    treasuryPercent: treasuryBps,
    memberPoolPercent: memberBps,
    quorumPercent: hasCustomQuorum ? quorumValue : 0,
    executionDelaySeconds: hasCustomDelay ? executionDelayValue : 0,
    burnAddress: hasCustomBurn ? normalizedBurnAddress : zeroAddress,
    priestIsDictator: priestIsDictator === true,
    maxMembers: normalizedMaxMembers,
    curveProvided: useCustomCurve,
    curve: curveStruct,
    homeLink: homeLinkValue
  };

  const defaultsRequested =
    burnBps === 3_000 &&
    treasuryBps === 3_000 &&
    memberBps === 3_000 &&
    config.priest === walletAddress &&
    !hasCustomBurn &&
    !hasCustomQuorum &&
    !hasCustomDelay &&
    config.priestIsDictator === false &&
    normalizedMaxMembers === 0n &&
    !useCustomCurve &&
    homeLinkValue === '';

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
  const data = await res.json().catch(() => ({}));
  dlog('deployTempl: /templs response', data);
  const hasGroupId = typeof data?.groupId === 'string' && data.groupId.length > 0;
  if (isDebugEnabled()) {
    dlog('deployTempl: templs registration completed', { hasGroupId, groupId: data?.groupId });
  }
  if (!hasGroupId) {
    dlog('deployTempl: backend did not return groupId; continuing without group binding');
    // XMTP group creation may fail independently; surface deploy result without group linkage
    return { contractAddress, group: null, groupId: null };
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
