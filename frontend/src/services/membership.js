// @ts-check
import { BACKEND_URL } from '../config.js';
import { buildJoinTypedData } from '../../../shared/signing.js';
import { dlog } from './utils.js';
import { postJson } from './http.js';

const ERC20_ABI = [
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 value) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)'
];

function resolveCustomErrorName(err) {
  if (!err) return null;
  if (err.errorName && typeof err.errorName === 'string') return err.errorName;
  if (typeof err.shortMessage === 'string') {
    if (err.shortMessage.includes('MemberLimitReached')) return 'MemberLimitReached';
    if (err.shortMessage.includes('DisbandLockActive')) return 'DisbandLockActive';
  }
  const data = err.data ?? err.error?.data;
  if (data && typeof data === 'object') {
    if (typeof data.errorName === 'string') return data.errorName;
    if (typeof data.message === 'string') {
      if (data.message.includes('MemberLimitReached')) return 'MemberLimitReached';
      if (data.message.includes('DisbandLockActive')) return 'DisbandLockActive';
    }
  }
  if (typeof err.reason === 'string') {
    if (err.reason.includes('MemberLimitReached')) return 'MemberLimitReached';
    if (err.reason.includes('DisbandLockActive')) return 'DisbandLockActive';
  }
  return null;
}

function translateJoinCallError(err) {
  const name = resolveCustomErrorName(err);
  if (name === 'MemberLimitReached') {
    return new Error('Membership is currently capped. Governance must raise or clear the limit before new joins succeed.');
  }
  if (name === 'DisbandLockActive') {
    return new Error('This templ is disbanding. New joins are locked until the proposal resolves.');
  }
  return err instanceof Error ? err : new Error(err?.message ?? 'Join transaction failed');
}

async function resolveMemberAddress({ signer, walletAddress }) {
  if (walletAddress) return walletAddress;
  if (signer?.getAddress) {
    return await signer.getAddress();
  }
  return null;
}

function formatTokenAmount(ethers, value, decimals) {
  try {
    return ethers.formatUnits(value, decimals);
  } catch {
    return value.toString();
  }
}

export async function loadEntryRequirements({
  ethers,
  templAddress,
  templArtifact,
  signer,
  provider,
  walletAddress
}) {
  if (!ethers || !templAddress || !templArtifact?.abi) {
    throw new Error('loadEntryRequirements requires templ configuration');
  }
  const readProvider = signer ?? provider;
  if (!readProvider) {
    throw new Error('No provider available to read templ data');
  }
  let normalizedTemplAddress = templAddress;
  if (ethers.getAddress) {
    normalizedTemplAddress = ethers.getAddress(templAddress);
  }
  const templContract = new ethers.Contract(normalizedTemplAddress, templArtifact.abi, readProvider);
  const [entryFeeRaw, accessToken] = await Promise.all([
    templContract.entryFee(),
    templContract.accessToken()
  ]);
  const entryFee = typeof entryFeeRaw === 'bigint' ? entryFeeRaw : BigInt(entryFeeRaw || 0);
  const tokenAddress = accessToken ? ethers.getAddress?.(accessToken) ?? accessToken : '';

  if (!tokenAddress) {
    throw new Error('Unable to resolve templ access token');
  }

  const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, readProvider);
  let symbol = '';
  let decimals = 18;
  try {
    const [rawSymbol, rawDecimals] = await Promise.all([
      tokenContract.symbol().catch(() => ''),
      tokenContract.decimals().catch(() => 18)
    ]);
    if (typeof rawSymbol === 'string') symbol = rawSymbol.trim();
    const parsedDecimals = Number(rawDecimals);
    if (Number.isFinite(parsedDecimals) && parsedDecimals >= 0 && parsedDecimals <= 36) {
      decimals = parsedDecimals;
    }
  } catch {}

  const ownerAddress = await resolveMemberAddress({ signer, walletAddress });
  let allowance = null;
  let balance = null;
  if (ownerAddress) {
    const allowanceResult = await tokenContract.allowance(ownerAddress, normalizedTemplAddress).catch(() => null);
    if (allowanceResult !== null && allowanceResult !== undefined) {
      allowance = typeof allowanceResult === 'bigint' ? allowanceResult : BigInt(allowanceResult);
    }
    const balanceResult = await tokenContract.balanceOf(ownerAddress).catch(() => null);
    if (balanceResult !== null && balanceResult !== undefined) {
      balance = typeof balanceResult === 'bigint' ? balanceResult : BigInt(balanceResult);
    }
  }

  return {
    entryFeeWei: entryFee.toString(),
    entryFeeFormatted: formatTokenAmount(ethers, entryFee, decimals),
    tokenAddress,
    tokenSymbol: symbol,
    tokenDecimals: decimals,
    allowanceWei: allowance?.toString() ?? null,
    allowanceFormatted: allowance !== null ? formatTokenAmount(ethers, allowance, decimals) : null,
    balanceWei: balance?.toString() ?? null,
    balanceFormatted: balance !== null ? formatTokenAmount(ethers, balance, decimals) : null
  };
}

export async function approveEntryFee({
  ethers,
  signer,
  templAddress,
  tokenAddress,
  amount,
  walletAddress
}) {
  if (!ethers || !signer || !templAddress || !tokenAddress) {
    throw new Error('approveEntryFee requires templ and token configuration');
  }
  const normalizedTemplAddress = ethers.getAddress?.(templAddress) ?? templAddress;
  const normalizedTokenAddress = ethers.getAddress?.(tokenAddress) ?? tokenAddress;
  const owner = await resolveMemberAddress({ signer, walletAddress });
  if (!owner) {
    throw new Error('Wallet not connected');
  }
  const token = new ethers.Contract(normalizedTokenAddress, ERC20_ABI, signer);
  const approval = await token.approve(normalizedTemplAddress, BigInt(amount));
  await approval.wait();
  return true;
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
  let normalizedTemplAddress;
  try {
    normalizedTemplAddress = ethers.getAddress?.(templAddress) ?? templAddress;
  } catch {
    throw new Error('Invalid templ address provided');
  }
  try {
    const code = await signer.provider?.getCode?.(normalizedTemplAddress);
    if (code === '0x') {
      console.warn('[templ] No bytecode at templ address', normalizedTemplAddress);
    }
  } catch (err) {
    if (err?.code && err.code !== 'BAD_REQUEST' && err?.code !== 'CALL_EXCEPTION') {
      console.warn('[templ] Failed to resolve templ bytecode presence', err);
    }
  }
  const contract = new ethers.Contract(normalizedTemplAddress, templArtifact.abi, signer);
  const member = await resolveMemberAddress({ signer, walletAddress });
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
    try {
      entryFeeValue = BigInt(await contract.entryFee());
    } catch (err) {
      if (err?.code === 'BAD_DATA' && err?.value === '0x') {
        throw new Error('Templ did not return an entry fee. Confirm the address or supply an entry fee override.');
      }
      throw err;
    }
  }
  let accessToken = tokenAddress;
  if (!accessToken) {
    try {
      accessToken = await contract.accessToken();
    } catch (err) {
      if (err?.code === 'BAD_DATA' && err?.value === '0x') {
        throw new Error('Provided address does not expose templ access data. Double-check you are using a Templ contract address.');
      }
      throw err;
    }
  }
  if (!accessToken) {
    throw new Error('Unable to resolve templ access token');
  }

  const normalizedTokenAddress = ethers.getAddress?.(accessToken) ?? accessToken;
  const token = new ethers.Contract(normalizedTokenAddress, ERC20_ABI, signer);
  const allowanceRaw = await token.allowance(member, normalizedTemplAddress);
  const allowance = typeof allowanceRaw === 'bigint' ? allowanceRaw : BigInt(allowanceRaw || 0);
  if (allowance < entryFeeValue) {
    throw new Error('Allowance is lower than the entry fee. Approve the entry fee amount before purchasing.');
  }
  const overrides = { ...txOptions };

  let tx;
  try {
    tx = await contract.purchaseAccess(overrides);
  } catch (err) {
    const translated = translateJoinCallError(err);
    if (translated !== err) {
      throw translated;
    }
    if (err?.code === 'CALL_EXCEPTION' && !err?.data) {
      throw new Error('Access token transfer failed. Ensure you hold the entry fee amount of the access token and try again.');
    }
    throw translated;
  }
  try {
    await tx.wait();
  } catch (err) {
    const translated = translateJoinCallError(err);
    if (translated !== err) {
      throw translated;
    }
    if (err?.code === 'CALL_EXCEPTION' && !err?.data) {
      throw new Error('Access token transfer failed during confirmation. Double-check your token balance and allowance.');
    }
    throw translated;
  }
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
