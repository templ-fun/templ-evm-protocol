// @ts-check
import { BACKEND_URL } from './config.js';
import { buildCreateTypedData, buildJoinTypedData, buildDelegateTypedData, buildMuteTypedData } from '../../shared/signing.js';
import { waitForConversation } from '../../shared/xmtp.js';

// Minimal debug logger usable in both browser and Node tests
const __isDebug = (() => {
  // Node tests: opt-in via DEBUG_TEMPL=1
  try { if (globalThis?.process?.env?.DEBUG_TEMPL === '1') return true; } catch {}
  // Browser (Vite): import.meta.env.VITE_E2E_DEBUG — typed loosely to appease TS in JS files
  try {
    // @ts-ignore - vite injects env on import.meta at build time
    const env = import.meta?.env;
    if (env?.VITE_E2E_DEBUG === '1') return true;
  } catch {}
  return false;
})();
const dlog = (...args) => { if (__isDebug) { try { console.log(...args); } catch {} } };

function isE2ETestEnv() {
  try { if (globalThis?.process?.env?.NODE_ENV === 'test') return true; } catch {}
  try { /* @ts-ignore */ if (import.meta?.env?.VITE_E2E_DEBUG === '1') return true; } catch {}
  return false;
}

function addToTestRegistry(address) {
  if (!isE2ETestEnv()) return;
  try {
    const key = 'templ:test:deploys';
    const arr = JSON.parse(localStorage.getItem(key) || '[]');
    if (!arr.includes(address)) arr.push(address);
    localStorage.setItem(key, JSON.stringify(arr));
    localStorage.setItem('templ:lastAddress', address);
  } catch {}
}

/**
 * Deploy a new TEMPL contract and register a group with the backend.
 * @param {import('./flows.types').DeployRequest} params
 * @returns {Promise<import('./flows.types').DeployResponse>}
 */
export async function deployTempl({
  ethers,
  xmtp,
  signer,
  walletAddress,
  tokenAddress,
  protocolFeeRecipient,
  entryFee,
  templArtifact,
  backendUrl = BACKEND_URL,
  txOptions = {}
}) {
  if (!ethers || !signer || !walletAddress || !tokenAddress || !protocolFeeRecipient || !templArtifact) {
    throw new Error('Missing required deployTempl parameters');
  }
  const factory = new ethers.ContractFactory(
    templArtifact.abi,
    templArtifact.bytecode,
    signer
  );
  const contract = await factory.deploy(
    walletAddress,
    protocolFeeRecipient,
    tokenAddress,
    BigInt(entryFee),
    txOptions
  );
  await contract.waitForDeployment();
  const contractAddress = await contract.getAddress();
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
  const res = await fetch(`${backendUrl}/templs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contractAddress,
      priestAddress: walletAddress,
      signature,
      chainId,
      nonce: createTyped.message.nonce,
      issuedAt: createTyped.message.issuedAt,
      expiry: createTyped.message.expiry
    })
  });
  try { console.log('[deployTempl] /templs status', res.status); } catch {}
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `Templ registration failed: ${res.status} ${res.statusText} ${body}`.trim()
    );
  }
  const data = await res.json();
  if (!data || typeof data.groupId !== 'string' || data.groupId.length === 0) {
    throw new Error('Invalid /templs response: missing groupId');
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
    console.error('Could not find group after creation; will rely on join step');
    return { contractAddress, group: null, groupId };
  }
  return { contractAddress, group, groupId };
}

/**
 * Approve entry fee (if needed) and purchase templ access.
 * @param {import('./flows.types').PurchaseAccessRequest} params
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
  let resolvedToken = tokenAddress;
  if (typeof resolvedToken === 'string') {
    resolvedToken = resolvedToken.trim() || undefined;
  } else if (resolvedToken != null) {
    resolvedToken = String(resolvedToken);
  }
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
    try {
      const fee = await contract.entryFee();
      resolvedAmount = BigInt(fee ?? 0n);
    } catch {}
  }
  if (!resolvedToken) {
    throw new Error('purchaseAccess: missing token address');
  }
  if (resolvedAmount === undefined) {
    throw new Error('purchaseAccess: missing entry fee amount');
  }
  const zeroAddress = (typeof ethers?.ZeroAddress === 'string'
    ? ethers.ZeroAddress
    : '0x0000000000000000000000000000000000000000').toLowerCase();
  const normalizedToken = String(resolvedToken).toLowerCase();
  if (normalizedToken !== zeroAddress) {
    const erc20 = new ethers.Contract(
      resolvedToken,
      [
        'function allowance(address owner, address spender) view returns (uint256)',
        'function approve(address spender, uint256 value) returns (bool)'
      ],
      signer
    );
    try {
      const current = BigInt(await erc20.allowance(memberAddress, templAddress));
      if (current < resolvedAmount) {
        const approval = await erc20.approve(templAddress, resolvedAmount);
        await approval.wait();
      }
    } catch {}
  }
  const tx = await contract.purchaseAccess(txOptions);
  await tx.wait();
  return true;
}

/**
 * Purchase membership (if needed) and join the group via backend.
 * @param {import('./flows.types').JoinRequest} params
 * @returns {Promise<import('./flows.types').JoinResponse>}
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
  // Ensure the browser identity is registered and key package published
  try {
    await xmtp?.preferences?.inboxState?.(true);
    for (let i = 0; i < 10; i++) {
      try {
        const agg = await xmtp?.debugInformation?.apiAggregateStatistics?.();
        if (typeof agg === 'string' && /UploadKeyPackage\s+([0-9]+)/.test(agg)) {
          const m = agg.match(/UploadKeyPackage\s+(\d+)/);
          const uploads = m ? Number(m[1]) : 0;
          if (uploads >= 1) break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 300));
    }
  } catch {}
  // In e2e/debug runs we can deterministically skip purchase from the browser and rely on pre-purchase
  const skipPurchase = (() => { try { return import.meta?.env?.VITE_E2E_NO_PURCHASE === '1'; } catch { return false; } })();
  if (!skipPurchase) {
    await purchaseAccess({
      ethers,
      signer,
      walletAddress,
      templAddress,
      templArtifact,
      txOptions
    });
  }
  const network = await signer.provider?.getNetwork?.();
  const chainId = Number(network?.chainId || 1337);
  const joinTyped = buildJoinTypedData({ chainId, contractAddress: templAddress.toLowerCase() });
  const signature = await signer.signTypedData(joinTyped.domain, joinTyped.types, joinTyped.message);
  
  // Get the member's inbox ID from XMTP client if available (optional)
  const memberInboxId = xmtp?.inboxId;
  
  const res = await fetch(`${backendUrl}/join`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contractAddress: templAddress,
      memberAddress: walletAddress,
      inboxId: xmtp?.inboxId?.replace?.(/^0x/i, '') || undefined,
      signature,
      chainId,
      nonce: joinTyped.message.nonce,
      issuedAt: joinTyped.message.issuedAt,
      expiry: joinTyped.message.expiry
    })
  });
  try { console.log('[purchaseAndJoin] /join status', res.status); } catch {}
  // If identity not yet registered, poll until backend accepts the invite
  if (res.status === 503) {
    try { console.log('[purchaseAndJoin] /join returned 503; retrying'); } catch {}
    const isFast = (() => { try { return import.meta?.env?.VITE_E2E_DEBUG === '1'; } catch { return false; } })();
    // Be more generous to accommodate XMTP dev propagation latency
    const tries = isFast ? 8 : 90;
    const delay = isFast ? 250 : 1000;
    for (let i = 0; i < tries; i++) {
      try { await xmtp?.preferences?.inboxState?.(true); } catch {}
      try { await xmtp?.conversations?.sync?.(); } catch {}
      await new Promise((r) => setTimeout(r, delay));
      const again = await fetch(`${backendUrl}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contractAddress: templAddress,
          memberAddress: walletAddress,
          inboxId: xmtp?.inboxId?.replace?.(/^0x/i, '') || undefined,
          signature,
          chainId,
          nonce: joinTyped.message.nonce,
          issuedAt: joinTyped.message.issuedAt,
          expiry: joinTyped.message.expiry
        })
      });
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
  dlog('purchaseAndJoin: backend returned groupId=', data.groupId);
  // Optional diagnostics: verify membership server-side when explicitly enabled
  try {
    // @ts-ignore
    if (import.meta?.env?.VITE_ENABLE_BACKEND_FALLBACK === '1') {
      const dbg = await fetch(`${backendUrl}/debug/membership?contractAddress=${templAddress}&inboxId=${memberInboxId || ''}`).then(r => r.json());
      dlog('purchaseAndJoin: server membership snapshot', dbg);
    }
  } catch {}
  return await finalizeJoin({ xmtp, groupId });
}

export async function sendMessage({ group, content }) {
  await group.send(content);
}

async function finalizeJoin({ xmtp, groupId }) {
  const isFast = (() => { try { return import.meta?.env?.VITE_E2E_DEBUG === '1'; } catch { return false; } })();
  // In e2e runs, allow a few seconds for deterministic discovery
  const group = await waitForConversation({ xmtp, groupId, retries: isFast ? 25 : 60, delayMs: isFast ? 200 : 1000 });
  return { group, groupId };
}
export async function proposeVote({
  ethers,
  signer,
  templAddress,
  templArtifact,
  action,
  params = {},
  callData,
  votingPeriod = 0,
  txOptions = {}
}) {
  const contract = new ethers.Contract(templAddress, templArtifact.abi, signer);
  if (action) {
    /** @type {any} */
    const p = params || {};
    let tx;
    switch (action) {
      case 'setPaused':
        tx = await contract.createProposalSetPaused(!!p.paused, votingPeriod, txOptions); break;
      case 'withdrawTreasury':
        tx = await contract.createProposalWithdrawTreasury(p.token, p.recipient, p.amount, p.reason || '', votingPeriod, txOptions); break;
      case 'changePriest':
        tx = await contract.createProposalChangePriest(p.newPriest, votingPeriod, txOptions); break;
      case 'updateConfig':
        tx = await contract.createProposalUpdateConfig(p.newEntryFee || 0n, votingPeriod, txOptions); break;
      case 'disbandTreasury': {
        let tokenAddr;
        const provided = String(p.token ?? '').trim();
        if (!provided) {
          tokenAddr = await contract.accessToken();
        } else if (provided.toLowerCase() === 'eth') {
          tokenAddr = ethers.ZeroAddress;
        } else {
          if (!ethers.isAddress(provided)) {
            throw new Error('Invalid disband token address');
          }
          tokenAddr = provided;
        }
        tx = await contract.createProposalDisbandTreasury(tokenAddr, votingPeriod, txOptions);
        break;
      }
      default:
        throw new Error('Unknown action: ' + action);
    }
    return await tx.wait();
  }
  if (callData) {
    const hasInterface = !!(ethers && typeof ethers.Interface === 'function');
    const fallbackCreate = async () => { throw new Error('Unsupported callData'); };
    if (!hasInterface) {
      return await fallbackCreate();
    }
    try {
      const sig = callData.slice(0, 10).toLowerCase();
      // Prefer decoding against the full ABI to avoid name ambiguities
      const full = new ethers.Interface(templArtifact.abi);
      const fn = full.getFunction(sig);
      if (fn?.name === 'setPausedDAO') {
        const [paused] = full.decodeFunctionData(fn, callData);
        const tx = await contract.createProposalSetPaused(paused, votingPeriod, txOptions);
        return await tx.wait();
      }
      if (fn?.name === 'withdrawTreasuryDAO' && fn.inputs.length === 4) {
        const [token, recipient, amount, reason] = full.decodeFunctionData(fn, callData);
        const tx = await contract.createProposalWithdrawTreasury(token, recipient, amount, reason, votingPeriod, txOptions);
        return await tx.wait();
      }
      // withdrawAll removed
      if (fn?.name === 'changePriestDAO' && fn.inputs.length === 1) {
        const [newPriest] = full.decodeFunctionData(fn, callData);
        const tx = await contract.createProposalChangePriest(newPriest, votingPeriod, txOptions);
        return await tx.wait();
      }
      if (fn?.name === 'updateConfigDAO' && fn.inputs.length === 2) {
        const [, newEntryFee] = full.decodeFunctionData(fn, callData);
        const tx = await contract.createProposalUpdateConfig(newEntryFee, votingPeriod, txOptions);
        return await tx.wait();
      }
      if (fn?.name === 'disbandTreasuryDAO') {
        if (fn.inputs.length === 1) {
          const [token] = full.decodeFunctionData(fn, callData);
          const tx = await contract.createProposalDisbandTreasury(token, votingPeriod, txOptions);
          return await tx.wait();
        }
        if (fn.inputs.length === 0) {
          const token = await contract.accessToken();
          const tx = await contract.createProposalDisbandTreasury(token, votingPeriod, txOptions);
          return await tx.wait();
        }
      }
      return await fallbackCreate();
    } catch {
      return await fallbackCreate();
    }
  }
  throw new Error('proposeVote: provide either action or callData');
}

export async function voteOnProposal({
  ethers,
  signer,
  templAddress,
  templArtifact,
  proposalId,
  support,
  txOptions = {}
}) {
  const contract = new ethers.Contract(templAddress, templArtifact.abi, signer);
  const tx = await contract.vote(proposalId, support, txOptions);
  await tx.wait();
}

export async function executeProposal({
  ethers,
  signer,
  templAddress,
  templArtifact,
  proposalId,
  txOptions = {}
}) {
  if (!ethers || !signer || !templAddress || !templArtifact) {
    throw new Error('Missing required executeProposal parameters');
  }
  const contract = new ethers.Contract(templAddress, templArtifact.abi, signer);
  try {
    const tx = await contract.executeProposal(proposalId, txOptions);
    return await tx.wait();
  } catch (err) {
    throw new Error(err?.reason || err?.message || String(err));
  }
}

export function watchProposals({
  ethers,
  provider,
  templAddress,
  templArtifact,
  onProposal,
  onVote
}) {
  const contract = new ethers.Contract(templAddress, templArtifact.abi, provider);
  const proposalHandler = (id, proposer, endTime) => {
    onProposal({ id: Number(id), proposer, endTime: Number(endTime) });
  };
  const voteHandler = (id, voter, support, timestamp) => {
    onVote({
      id: Number(id),
      voter,
      support: Boolean(support),
      timestamp: Number(timestamp)
    });
  };
  contract.on('ProposalCreated', proposalHandler);
  contract.on('VoteCast', voteHandler);
  return () => {
    contract.off('ProposalCreated', proposalHandler);
    contract.off('VoteCast', voteHandler);
  };
}

export async function delegateMute({
  signer,
  contractAddress,
  priestAddress,
  delegateAddress,
  backendUrl = BACKEND_URL
}) {
  const network = await signer.provider?.getNetwork?.();
  const chainId = Number(network?.chainId || 1337);
  const typed = buildDelegateTypedData({ chainId, contractAddress, delegateAddress });
  const signature = await signer.signTypedData(typed.domain, typed.types, typed.message);
  const res = await fetch(`${backendUrl}/delegateMute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contractAddress,
      priestAddress,
      delegateAddress,
      signature,
      chainId,
      nonce: typed.message.nonce,
      issuedAt: typed.message.issuedAt,
      expiry: typed.message.expiry
    })
  });
  if (!res.ok) return false;
  const data = await res.json();
  if (!data || typeof data.delegated !== 'boolean') {
    throw new Error('Invalid /delegateMute response');
  }
  return data.delegated;
}

export async function muteMember({
  signer,
  contractAddress,
  moderatorAddress,
  targetAddress,
  backendUrl = BACKEND_URL
}) {
  const network = await signer.provider?.getNetwork?.();
  const chainId = Number(network?.chainId || 1337);
  const typed = buildMuteTypedData({ chainId, contractAddress, targetAddress });
  const signature = await signer.signTypedData(typed.domain, typed.types, typed.message);
  const res = await fetch(`${backendUrl}/mute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contractAddress,
      moderatorAddress,
      targetAddress,
      signature,
      chainId,
      nonce: typed.message.nonce,
      issuedAt: typed.message.issuedAt,
      expiry: typed.message.expiry
    })
  });
  if (!res.ok) return 0;
  const data = await res.json();
  if (!data || typeof data.mutedUntil !== 'number') {
    throw new Error('Invalid /mute response');
  }
  return data.mutedUntil;
}

export async function fetchActiveMutes({
  contractAddress,
  backendUrl = BACKEND_URL
}) {
  const res = await fetch(
    `${backendUrl}/mutes?contractAddress=${contractAddress}`
  );
  if (!res.ok) return [];
  const data = await res.json();
  if (!data || !Array.isArray(data.mutes)) {
    throw new Error('Invalid /mutes response');
  }
  return data.mutes;
}

/**
 * Fetch list of known templs from backend.
 * @param {string} [backendUrl]
 * @returns {Promise<Array<{contract:string, groupId:string|null, priest:string|null}>>}
 */
export async function listTempls(backendUrl = BACKEND_URL) {
  // In tests, use a simple localStorage-backed registry for stability
  if (isE2ETestEnv()) {
    try {
      const key = 'templ:test:deploys';
      const arr = JSON.parse(localStorage.getItem(key) || '[]');
      const last = localStorage.getItem('templ:lastAddress');
      const all = Array.from(new Set([...(arr || []), ...(last ? [last] : [])]));
      return all.map((a) => ({ contract: a, groupId: null, priest: null }));
    } catch { return []; }
  }
  // Default fallback: backend listing (can be swapped for an on-chain indexer later)
  try {
    const res = await fetch(`${backendUrl}/templs`);
    if (!res.ok) return [];
    const data = await res.json().catch(() => null);
    if (!data || !Array.isArray(data.templs)) return [];
    return data.templs;
  } catch { return []; }
}

/**
 * Read treasury info from contract.
 * @param {{ethers:any, providerOrSigner:any, templAddress:string, templArtifact:any}} params
 */
export async function getTreasuryInfo({ ethers, providerOrSigner, templAddress, templArtifact }) {
  const contract = new ethers.Contract(templAddress, templArtifact.abi, providerOrSigner);
  // tuple: treasury, memberPool, totalReceived, totalBurned, totalProtocolFees, protocolAddress
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

/**
 * Read claimable pool amount for a member.
 * @param {{ethers:any, providerOrSigner:any, templAddress:string, templArtifact:any, memberAddress:string}} params
 */
export async function getClaimable({ ethers, providerOrSigner, templAddress, templArtifact, memberAddress }) {
  const contract = new ethers.Contract(templAddress, templArtifact.abi, providerOrSigner);
  const amount = await contract.getClaimablePoolAmount(memberAddress);
  return BigInt(amount).toString();
}

export async function getExternalRewards({
  ethers,
  providerOrSigner,
  templAddress,
  templArtifact,
  memberAddress
}) {
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

/**
 * Claim member pool rewards for the connected wallet.
 * @param {{ethers:any, signer:any, templAddress:string, templArtifact:any, txOptions?:any}} params
 */
export async function claimMemberPool({ ethers, signer, templAddress, templArtifact, txOptions = {} }) {
  const contract = new ethers.Contract(templAddress, templArtifact.abi, signer);
  const tx = await contract.claimMemberPool(txOptions);
  await tx.wait();
}

export async function claimExternalToken({
  ethers,
  signer,
  templAddress,
  templArtifact,
  token,
  txOptions = {}
}) {
  const contract = new ethers.Contract(templAddress, templArtifact.abi, signer);
  const tx = await contract.claimExternalToken(token, txOptions);
  await tx.wait();
}
