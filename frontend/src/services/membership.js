// @ts-check
import { BACKEND_URL } from '../config.js';
import { buildJoinTypedData } from '../../../shared/signing.js';
import { dlog } from './utils.js';
import { postJson } from './http.js';

async function ensureAllowance({ ethers, signer, owner, token, spender, amount, txOptions }) {
  const zero = (ethers?.ZeroAddress ?? '0x0000000000000000000000000000000000000000').toLowerCase();
  if (!token || String(token).toLowerCase() === zero) {
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
  const current = BigInt(await erc20.allowance(owner, spender));
  if (current >= amount) {
    return txOptions;
  }
  const approval = await erc20.approve(spender, amount, { ...txOptions, value: undefined });
  await approval.wait();
  const next = { ...txOptions };
  if (approval?.nonce !== undefined && approval?.nonce !== null) {
    const raw = typeof approval.nonce === 'bigint' ? Number(approval.nonce) : approval.nonce;
    if (Number.isFinite(raw)) {
      next.nonce = raw + 1;
    }
  }
  return next;
}

export async function purchaseAccess({
  ethers,
  signer,
  templAddress,
  templArtifact,
  tokenAddress,
  entryFee,
  walletAddress,
  txOptions = {}
}) {
  if (!ethers || !signer || !templAddress || !templArtifact?.abi) {
    throw new Error('purchaseAccess requires templ configuration');
  }
  const contract = new ethers.Contract(templAddress, templArtifact.abi, signer);
  let member = walletAddress;
  if (!member && signer?.getAddress) {
    member = await signer.getAddress();
  }
  if (!member) {
    throw new Error('Wallet not connected');
  }
  try {
    if (typeof contract.hasAccess === 'function') {
      const already = await contract.hasAccess(member);
      if (already) {
        dlog('purchaseAccess: member already has access');
        return { purchased: false };
      }
    }
  } catch {}

  let entryFeeValue;
  if (entryFee !== undefined && entryFee !== null) {
    entryFeeValue = BigInt(entryFee);
  } else {
    entryFeeValue = BigInt(await contract.entryFee());
  }
  let accessToken = tokenAddress;
  if (!accessToken) {
    try { accessToken = await contract.accessToken(); } catch {}
  }
  if (!accessToken) {
    throw new Error('Unable to resolve templ access token');
  }

  const overrides = await ensureAllowance({
    ethers,
    signer,
    owner: member,
    token: accessToken,
    spender: templAddress,
    amount: entryFeeValue,
    txOptions
  });

  const tx = await contract.purchaseAccess(overrides);
  await tx.wait();
  return { purchased: true };
}

export async function verifyMembership({
  signer,
  templAddress,
  walletAddress,
  backendUrl = BACKEND_URL
}) {
  if (!templAddress) {
    throw new Error('verifyMembership requires templ address');
  }
  let member = walletAddress;
  if (!member && signer?.getAddress) {
    member = await signer.getAddress();
  }
  if (!member) {
    throw new Error('Wallet not connected');
  }
  const chain = await signer.provider?.getNetwork?.();
  const chainId = Number(chain?.chainId || 1337);
  const typed = buildJoinTypedData({ chainId, contractAddress: templAddress.toLowerCase() });
  const signature = await signer.signTypedData(typed.domain, typed.types, typed.message);
  const payload = {
    contractAddress: templAddress,
    memberAddress: member,
    signature,
    chainId,
    nonce: typed.message.nonce,
    issuedAt: typed.message.issuedAt,
    expiry: typed.message.expiry
  };
  const res = await postJson(`${backendUrl}/join`, payload);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Join failed: ${res.status} ${res.statusText} ${body}`.trim());
  }
  return res.json();
}

export async function fetchMemberPoolStats({
  ethers,
  signer,
  templAddress,
  templArtifact,
  memberAddress
}) {
  if (!ethers || !signer || !templAddress || !templArtifact?.abi) {
    throw new Error('fetchMemberPoolStats requires signer and templ configuration');
  }
  const contract = new ethers.Contract(templAddress, templArtifact.abi, signer);
  const poolBalance = await contract.memberPoolBalance();
  let memberClaimed = 0n;
  if (memberAddress) {
    try {
      memberClaimed = await contract.memberPoolClaims(memberAddress);
    } catch {
      memberClaimed = 0n;
    }
  }
  return {
    poolBalance: poolBalance?.toString?.() ?? String(poolBalance),
    memberClaimed: memberClaimed?.toString?.() ?? String(memberClaimed)
  };
}

export async function claimMemberRewards({
  ethers,
  signer,
  templAddress,
  templArtifact,
  walletAddress,
  txOptions = {}
}) {
  if (!ethers || !signer || !templAddress || !templArtifact?.abi) {
    throw new Error('claimMemberRewards requires templ configuration');
  }
  if (!walletAddress && signer?.getAddress) {
    walletAddress = await signer.getAddress();
  }
  if (!walletAddress) {
    throw new Error('claimMemberRewards requires connected wallet');
  }
  const contract = new ethers.Contract(templAddress, templArtifact.abi, signer);
  const tx = await contract.claimMemberPool(txOptions);
  await tx.wait();
  return true;
}
