// @ts-check
import { BACKEND_URL } from '../config.js';
import { buildJoinTypedData } from '../../../shared/signing.js';
import { waitForConversation } from '../../../shared/xmtp.js';
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

async function ensureTokenAllowance({ ethers, signer, owner, token, spender, amount, txOptions }) {
  const zeroAddress = (typeof ethers?.ZeroAddress === 'string'
    ? ethers.ZeroAddress
    : '0x0000000000000000000000000000000000000000').toLowerCase();
  if (String(token).toLowerCase() === zeroAddress) {
    return txOptions;
  }
  const erc20 = new ethers.Contract(
    token,
    [
      'function allowance(address owner, address spender) view returns (uint256)',
      'function approve(address spender, uint256 value) returns (bool)'
    ],
    signer
  );
  let nextOptions = { ...txOptions };
  try {
    const current = BigInt(await erc20.allowance(owner, spender));
    if (current >= amount) {
      dlog('purchaseAccess: allowance sufficient', { allowance: current.toString(), required: amount.toString() });
      return nextOptions;
    }
    const approvalOverridesBase = { ...txOptions };
    if (approvalOverridesBase && Object.prototype.hasOwnProperty.call(approvalOverridesBase, 'value')) {
      delete approvalOverridesBase.value;
    }

    const sendApproval = async (value, overrides, logContext) => {
      const approvalTx = await erc20.approve(spender, value, overrides);
      let overrideNonce = null;
      if (approvalTx?.nonce !== undefined && approvalTx?.nonce !== null) {
        const rawNonce = typeof approvalTx.nonce === 'bigint' ? Number(approvalTx.nonce) : approvalTx.nonce;
        if (Number.isFinite(rawNonce)) {
          overrideNonce = rawNonce + 1;
        }
      }
      dlog('purchaseAccess: approval sent', {
        ...logContext,
        approvalValue: typeof value === 'bigint' ? value.toString() : String(value),
        approvalNonce: approvalTx?.nonce,
        nextNonce: overrideNonce
      });
      await approvalTx.wait();
      return overrideNonce;
    };

    let nextNonceOverride = null;
    const zeroFirstReset = current > 0n && amount > 0n && current < amount;
    let approvalOverridesForAmount = approvalOverridesBase;

    if (zeroFirstReset) {
      const overrideNonce = await sendApproval(0n, approvalOverridesBase, {
        allowanceBefore: current.toString(),
        required: amount.toString(),
        approvalStage: 'reset'
      });
      if (overrideNonce !== null) {
        nextNonceOverride = overrideNonce;
        approvalOverridesForAmount = { ...approvalOverridesForAmount, nonce: overrideNonce };
      }
    }

    const finalNonce = await sendApproval(amount, approvalOverridesForAmount, {
      allowanceBefore: zeroFirstReset ? '0' : current.toString(),
      required: amount.toString(),
      approvalStage: 'set'
    });
    if (finalNonce !== null) {
      nextNonceOverride = finalNonce;
    }
    if (nextNonceOverride !== null) {
      nextOptions = { ...nextOptions, nonce: nextNonceOverride };
    }
  } catch (err) {
    dlog('purchaseAccess: approval step error', err?.message || err);
  }
  return nextOptions;
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
  txOptions = {}
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
    }
  } catch {}
  const { token: resolvedToken, amount: resolvedAmount } = await resolveAccessConfig({
    contract,
    tokenAddress,
    amount
  });

  txOptions = await ensureTokenAllowance({
    ethers,
    signer,
    owner: memberAddress,
    token: resolvedToken,
    spender: templAddress,
    amount: resolvedAmount,
    txOptions
  });

  const purchaseOverrides = { ...txOptions };
  dlog('purchaseAccess: sending purchase', { overrides: purchaseOverrides });
  const tx = await contract.purchaseAccess(purchaseOverrides);
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
  txOptions = {}
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
    await purchaseAccess({
      ethers,
      signer,
      walletAddress: normalizedMemberAddress,
      templAddress,
      templArtifact,
      txOptions
    });
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
  const signature = await signer.signTypedData(joinTyped.domain, joinTyped.types, joinTyped.message);

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
  const res = await postJson(`${backendUrl}/join`, joinPayload);
  try { console.log('[purchaseAndJoin] /join status', res.status); } catch {}

  if (res.status === 404 && isDebugEnabled()) {
    try {
      const debugMissing = await fetch(`${backendUrl}/debug/group?contractAddress=${templAddress}&refresh=1`).then((r) => r.json());
      dlog('purchaseAndJoin: debug group after 404', debugMissing);
    } catch (err) {
      dlog('purchaseAndJoin: debug group fetch after 404 failed', err?.message || err);
    }
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
          return await finalizeJoin({ xmtp, groupId: String(data.groupId).replace(/^0x/i, '') });
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
    for (let i = 0; i < tries; i++) {
      try { await xmtp?.preferences?.inboxState?.(true); } catch {}
      try { await xmtp?.conversations?.sync?.(); } catch {}
      await new Promise((r) => setTimeout(r, delay));
      const againPayload = {
        ...joinPayload,
        inboxId: xmtp?.inboxId?.replace?.(/^0x/i, '') || undefined
      };
      dlog('purchaseAndJoin: retry join payload', againPayload);
      const again = await postJson(`${backendUrl}/join`, againPayload);
      try { console.log('[purchaseAndJoin] retry /join status', again.status); } catch {}
      if (again.ok) {
        const data = await again.json();
        if (data && typeof data.groupId === 'string') {
          return await finalizeJoin({ xmtp, groupId: String(data.groupId).replace(/^0x/i, '') });
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
    // @ts-ignore
    if (import.meta?.env?.VITE_ENABLE_BACKEND_FALLBACK === '1') {
      const dbg = await fetch(`${backendUrl}/debug/membership?contractAddress=${templAddress}&inboxId=${xmtp?.inboxId || ''}`).then(r => r.json());
      dlog('purchaseAndJoin: server membership snapshot', dbg);
    }
  } catch {}
  return await finalizeJoin({ xmtp, groupId });
}

async function finalizeJoin({ xmtp, groupId }) {
  const isFast = (() => { try { return import.meta?.env?.VITE_E2E_DEBUG === '1'; } catch { return false; } })();
  const group = await waitForConversation({ xmtp, groupId, retries: isFast ? 25 : 60, delayMs: isFast ? 200 : 1000 });
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
  const amount = await contract.getClaimablePoolAmount(memberAddress);
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
      const c = await contract.getClaimableExternalToken(memberAddress, token);
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
  const tx = await contract.claimMemberPool(txOptions);
  await tx.wait();
}

export async function claimExternalToken({ ethers, signer, templAddress, templArtifact, token, txOptions = {} }) {
  const contract = new ethers.Contract(templAddress, templArtifact.abi, signer);
  const tx = await contract.claimExternalToken(token, txOptions);
  await tx.wait();
}
