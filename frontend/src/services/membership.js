// @ts-check
import { BACKEND_URL } from '../config.js';
import { buildJoinTypedData } from '@shared/signing.js';
import { waitForConversation, deriveTemplGroupName } from '@shared/xmtp.js';
import { dlog, isDebugEnabled } from './utils.js';
import { registerTemplBackend } from './deployment.js';
import { postJson } from './http.js';

async function resolveAccessConfig({ contract, tokenAddress, amount }) {
  let resolvedToken = typeof tokenAddress === 'string'
    ? tokenAddress.trim() || undefined
    : tokenAddress != null
      ? String(tokenAddress)
      : undefined;

  let resolvedAmount;
  if (amount !== undefined && amount !== null) {
    try {
      resolvedAmount = BigInt(amount);
    } catch {
      throw new Error('purchaseAccess: invalid amount');
    }
  }

  if (!resolvedToken || resolvedAmount === undefined) {
    try {
      if (typeof contract.getConfig === 'function') {
        const cfg = await contract.getConfig();
        if (!resolvedToken && cfg && typeof cfg[0] === 'string') {
          resolvedToken = cfg[0];
        }
        if (resolvedAmount === undefined && cfg && cfg.length > 1) {
          try { resolvedAmount = BigInt(cfg[1]); } catch {}
        }
      }
    } catch {}
  }

  if (!resolvedToken) {
    try { resolvedToken = await contract.accessToken(); } catch {}
  }
  if (resolvedAmount === undefined) {
    try { resolvedAmount = BigInt(await contract.entryFee()); } catch {}
  }

  if (!resolvedToken) {
    throw new Error('purchaseAccess: missing token address');
  }
  if (resolvedAmount === undefined) {
    throw new Error('purchaseAccess: missing entry fee amount');
  }

  return { token: resolvedToken, amount: resolvedAmount };
}

export async function getTokenAllowance({ ethers, providerOrSigner, owner, token, spender }) {
  const zeroAddress = (typeof ethers?.ZeroAddress === 'string'
    ? ethers.ZeroAddress
    : '0x0000000000000000000000000000000000000000').toLowerCase();
  if (!token || String(token).toLowerCase() === zeroAddress) {
    return BigInt(ethers?.MaxUint256 ?? (2n ** 256n - 1n));
  }
  if (!providerOrSigner || !owner || !spender) {
    throw new Error('getTokenAllowance: missing provider, owner, or spender');
  }
  const reader = providerOrSigner;
  const erc20 = new ethers.Contract(
    token,
    ['function allowance(address owner, address spender) view returns (uint256)'],
    reader
  );
  const current = await erc20.allowance(owner, spender);
  return BigInt(current);
}

function resolveXmtpEnvForBrowser() {
  try {
    const forced = import.meta.env?.VITE_XMTP_ENV?.trim();
    if (forced) return forced;
    if (typeof window !== 'undefined') {
      const override = window.localStorage?.getItem?.('templ:xmtpEnv')?.trim();
      if (override && ['local', 'dev', 'production'].includes(override)) {
        return override;
      }
    }
  } catch {/* ignore */}
  return 'production';
}

async function ensureInboxReady({ xmtp, retries = 90, delayMs = 1000 }) {
  if (!xmtp?.inboxId) return true;
  const inboxId = String(xmtp.inboxId).replace(/^0x/i, '');
  const env = resolveXmtpEnvForBrowser();
  let Client;
  try {
    // Dynamic import to avoid test/bundling surprises
    ({ Client } = await import('@xmtp/browser-sdk'));
  } catch {/* ignore */}
  for (let i = 0; i < retries; i++) {
    try { await xmtp?.preferences?.inboxState?.(true); } catch {/* ignore */}
    try { await xmtp?.conversations?.sync?.(); } catch {/* ignore */}
    if (Client?.inboxStateFromInboxIds) {
      try {
        const states = await Client.inboxStateFromInboxIds([inboxId], env);
        if (Array.isArray(states) && states.length > 0) {
          return true;
        }
      } catch {/* ignore */}
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return false;
}

async function ensureTokenAllowance({ ethers, signer, owner, token, spender, amount, txOptions }) {
  const zeroAddress = (typeof ethers?.ZeroAddress === 'string'
    ? ethers.ZeroAddress
    : '0x0000000000000000000000000000000000000000').toLowerCase();
  if (String(token).toLowerCase() === zeroAddress) {
    return txOptions;
  }
  let nextOptions = { ...txOptions };
  try {
    const current = await getTokenAllowance({ ethers, providerOrSigner: signer.provider ?? signer, owner, token, spender });
    if (current >= amount) {
      dlog('purchaseAccess: allowance sufficient', { allowance: current.toString(), required: amount.toString() });
      return nextOptions;
    }
    const approvalOverrides = { ...txOptions };
    if (approvalOverrides && Object.prototype.hasOwnProperty.call(approvalOverrides, 'value')) {
      delete approvalOverrides.value;
    }
    const erc20 = new ethers.Contract(
      token,
      ['function approve(address spender, uint256 value) returns (bool)'],
      signer
    );
    const approval = await erc20.approve(spender, amount, approvalOverrides);
    let overrideNonce = null;
    if (approval?.nonce !== undefined && approval?.nonce !== null) {
      const rawNonce = typeof approval.nonce === 'bigint' ? Number(approval.nonce) : approval.nonce;
      if (Number.isFinite(rawNonce)) {
        overrideNonce = rawNonce + 1;
      }
    }
    dlog('purchaseAccess: approval sent', {
      allowanceBefore: current.toString(),
      required: amount.toString(),
      approvalNonce: approval?.nonce,
      nextNonce: overrideNonce
    });
    await approval.wait();
    if (overrideNonce !== null) {
      nextOptions = { ...nextOptions, nonce: overrideNonce };
    }
  } catch (err) {
    dlog('purchaseAccess: approval step error', err?.message || err);
  }
  return nextOptions;
}

async function hasSufficientAllowance({ ethers, providerOrSigner, owner, token, spender, amount }) {
  try {
    const allowance = await getTokenAllowance({ ethers, providerOrSigner, owner, token, spender });
    return allowance >= amount;
  } catch (err) {
    dlog('hasSufficientAllowance: failed to read allowance', err?.message || err);
    return false;
  }
}

async function assertSufficientBalance({ ethers, providerOrSigner, token, owner, amount }) {
  const zeroAddress = (typeof ethers?.ZeroAddress === 'string'
    ? ethers.ZeroAddress
    : '0x0000000000000000000000000000000000000000').toLowerCase();
  if (!providerOrSigner) {
    throw new Error('Join failed: missing provider to check balances');
  }
  if (String(token).toLowerCase() === zeroAddress) {
    const balance = await providerOrSigner.getBalance(owner);
    if (BigInt(balance) < amount) {
      throw new Error('Insufficient native balance for entry fee');
    }
    return;
  }
  const erc20 = new ethers.Contract(
    token,
    ['function balanceOf(address owner) view returns (uint256)'],
    providerOrSigner
  );
  const balance = await erc20.balanceOf(owner);
  if (BigInt(balance) < amount) {
    throw new Error('Insufficient token balance for entry fee');
  }
}

/**
 * Approve entry fee (if needed) and purchase templ access.
 * @param {import('../flows.types').PurchaseAccessRequest} params
 * @returns {Promise<boolean>}
 */
export async function purchaseAccess({
  ethers,
  signer,
  walletAddress,
  templAddress,
  templArtifact,
  tokenAddress,
  amount,
  txOptions = {},
  autoApprove = true
}) {
  if (!ethers || !signer || !templAddress || !templArtifact) {
    throw new Error('Missing required purchaseAccess parameters');
  }
  const contract = new ethers.Contract(templAddress, templArtifact.abi, signer);
  let memberAddress = walletAddress;
  if (!memberAddress && typeof signer?.getAddress === 'function') {
    try { memberAddress = await signer.getAddress(); } catch {}
  }
  if (!memberAddress) {
    throw new Error('purchaseAccess requires walletAddress or signer.getAddress()');
  }
  try {
    if (typeof contract.hasAccess === 'function') {
      const already = await contract.hasAccess(memberAddress);
      if (already) return false;
    } else if (typeof contract.members === 'function') {
      try {
        const info = await contract.members(memberAddress);
        if (info && info.joined) return false;
      } catch {}
    }
  } catch {}
  const { token: resolvedToken, amount: resolvedAmount } = await resolveAccessConfig({
    contract,
    tokenAddress,
    amount
  });

  if (autoApprove) {
    txOptions = await ensureTokenAllowance({
      ethers,
      signer,
      owner: memberAddress,
      token: resolvedToken,
      spender: templAddress,
      amount: resolvedAmount,
      txOptions
    });
  } else {
    const allowanceOk = await hasSufficientAllowance({
      ethers,
      providerOrSigner: signer.provider ?? signer,
      owner: memberAddress,
      token: resolvedToken,
      spender: templAddress,
      amount: resolvedAmount
    });
    if (!allowanceOk) {
      throw new Error('Token approval required before joining');
    }
  }

  await assertSufficientBalance({
    ethers,
    providerOrSigner: signer.provider ?? signer,
    token: resolvedToken,
    owner: memberAddress,
    amount: resolvedAmount
  });

  try {
    const maxMembersRaw = await contract.MAX_MEMBERS();
    if (maxMembersRaw !== undefined && maxMembersRaw !== null) {
      const maxMembers = BigInt(maxMembersRaw);
      if (maxMembers > 0n) {
        const currentMembers = BigInt(await contract.getMemberCount());
        if (currentMembers >= maxMembers) {
          throw new Error('Member limit reached for this templ');
        }
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message === 'Member limit reached for this templ') {
      throw err;
    }
  }

  try {
    if (typeof contract.paused === 'function') {
      const paused = await contract.paused();
      if (paused) {
        throw new Error('Templ is currently paused; ask the priest to unpause before joining');
      }
    }
  } catch (err) {
    if (err instanceof Error && /Templ is currently paused/.test(err.message)) {
      throw err;
    }
  }

  const purchaseOverrides = { ...txOptions };
  dlog('purchaseAccess: sending join()', { overrides: purchaseOverrides });
  let tx;
  if (typeof contract.join === 'function') {
    tx = await contract.join(purchaseOverrides);
  } else if (typeof contract.purchaseAccess === 'function') {
    tx = await contract.purchaseAccess(purchaseOverrides);
  } else {
    throw new Error('Join failed: contract does not expose join()');
  }
  await tx.wait();
  dlog('purchaseAccess: tx mined');
  return true;
}

/**
 * Purchase membership (if needed) and request a backend invite.
 * @param {import('../flows.types').JoinRequest} params
 * @returns {Promise<import('../flows.types').JoinResponse>}
 */
export async function purchaseAndJoin({
  ethers,
  xmtp,
  signer,
  walletAddress,
  templAddress,
  templArtifact,
  backendUrl = BACKEND_URL,
  txOptions = {},
  onProgress,
  autoApprove = true
}) {
  async function fixKeyPackages(max = 30) {
    try {
      for (let i = 0; i < max; i++) {
        const agg = await xmtp?.debugInformation?.apiAggregateStatistics?.();
        if (!agg || typeof agg !== 'string') break;
        if (agg.includes('UploadKeyPackage')) {
          const m = agg.match(/UploadKeyPackage\s+(\d+)/);
          const uploads = m ? Number(m[1]) : 0;
          if (uploads >= 1) break;
        }
        await new Promise((r) => setTimeout(r, 300));
      }
    } catch {}
  }

  await fixKeyPackages();
  const skipPurchase = (() => { try { return import.meta?.env?.VITE_E2E_NO_PURCHASE === '1'; } catch { return false; } })();
  let memberAddress = walletAddress;
  if (!memberAddress || typeof memberAddress !== 'string') {
    try { memberAddress = await signer.getAddress(); } catch {}
  }
  if (!memberAddress) {
    throw new Error('Join failed: missing member address');
  }
  let normalizedMemberAddress = memberAddress;
  try { normalizedMemberAddress = ethers.getAddress(memberAddress); } catch {}
  if (!skipPurchase) {
    onProgress?.('purchase:start');
    await purchaseAccess({
      ethers,
      signer,
      walletAddress: normalizedMemberAddress,
      templAddress,
      templArtifact,
      txOptions,
      autoApprove
    });
    onProgress?.('purchase:complete');
  } else {
    onProgress?.('purchase:skipped');
  }
  if (isDebugEnabled()) {
    try {
      await registerTemplBackend({ ethers, signer, walletAddress: normalizedMemberAddress, templAddress, backendUrl });
    } catch (err) {
      dlog('purchaseAndJoin: preregister templ failed', err?.message || err);
    }
  }
  const network = await signer.provider?.getNetwork?.();
  const chainId = Number(network?.chainId || 1337);
  const joinTyped = buildJoinTypedData({ chainId, contractAddress: templAddress.toLowerCase() });
  onProgress?.('join:signature:start');
  const signature = await signer.signTypedData(joinTyped.domain, joinTyped.types, joinTyped.message);
  onProgress?.('join:signature:complete');

  // Ensure the user's XMTP inbox is visible on the network before submitting join
  try {
    const ready = await ensureInboxReady({ xmtp });
    if (!ready) {
      dlog('purchaseAndJoin: inbox not observed on network after wait');
    }
  } catch {/* ignore */}

  const joinPayload = {
    contractAddress: templAddress,
    memberAddress: normalizedMemberAddress,
    inboxId: xmtp?.inboxId?.replace?.(/^0x/i, '') || undefined,
    signature,
    chainId,
    nonce: joinTyped.message.nonce,
    issuedAt: joinTyped.message.issuedAt,
    expiry: joinTyped.message.expiry
  };
  dlog('purchaseAndJoin: sending join payload', joinPayload);
  onProgress?.('join:submission:start');
  const res = await postJson(`${backendUrl}/join`, joinPayload);
  try { console.log('[purchaseAndJoin] /join status', res.status); } catch {}

  if (res.status === 404 && isDebugEnabled()) {
    dlog('purchaseAndJoin: templ not found in backend, attempting registration');
    try {
      await registerTemplBackend({ ethers, signer, walletAddress: normalizedMemberAddress, templAddress, backendUrl });
    } catch (err) {
      dlog('purchaseAndJoin: re-register templ failed', err?.message || err);
    }
    try {
      const retry = await postJson(`${backendUrl}/join`, {
        ...joinPayload,
        inboxId: xmtp?.inboxId?.replace?.(/^0x/i, '') || undefined
      });
      try { console.log('[purchaseAndJoin] retry join after register status', retry.status); } catch {}
      if (retry.ok) {
        const data = await retry.json();
        if (data && typeof data.groupId === 'string') {
          return await finalizeJoin({ xmtp, groupId: String(data.groupId).replace(/^0x/i, ''), templAddress });
        }
      }
    } catch (err) {
      dlog('purchaseAndJoin: join retry after register failed', err?.message || err);
    }
  }

  if (res.status === 503) {
    try { console.log('[purchaseAndJoin] /join returned 503; retrying'); } catch {}
    const isFast = (() => { try { return import.meta?.env?.VITE_E2E_DEBUG === '1'; } catch { return false; } })();
    const tries = isFast ? 8 : 90;
    const delay = isFast ? 250 : 1000;
    onProgress?.('join:submission:waiting');
    for (let i = 0; i < tries; i++) {
      try { await xmtp?.preferences?.inboxState?.(true); } catch {}
      try { await xmtp?.conversations?.sync?.(); } catch {}
      await new Promise((r) => setTimeout(r, delay));
      const againPayload = {
        ...joinPayload,
        inboxId: xmtp?.inboxId?.replace?.(/^0x/i, '') || undefined
      };
      dlog('purchaseAndJoin: retry join payload', againPayload);
      onProgress?.('join:submission:retry');
      const again = await postJson(`${backendUrl}/join`, againPayload);
      try { console.log('[purchaseAndJoin] retry /join status', again.status); } catch {}
      if (again.ok) {
        const data = await again.json();
        if (data && typeof data.groupId === 'string') {
          return await finalizeJoin({ xmtp, groupId: String(data.groupId).replace(/^0x/i, ''), templAddress });
        }
      }
    }
    throw new Error('Join failed: identity not registered');
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('purchaseAndJoin: /join failed', { status: res.status, statusText: res.statusText, body });
    throw new Error(`Join failed: ${res.status} ${res.statusText} ${body}`.trim());
  }

  const data = await res.json();
  try { console.log('[purchaseAndJoin] /join ok with groupId', data?.groupId); } catch {}
  if (!data || typeof data.groupId !== 'string' || data.groupId.length === 0) {
    throw new Error('Invalid /join response: missing groupId');
  }
  const groupId = String(data.groupId);
  dlog('purchaseAndJoin: backend returned groupId=', groupId);
  try {
    // Debug information removed - backend debug endpoints not available in current system
    dlog('purchaseAndJoin: completed join process successfully');
  } catch {}
  onProgress?.('join:submission:complete');
  const result = await finalizeJoin({ xmtp, groupId, templAddress });
  onProgress?.('join:complete');
  return result;
}

/**
 * Request a chat invite only (assumes access already purchased on-chain).
 * Performs typed-data signing and backend /join call, then waits for the group.
 */
export async function requestChatInvite({
  ethers,
  xmtp,
  signer,
  walletAddress,
  templAddress,
  templArtifact,
  backendUrl = BACKEND_URL,
  onProgress
}) {
  if (!ethers || !xmtp || !signer || !templAddress || !templArtifact) {
    throw new Error('Missing parameters for requestChatInvite');
  }
  // Ensure inbox is visible on the network to reduce 503s
  try { await ensureInboxReady({ xmtp }); } catch {/* ignore */}

  let memberAddress = walletAddress;
  if (!memberAddress || typeof memberAddress !== 'string') {
    try { memberAddress = await signer.getAddress(); } catch {}
  }
  if (!memberAddress) {
    throw new Error('Join failed: missing member address');
  }
  const network = await signer.provider?.getNetwork?.();
  const chainId = Number(network?.chainId || 1337);
  const joinTyped = buildJoinTypedData({ chainId, contractAddress: templAddress.toLowerCase() });
  onProgress?.('join:signature:start');
  const signature = await signer.signTypedData(joinTyped.domain, joinTyped.types, joinTyped.message);
  onProgress?.('join:signature:complete');

  const joinPayload = {
    contractAddress: templAddress,
    memberAddress: memberAddress,
    inboxId: xmtp?.inboxId?.replace?.(/^0x/i, '') || undefined,
    signature,
    chainId,
    nonce: joinTyped.message.nonce,
    issuedAt: joinTyped.message.issuedAt,
    expiry: joinTyped.message.expiry
  };

  onProgress?.('join:submission:start');
  let res = await postJson(`${backendUrl}/join`, joinPayload);
  if (res.status === 503) {
    onProgress?.('join:submission:waiting');
    // Retry loop similar to purchaseAndJoin
    const tries = 90;
    const delay = 1000;
    for (let i = 0; i < tries; i++) {
      try { await xmtp?.preferences?.inboxState?.(true); } catch {}
      try { await xmtp?.conversations?.sync?.(); } catch {}
      await new Promise((r) => setTimeout(r, delay));
      onProgress?.('join:submission:retry');
      res = await postJson(`${backendUrl}/join`, joinPayload);
      if (res.ok) break;
    }
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Join failed: ${res.status} ${res.statusText} ${body}`.trim());
  }
  onProgress?.('join:submission:complete');
  const data = await res.json();
  if (!data || typeof data.groupId !== 'string' || data.groupId.length === 0) {
    throw new Error('Invalid /join response: missing groupId');
  }
  const groupId = String(data.groupId);
  const result = await finalizeJoin({ xmtp, groupId, templAddress });
  onProgress?.('join:complete');
  return result;
}

async function finalizeJoin({ xmtp, groupId, templAddress }) {
  const isFast = (() => { try { return import.meta?.env?.VITE_E2E_DEBUG === '1'; } catch { return false; } })();
  const expectedName = deriveTemplGroupName(templAddress);
  const retries = isFast ? 120 : 240;
  const delayMs = isFast ? 250 : 1000;
  const group = await waitForConversation({ xmtp, groupId, expectedName, retries, delayMs });
  if (!group) {
    throw new Error('Failed to discover XMTP group after join; please retry once XMTP finishes provisioning.');
  }
  return { group, groupId };
}

export async function sendMessage({ group, content }) {
  await group.send(content);
}

/**
 * Read treasury info from contract.
 */
export async function getTreasuryInfo({ ethers, providerOrSigner, templAddress, templArtifact }) {
  const contract = new ethers.Contract(templAddress, templArtifact.abi, providerOrSigner);
  const [treasury, memberPool, totalReceived, totalBurnedAmount, totalProtocolFees, protocolAddress] = await contract.getTreasuryInfo();
  return {
    treasury: BigInt(treasury).toString(),
    memberPool: BigInt(memberPool).toString(),
    totalReceived: BigInt(totalReceived).toString(),
    totalBurnedAmount: BigInt(totalBurnedAmount).toString(),
    totalProtocolFees: BigInt(totalProtocolFees).toString(),
    protocolAddress
  };
}

export async function getClaimable({ ethers, providerOrSigner, templAddress, templArtifact, memberAddress }) {
  const contract = new ethers.Contract(templAddress, templArtifact.abi, providerOrSigner);
  const amount = await contract.getClaimableMemberRewards(memberAddress);
  return BigInt(amount).toString();
}

export async function getExternalRewards({ ethers, providerOrSigner, templAddress, templArtifact, memberAddress }) {
  const contract = new ethers.Contract(templAddress, templArtifact.abi, providerOrSigner);
  const tokens = await contract.getExternalRewardTokens();
  const results = [];
  for (const token of tokens) {
    const [poolBalance, cumulativeRewards, remainder] = await contract.getExternalRewardState(token);
    let claimable = 0n;
    if (memberAddress) {
      const c = await contract.getClaimableExternalReward(memberAddress, token);
      claimable = BigInt(c ?? 0n);
    }
    results.push({
      token,
      poolBalance: BigInt(poolBalance ?? 0n).toString(),
      cumulativeRewards: BigInt(cumulativeRewards ?? 0n).toString(),
      remainder: BigInt(remainder ?? 0n).toString(),
      claimable: claimable.toString()
    });
  }
  return results;
}

export async function claimMemberPool({ ethers, signer, templAddress, templArtifact, txOptions = {} }) {
  const contract = new ethers.Contract(templAddress, templArtifact.abi, signer);
  const tx = await contract.claimMemberRewards(txOptions);
  await tx.wait();
}

export async function claimExternalToken({ ethers, signer, templAddress, templArtifact, token, txOptions = {} }) {
  const contract = new ethers.Contract(templAddress, templArtifact.abi, signer);
  const tx = await contract.claimExternalReward(token, txOptions);
  await tx.wait();
}
