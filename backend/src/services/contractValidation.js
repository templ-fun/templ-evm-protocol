import { ethers } from 'ethers';

function templError(message, statusCode) {
  return Object.assign(new Error(message), { statusCode });
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
