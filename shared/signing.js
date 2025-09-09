// @ts-check

/**
 * EIP-712 typed-data builders for all backend-authenticated actions.
 * Domain values should be constructed with the actual chainId. We intentionally
 * do not include a verifyingContract so the domain binds to chain and app name.
 */

function getServerId() {
  try {
    // Browser (Vite)
    // @ts-ignore
    const env = import.meta?.env;
    // @ts-ignore
    const v = env?.VITE_BACKEND_SERVER_ID;
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  } catch {}
  try {
    // Node (or any JS env with process on globalThis)
    const g = /** @type {any} */ (globalThis);
    const v = g?.process?.env?.BACKEND_SERVER_ID;
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  } catch {}
  return 'templ-dev';
}

/**
 * Build EIP-712 typed data for creating a TEMPL group.
 * @param {object} p
 * @param {number} p.chainId
 * @param {string} p.contractAddress
 * @param {number} [p.nonce] - client-provided unique number to prevent replay
 * @param {number} [p.issuedAt] - ms epoch
 * @param {number} [p.expiry] - ms epoch
 */
export function buildCreateTypedData({ chainId, contractAddress, nonce, issuedAt, expiry }) {
  if (!Number.isFinite(nonce)) nonce = Date.now();
  if (!Number.isFinite(issuedAt)) issuedAt = Date.now();
  if (!Number.isFinite(expiry)) expiry = Date.now() + 5 * 60_000;
  const domain = { name: 'TEMPL', version: '1', chainId };
  const types = {
    Create: [
      { name: 'action', type: 'string' },
      { name: 'contract', type: 'address' },
      { name: 'server', type: 'string' },
      { name: 'nonce', type: 'uint256' },
      { name: 'issuedAt', type: 'uint256' },
      { name: 'expiry', type: 'uint256' },
    ]
  };
  const message = {
    action: 'create',
    contract: contractAddress,
    server: getServerId(),
    nonce,
    issuedAt,
    expiry,
  };
  return { domain, types, primaryType: 'Create', message };
}

/**
 * Build EIP-712 typed data for joining a TEMPL group.
 * @param {object} p
 * @param {number} p.chainId
 * @param {string} p.contractAddress
 * @param {number} [p.nonce]
 * @param {number} [p.issuedAt]
 * @param {number} [p.expiry]
 */
export function buildJoinTypedData({ chainId, contractAddress, nonce, issuedAt, expiry }) {
  if (!Number.isFinite(nonce)) nonce = Date.now();
  if (!Number.isFinite(issuedAt)) issuedAt = Date.now();
  if (!Number.isFinite(expiry)) expiry = Date.now() + 5 * 60_000;
  const domain = { name: 'TEMPL', version: '1', chainId };
  const types = {
    Join: [
      { name: 'action', type: 'string' },
      { name: 'contract', type: 'address' },
      { name: 'server', type: 'string' },
      { name: 'nonce', type: 'uint256' },
      { name: 'issuedAt', type: 'uint256' },
      { name: 'expiry', type: 'uint256' },
    ]
  };
  const message = {
    action: 'join',
    contract: contractAddress,
    server: getServerId(),
    nonce,
    issuedAt,
    expiry,
  };
  return { domain, types, primaryType: 'Join', message };
}

/**
 * Build EIP-712 typed data for delegate-mute action.
 * @param {object} p
 * @param {number} p.chainId
 * @param {string} p.contractAddress
 * @param {string} p.delegateAddress
 * @param {number} [p.nonce]
 * @param {number} [p.issuedAt]
 * @param {number} [p.expiry]
 */
export function buildDelegateTypedData({ chainId, contractAddress, delegateAddress, nonce, issuedAt, expiry }) {
  if (!Number.isFinite(nonce)) nonce = Date.now();
  if (!Number.isFinite(issuedAt)) issuedAt = Date.now();
  if (!Number.isFinite(expiry)) expiry = Date.now() + 5 * 60_000;
  const domain = { name: 'TEMPL', version: '1', chainId };
  const types = {
    DelegateMute: [
      { name: 'action', type: 'string' },
      { name: 'contract', type: 'address' },
      { name: 'delegate', type: 'address' },
      { name: 'server', type: 'string' },
      { name: 'nonce', type: 'uint256' },
      { name: 'issuedAt', type: 'uint256' },
      { name: 'expiry', type: 'uint256' },
    ]
  };
  const message = {
    action: 'delegateMute',
    contract: contractAddress,
    delegate: delegateAddress,
    server: getServerId(),
    nonce,
    issuedAt,
    expiry,
  };
  return { domain, types, primaryType: 'DelegateMute', message };
}

/**
 * Build EIP-712 typed data for mute action.
 * @param {object} p
 * @param {number} p.chainId
 * @param {string} p.contractAddress
 * @param {string} p.targetAddress
 * @param {number} [p.nonce]
 * @param {number} [p.issuedAt]
 * @param {number} [p.expiry]
 */
export function buildMuteTypedData({ chainId, contractAddress, targetAddress, nonce, issuedAt, expiry }) {
  if (!Number.isFinite(nonce)) nonce = Date.now();
  if (!Number.isFinite(issuedAt)) issuedAt = Date.now();
  if (!Number.isFinite(expiry)) expiry = Date.now() + 5 * 60_000;
  const domain = { name: 'TEMPL', version: '1', chainId };
  const types = {
    Mute: [
      { name: 'action', type: 'string' },
      { name: 'contract', type: 'address' },
      { name: 'target', type: 'address' },
      { name: 'server', type: 'string' },
      { name: 'nonce', type: 'uint256' },
      { name: 'issuedAt', type: 'uint256' },
      { name: 'expiry', type: 'uint256' },
    ]
  };
  const message = {
    action: 'mute',
    contract: contractAddress,
    target: targetAddress,
    server: getServerId(),
    nonce,
    issuedAt,
    expiry,
  };
  return { domain, types, primaryType: 'Mute', message };
}

// String builders retained for compatibility; default flows use typed data.
export function buildDelegateMessage(contract, delegate) {
  return `delegate:${contract.toLowerCase()}:${delegate.toLowerCase()}`;
}
export function buildMuteMessage(contract, target) {
  return `mute:${contract.toLowerCase()}:${target.toLowerCase()}`;
}
