import { ethers } from 'ethers';

function templError(message, statusCode) {
  return Object.assign(new Error(message), { statusCode });
}

const factoryValidationCache = new Map();
const TEMPL_CREATED_TOPIC = ethers.id(
  'TemplCreated(address,address,address,address,uint256,uint256,uint256,uint256,uint256,uint256,address,bool,uint256,string)'
);
const DEFAULT_FACTORY_LOG_CHUNK = 200_000;

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

export async function ensureTemplFromFactory({ provider, contractAddress, factoryAddress }) {
  if (!factoryAddress) return;
  if (!provider) {
    throw templError('Factory verification required but no provider configured', 500);
  }
  const normalizedFactory = factoryAddress.toLowerCase();
  const normalizedTempl = contractAddress.toLowerCase();
  const cacheKey = `${normalizedFactory}:${normalizedTempl}`;
  if (factoryValidationCache.get(cacheKey)) {
    return;
  }
  let templAddress;
  let factory;
  try {
    templAddress = ethers.getAddress(contractAddress);
    factory = ethers.getAddress(factoryAddress);
  } catch {
    throw templError('Invalid address provided for factory verification', 400);
  }

  const templTopic = ethers.zeroPadValue(templAddress, 32);
  const startBlockEnv = process.env.TRUSTED_FACTORY_DEPLOYMENT_BLOCK?.trim();
  let startBlock = 0;
  if (startBlockEnv) {
    const parsed = Number(startBlockEnv);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw templError('Invalid TRUSTED_FACTORY_DEPLOYMENT_BLOCK', 400);
    }
    startBlock = Math.floor(parsed);
  }
  const chunkEnv = process.env.TRUSTED_FACTORY_LOG_CHUNK?.trim();
  let chunkSize = DEFAULT_FACTORY_LOG_CHUNK;
  if (chunkEnv) {
    const parsed = Number(chunkEnv);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw templError('Invalid TRUSTED_FACTORY_LOG_CHUNK', 400);
    }
    chunkSize = Math.floor(parsed);
  }
  let latestBlock;
  try {
    latestBlock = await provider.getBlockNumber();
  } catch (err) {
    if (err?.statusCode) throw err;
    throw templError('Unable to verify templ factory origin', 400);
  }
  if (startBlock > latestBlock) {
    startBlock = latestBlock;
  }
  let fromBlock = startBlock;
  while (fromBlock <= latestBlock) {
    const toBlock = Math.min(latestBlock, fromBlock + chunkSize - 1);
    let logs;
    try {
      logs = await provider.getLogs({
        address: factory,
        topics: [TEMPL_CREATED_TOPIC, templTopic],
        fromBlock,
        toBlock
      });
    } catch (err) {
      if (err?.statusCode) throw err;
      throw templError('Unable to verify templ factory origin', 400);
    }
    if (logs.length) {
      factoryValidationCache.set(cacheKey, true);
      return;
    }
    if (toBlock == latestBlock) {
      break;
    }
    fromBlock = toBlock + 1;
  }
  throw templError('Templ was not deployed by the trusted factory', 403);
}
