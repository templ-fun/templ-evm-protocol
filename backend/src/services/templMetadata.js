import { ethers } from 'ethers';

const METADATA_ABI = [
  'function priest() view returns (address)',
  'function templHomeLink() view returns (string)'
];

function normaliseAddress(value) {
  if (!value) return null;
  try {
    return ethers.getAddress(value).toLowerCase();
  } catch {
    return String(value).toLowerCase();
  }
}

/**
 * Read templ metadata from the contract, falling back gracefully when functions are missing.
 * @param {{ provider?: import('ethers').Provider | null, contractAddress: string, logger?: { warn?: Function, debug?: Function } | null }} params
 */
export async function fetchTemplMetadata({ provider, contractAddress, logger }) {
  const meta = { priest: null, templHomeLink: null };
  if (!provider || !contractAddress) {
    return meta;
  }
  let contract;
  try {
    contract = new ethers.Contract(contractAddress, METADATA_ABI, provider);
  } catch (err) {
    logger?.warn?.({ err: String(err?.message || err), contract: contractAddress }, 'Failed to build templ metadata reader');
    return meta;
  }

  if (contract && typeof contract.priest === 'function') {
    try {
      const value = await contract.priest();
      if (value) {
        meta.priest = normaliseAddress(value);
      }
    } catch (err) {
      logger?.debug?.({ err: String(err?.message || err), contract: contractAddress }, 'templ priest() lookup failed');
    }
  }

  if (contract && typeof contract.templHomeLink === 'function') {
    try {
      const value = await contract.templHomeLink();
      if (value !== undefined && value !== null) {
        meta.templHomeLink = String(value);
      }
    } catch (err) {
      logger?.debug?.({ err: String(err?.message || err), contract: contractAddress }, 'templ templHomeLink() lookup failed');
    }
  }

  return meta;
}
