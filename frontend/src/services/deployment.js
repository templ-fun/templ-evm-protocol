// @ts-check
import { BACKEND_URL } from '../config.js';
import { buildCreateTypedData, buildRebindTypedData } from '../../../shared/signing.js';
import { addToTestRegistry, dlog } from './utils.js';
import { postJson } from './http.js';

function toBigInt(value, label) {
  try {
    return BigInt(value);
  } catch {
    throw new Error(`Invalid ${label}`);
  }
}

function validateSplit({ burnPercent, treasuryPercent, memberPoolPercent, protocolPercent }) {
  const burnPercentValue = Number(burnPercent ?? 30);
  const treasuryPercentValue = Number(treasuryPercent ?? 30);
  const memberPercentValue = Number(memberPoolPercent ?? 30);
  const protocolPercentValue = Number(protocolPercent ?? 10);
  const total = burnPercentValue + treasuryPercentValue + memberPercentValue + protocolPercentValue;
  if (total !== 100) {
    throw new Error(`Fee split must equal 100 (received ${total})`);
  }
  const toBps = (value) => Math.round(value * 100);
  return {
    burn: toBps(burnPercentValue),
    treasury: toBps(treasuryPercentValue),
    member: toBps(memberPercentValue)
  };
}

async function deployContract({
  ethers,
  signer,
  walletAddress,
  factoryAddress,
  factoryArtifact,
  templArtifact,
  tokenAddress,
  entryFee,
  burnPercent,
  treasuryPercent,
  memberPoolPercent,
  protocolPercent,
  quorumPercent,
  maxMembers = 0,
  priestIsDictator = false,
  templHomeLink = '',
  txOptions = {}
}) {
  if (!ethers || !signer || !walletAddress) {
    throw new Error('deployTempl requires connected wallet');
  }
  if (!factoryAddress || !factoryArtifact?.abi) {
    throw new Error('TemplFactory configuration missing');
  }
  if (!templArtifact?.abi) {
    throw new Error('Templ artifact missing');
  }
  const { burn, treasury, member } = validateSplit({ burnPercent, treasuryPercent, memberPoolPercent, protocolPercent });
  const normalizedEntryFee = toBigInt(entryFee ?? 0, 'entry fee');
  const normalizedMaxMembers = toBigInt(maxMembers ?? 0, 'max members');
  const normalizedQuorumPercent = (() => {
    const raw = quorumPercent ?? 0;
    const resolved = Number(raw);
    if (!Number.isFinite(resolved) || resolved < 0) {
      throw new Error('Invalid quorum percent');
    }
    return Math.round(resolved * 100);
  })();
  const factory = new ethers.Contract(factoryAddress, factoryArtifact.abi, signer);
  const config = {
    priest: walletAddress,
    token: tokenAddress,
    entryFee: normalizedEntryFee,
    burnPercent: burn,
    treasuryPercent: treasury,
    memberPoolPercent: member,
    quorumPercent: normalizedQuorumPercent,
    executionDelaySeconds: 0,
    burnAddress: ethers.ZeroAddress ?? '0x0000000000000000000000000000000000000000',
    priestIsDictator: priestIsDictator === true,
    maxMembers: normalizedMaxMembers,
    homeLink: templHomeLink || ''
  };

  const templAddress = await factory.createTemplWithConfig.staticCall(config);
  const tx = await factory.createTemplWithConfig(config, txOptions);
  await tx.wait();
  dlog('deployContract: templ deployed', templAddress);
  addToTestRegistry?.(templAddress);
  return templAddress;
}

export async function registerTemplBackend({
  signer,
  walletAddress,
  templAddress,
  backendUrl = BACKEND_URL,
  telegramChatId,
  templHomeLink
}) {
  if (!templAddress) {
    throw new Error('registerTemplBackend requires templAddress');
  }
  let priest = walletAddress;
  if (!priest && signer?.getAddress) {
    priest = await signer.getAddress();
  }
  if (!priest) {
    throw new Error('registerTemplBackend requires priest wallet address');
  }
  const chain = await signer.provider?.getNetwork?.();
  const chainId = Number(chain?.chainId || 1337);
  const typed = buildCreateTypedData({ chainId, contractAddress: templAddress.toLowerCase() });
  const signature = await signer.signTypedData(typed.domain, typed.types, typed.message);
  const payload = {
    contractAddress: templAddress,
    priestAddress: priest,
    signature,
    chainId,
    nonce: typed.message.nonce,
    issuedAt: typed.message.issuedAt,
    expiry: typed.message.expiry,
    telegramChatId: telegramChatId || undefined,
    templHomeLink: templHomeLink || undefined
  };
  const res = await postJson(`${backendUrl}/templs`, payload);
  if (res.status === 409) {
    const retryTyped = buildCreateTypedData({ chainId, contractAddress: templAddress.toLowerCase(), nonce: Date.now() });
    const retrySig = await signer.signTypedData(retryTyped.domain, retryTyped.types, retryTyped.message);
    const retryPayload = {
      contractAddress: templAddress,
      priestAddress: priest,
      signature: retrySig,
      chainId,
      nonce: retryTyped.message.nonce,
      issuedAt: retryTyped.message.issuedAt,
      expiry: retryTyped.message.expiry,
      telegramChatId: telegramChatId || undefined,
      templHomeLink: templHomeLink || undefined
    };
    const retryRes = await postJson(`${backendUrl}/templs`, retryPayload);
    if (!retryRes.ok) {
      throw new Error(`Templ registration failed: ${retryRes.status} ${retryRes.statusText}`);
    }
    return retryRes.json();
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Templ registration failed: ${res.status} ${res.statusText} ${body}`.trim());
  }
  return res.json();
}

export async function deployTempl({
  ethers,
  signer,
  walletAddress,
  factoryAddress,
  factoryArtifact,
  templArtifact,
  tokenAddress,
  entryFee,
  burnPercent,
  treasuryPercent,
  memberPoolPercent,
  protocolPercent,
  quorumPercent,
  maxMembers,
  priestIsDictator,
  backendUrl = BACKEND_URL,
  telegramChatId,
  templHomeLink,
  txOptions = {}
}) {
  const templAddress = await deployContract({
    ethers,
    signer,
    walletAddress,
    factoryAddress,
    factoryArtifact,
    templArtifact,
    tokenAddress,
    entryFee,
    burnPercent,
    treasuryPercent,
    memberPoolPercent,
    protocolPercent,
    quorumPercent,
    maxMembers,
    priestIsDictator,
    templHomeLink,
    txOptions
  });

  const registration = await registerTemplBackend({
    signer,
    walletAddress,
    templAddress,
    backendUrl,
    telegramChatId,
    templHomeLink
  });

  return { templAddress, registration };
}

export async function requestTemplRebindBackend({
  signer,
  walletAddress,
  templAddress,
  backendUrl = BACKEND_URL
}) {
  if (!templAddress) {
    throw new Error('requestTemplRebindBackend requires templAddress');
  }
  if (!signer) {
    throw new Error('requestTemplRebindBackend requires connected wallet');
  }
  let priest = walletAddress;
  if (!priest && signer?.getAddress) {
    priest = await signer.getAddress();
  }
  if (!priest) {
    throw new Error('Missing priest address');
  }
  const chain = await signer.provider?.getNetwork?.();
  const chainId = Number(chain?.chainId || 1337);
  const typed = buildRebindTypedData({ chainId, contractAddress: templAddress.toLowerCase() });
  const signature = await signer.signTypedData(typed.domain, typed.types, typed.message);
  const payload = {
    contractAddress: templAddress,
    priestAddress: priest,
    signature,
    chainId,
    nonce: typed.message.nonce,
    issuedAt: typed.message.issuedAt,
    expiry: typed.message.expiry
  };
  let res = await postJson(`${backendUrl}/templs/rebind`, payload);
  if (res.status === 409) {
    const retryTyped = buildRebindTypedData({ chainId, contractAddress: templAddress.toLowerCase(), nonce: Date.now() });
    const retrySignature = await signer.signTypedData(retryTyped.domain, retryTyped.types, retryTyped.message);
    const retryPayload = {
      contractAddress: templAddress,
      priestAddress: priest,
      signature: retrySignature,
      chainId,
      nonce: retryTyped.message.nonce,
      issuedAt: retryTyped.message.issuedAt,
      expiry: retryTyped.message.expiry
    };
    res = await postJson(`${backendUrl}/templs/rebind`, retryPayload);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Rebind failed: ${res.status} ${res.statusText} ${body}`.trim());
  }
  return res.json();
}
