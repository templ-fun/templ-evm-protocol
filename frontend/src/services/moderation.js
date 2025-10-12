// @ts-check
import { BACKEND_URL } from '../config.js';
import { buildDelegateTypedData, buildMuteTypedData } from '@shared/signing.js';

export async function delegateMute({ signer, contractAddress, priestAddress, delegateAddress, backendUrl = BACKEND_URL }) {
  const network = await signer.provider?.getNetwork?.();
  const chainId = Number(network?.chainId || 1337);
  const typed = buildDelegateTypedData({ chainId, contractAddress, delegateAddress });
  const signature = await signer.signTypedData(typed.domain, typed.types, typed.message);
  const res = await fetch(`${backendUrl}/delegateMute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contractAddress,
      priestAddress,
      delegateAddress,
      signature,
      chainId,
      nonce: typed.message.nonce,
      issuedAt: typed.message.issuedAt,
      expiry: typed.message.expiry
    })
  });
  if (!res.ok) return false;
  const data = await res.json();
  if (!data || typeof data.delegated !== 'boolean') {
    throw new Error('Invalid /delegateMute response');
  }
  return data.delegated;
}

export async function muteMember({ signer, contractAddress, moderatorAddress, targetAddress, backendUrl = BACKEND_URL }) {
  const network = await signer.provider?.getNetwork?.();
  const chainId = Number(network?.chainId || 1337);
  const typed = buildMuteTypedData({ chainId, contractAddress, targetAddress });
  const signature = await signer.signTypedData(typed.domain, typed.types, typed.message);
  const res = await fetch(`${backendUrl}/mute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contractAddress,
      moderatorAddress,
      targetAddress,
      signature,
      chainId,
      nonce: typed.message.nonce,
      issuedAt: typed.message.issuedAt,
      expiry: typed.message.expiry
    })
  });
  if (!res.ok) return 0;
  const data = await res.json();
  if (!data || typeof data.mutedUntil !== 'number') {
    throw new Error('Invalid /mute response');
  }
  return data.mutedUntil;
}

export async function fetchActiveMutes({ contractAddress, backendUrl = BACKEND_URL }) {
  const res = await fetch(`${backendUrl}/mutes?contractAddress=${contractAddress}`);
  if (!res.ok) return [];
  const data = await res.json();
  if (!data || !Array.isArray(data.mutes)) {
    throw new Error('Invalid /mutes response');
  }
  return data.mutes;
}

export async function fetchDelegates({ contractAddress, backendUrl = BACKEND_URL }) {
  const res = await fetch(`${backendUrl}/delegates?contractAddress=${contractAddress}`);
  if (!res.ok) return [];
  const data = await res.json();
  if (!data || !Array.isArray(data.delegates)) {
    throw new Error('Invalid /delegates response');
  }
  return data.delegates;
}
