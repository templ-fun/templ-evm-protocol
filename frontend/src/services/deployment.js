// @ts-check
import { BACKEND_URL } from '../config.js';
import { buildRebindTypedData } from '../../../shared/signing.js';
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

  let templAddress;
  try {
    templAddress = await factory.createTemplWithConfig.staticCall(config);
  } catch (err) {
    if (err?.code !== 'BAD_DATA') {
      throw err;
    }
    console.warn('[templ] Failed to preview templ address via staticCall, falling back to receipt parsing', err);
  }
  const tx = await factory.createTemplWithConfig(config, txOptions);
  const receipt = await tx.wait();

  if (!templAddress) {
    const templCreatedTopics = [
      'TemplCreated(address,address,address,address,uint256,uint256,uint256,uint256,uint256,uint256,address,bool,uint256,string)',
      'TemplCreated(address,address,address,address,uint256,uint256,uint256,uint256,uint256,uint256,address,bool,uint256)'
    ].map((signature) => ethers.id(signature).toLowerCase());

    const factoryAddressLower = factoryAddress?.toLowerCase?.() ?? '';

    const topicToAddress = (topic) => {
      if (typeof topic !== 'string' || topic.length !== 66) {
        throw new Error('invalid topic');
      }
      return ethers.getAddress(`0x${topic.slice(26)}`);
    };

    const parseLogs = (logs = []) => {
      for (const log of logs) {
        if (!log) continue;
        const logAddress = (log.address || '').toLowerCase();
        if (factoryAddressLower && logAddress !== factoryAddressLower) {
          continue;
        }
        const topics = Array.isArray(log.topics) ? log.topics : [];
        if (topics.length < 2) {
          continue;
        }
        const topic0 = (topics[0] || '').toLowerCase();
        const matchesKnownSignature = templCreatedTopics.includes(topic0);
        if (!matchesKnownSignature && topics.length < 2) {
          continue;
        }
        try {
          const candidate = topicToAddress(topics[1]);
          templAddress = candidate;
          return true;
        } catch {
          /* ignore parse errors */
        }
      }
      return false;
    };

    if (!parseLogs(receipt?.logs || [])) {
      try {
        const provider = signer?.provider;
        const blockHash = receipt?.blockHash;
        if (provider?.getLogs && blockHash) {
          const fallbackLogs = await provider.getLogs({
            address: factoryAddress,
            blockHash
          });
          parseLogs(
            fallbackLogs.filter((log) => !log?.transactionHash || log.transactionHash === tx.hash)
          );
        }
      } catch (err) {
        console.warn('[templ] Failed to recover templ address from provider logs', err);
      }
    }
  }

  if (!templAddress) {
    const txHash = tx?.hash || receipt?.transactionHash || 'unknown';
    throw new Error(
      `Templ deployment succeeded but the contract address was not returned. Check the transaction receipt for TemplCreated (tx: ${txHash}).`
    );
  }

  let normalized = templAddress;
  if (typeof templAddress === 'string') {
    try {
      normalized = ethers.getAddress ? ethers.getAddress(templAddress) : templAddress;
    } catch {
      normalized = templAddress;
    }
  }
  dlog('deployContract: templ deployed', normalized);
  addToTestRegistry?.(normalized);
  return normalized;
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

  let registration = null;
  try {
    registration = await autoRegisterTemplBackend({
      templAddress,
      backendUrl
    });
  } catch (err) {
    console.warn('[templ] Auto registration failed', err);
  }

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

export async function autoRegisterTemplBackend({ templAddress, backendUrl = BACKEND_URL }) {
  if (!templAddress) {
    throw new Error('autoRegisterTemplBackend requires templAddress');
  }
  const payload = {
    contractAddress: templAddress
  };
  const res = await postJson(`${backendUrl}/templs/auto`, payload);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Templ auto registration failed: ${res.status} ${res.statusText} ${body}`.trim());
  }
  return res.json();
}
