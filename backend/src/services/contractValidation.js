import { ethers } from 'ethers';

function templError(message, statusCode) {
  return Object.assign(new Error(message), { statusCode });
}

const factoryValidationCache = new Map();
const TEMPL_CREATED_TOPIC = ethers.id(
  'TemplCreated(address,address,address,address,uint256,uint256,uint256,uint256,uint256,uint256,address,bool,uint256,string)'
);
const DEFAULT_LOG_CHUNK_SIZE = 100_000;

function parseBlockNumber(value) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 0 ? 0 : Math.floor(value);
  }
  if (typeof value === 'bigint') {
    if (value < 0n) return 0;
    const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
    const safeValue = value > maxSafe ? maxSafe : value;
    return Number(safeValue);
  }
  const trimmed = String(value).trim();
  if (!trimmed) {
    return null;
  }
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed < 0 ? 0 : parsed;
}

async function findFactoryLogs({ provider, factory, templTopic, fromBlock, chunkSize = DEFAULT_LOG_CHUNK_SIZE }) {
  let start = Number.isFinite(fromBlock) && fromBlock >= 0 ? Math.floor(fromBlock) : 0;
  let latest;
  try {
    latest = Number(await provider.getBlockNumber());
  } catch (err) {
    if (err?.statusCode) throw err;
    throw templError('Unable to verify templ factory origin', 400);
  }
  if (!Number.isFinite(latest) || latest < start) {
    latest = start;
  }
  let window = Number.isFinite(chunkSize) && chunkSize > 0 ? Math.floor(chunkSize) : DEFAULT_LOG_CHUNK_SIZE;
  if (window < 1) {
    window = 1;
  }
  while (start <= latest) {
    const end = Math.min(start + window - 1, latest);
    try {
      const logs = await provider.getLogs({
        address: factory,
        topics: [TEMPL_CREATED_TOPIC, templTopic],
        fromBlock: start,
        toBlock: end
      });
      if (logs.length) {
        return logs;
      }
      start = end + 1;
    } catch (err) {
      if (err?.statusCode) throw err;
      if (window <= 1) {
        throw templError('Unable to verify templ factory origin', 400);
      }
      window = Math.max(1, Math.floor(window / 2));
      continue;
    }
  }
  return [];
}

export async function ensureContractDeployed({ provider, contractAddress, chainId }) {
  if (!provider) {
    throw templError('Verification required but no provider configured', 500);
  }
  try {
    if (Number.isFinite(chainId)) {
      const network = await provider.getNetwork();
      const expectedChainId = Number(network.chainId);
      if (expectedChainId !== Number(chainId)) {
        throw templError('ChainId mismatch', 400);
      }
    }
  } catch (err) {
    if (err?.statusCode) throw err;
  }
  let code;
  try {
    code = await provider.getCode(contractAddress);
  } catch {
    throw templError('Unable to verify contract', 400);
  }
  if (!code || code === '0x') {
    throw templError('Not a contract', 400);
  }
}

export async function ensurePriestMatchesOnChain({ provider, contractAddress, priestAddress }) {
  if (!provider) {
    throw templError('Verification required but no provider configured', 500);
  }
  try {
    const contract = new ethers.Contract(contractAddress, ['function priest() view returns (address)'], provider);
    const onchainPriest = (await contract.priest())?.toLowerCase?.();
    if (onchainPriest !== priestAddress.toLowerCase()) {
      throw templError('Priest does not match on-chain', 403);
    }
  } catch (err) {
    if (err?.statusCode) throw err;
    throw templError('Unable to verify priest on-chain', 400);
  }
}

export async function ensureTemplFromFactory(options = {}) {
  const { provider, contractAddress, factoryAddress, fromBlock, chunkSize } = options;
  if (!factoryAddress) return;
  if (!provider) {
    throw templError('Factory verification required but no provider configured', 500);
  }
  let templAddress;
  let factory;
  try {
    templAddress = ethers.getAddress(contractAddress);
    factory = ethers.getAddress(factoryAddress);
  } catch {
    throw templError('Invalid address provided for factory verification', 400);
  }
  const cacheKey = `${factory.toLowerCase()}:${templAddress.toLowerCase()}`;
  if (factoryValidationCache.get(cacheKey)) {
    return;
  }
  const envFromBlock = parseBlockNumber(process.env.TRUSTED_FACTORY_DEPLOYMENT_BLOCK);
  const explicitFromBlock = parseBlockNumber(fromBlock);
  const startBlock = explicitFromBlock ?? envFromBlock ?? 0;

  const templTopic = ethers.zeroPadValue(templAddress, 32);
  const logs = await findFactoryLogs({
    provider,
    factory,
    templTopic,
    fromBlock: startBlock,
    chunkSize
  });
  if (!logs.length) {
    throw templError('Templ was not deployed by the trusted factory', 403);
  }
  factoryValidationCache.set(cacheKey, true);
}
