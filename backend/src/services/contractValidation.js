import { ethers } from 'ethers';

function templError(message, statusCode) {
  return Object.assign(new Error(message), { statusCode });
}

const factoryValidationCache = new Map();
const TEMPL_CREATED_TOPIC = ethers.id(
  'TemplCreated(address,address,address,address,uint256,uint256,uint256,uint256,uint256,uint256,address,bool,uint256,string)'
);

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
  try {
    const logs = await provider.getLogs({
      address: factory,
      topics: [TEMPL_CREATED_TOPIC, templTopic]
    });
    if (!logs.length) {
      throw templError('Templ was not deployed by the trusted factory', 403);
    }
  } catch (err) {
    if (err?.statusCode) throw err;
    throw templError('Unable to verify templ factory origin', 400);
  }
  factoryValidationCache.set(cacheKey, true);
}
