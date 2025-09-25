// @ts-check
import { BACKEND_URL } from '../config.js';
import { buildCreateTypedData } from '../../../shared/signing.js';
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
  const burn = Number(burnPercent ?? 30);
  const treasury = Number(treasuryPercent ?? 30);
  const member = Number(memberPoolPercent ?? 30);
  const protocol = Number(protocolPercent ?? 10);
  const total = burn + treasury + member + protocol;
  if (total !== 100) {
    throw new Error(`Fee split must equal 100 (received ${total})`);
  }
  return { burn, treasury, member, protocol };
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
  maxMembers = 0,
  priestIsDictator = false,
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
  const factory = new ethers.Contract(factoryAddress, factoryArtifact.abi, signer);
  const config = {
    priest: walletAddress,
    token: tokenAddress,
    entryFee: normalizedEntryFee,
    burnPercent: burn,
    treasuryPercent: treasury,
    memberPoolPercent: member,
    burnAddress: ethers.ZeroAddress ?? '0x0000000000000000000000000000000000000000',
    priestIsDictator: priestIsDictator === true,
    maxMembers: normalizedMaxMembers
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
  telegramChatId
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
    telegramChatId: telegramChatId || undefined
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
      telegramChatId: telegramChatId || undefined
    };
    const retryRes = await postJson(`${backendUrl}/templs`, retryPayload);
    if (!retryRes.ok) {
      throw new Error(`Templ registration failed: ${retryRes.status} ${retryRes.statusText}`);
    }
    return true;
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Templ registration failed: ${res.status} ${res.statusText} ${body}`.trim());
  }
  return true;
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
  maxMembers,
  priestIsDictator,
  backendUrl = BACKEND_URL,
  telegramChatId,
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
    maxMembers,
    priestIsDictator,
    txOptions
  });

  await registerTemplBackend({
    signer,
    walletAddress,
    templAddress,
    backendUrl,
    telegramChatId
  });

  return { templAddress };
}
