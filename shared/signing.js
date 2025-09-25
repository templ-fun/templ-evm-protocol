// @ts-check

import { readTemplEnv } from './debug.js';

/**
 * EIP-712 typed-data builders for all backend-authenticated actions.
 * Domain values should be constructed with the actual chainId. We intentionally
 * do not include a verifyingContract so the domain binds to chain and app name.
 */

const DEFAULT_EXPIRY_MS = 5 * 60_000;

const BASE_FIELDS = [
  { name: 'action', type: 'string' },
  { name: 'contract', type: 'address' },
  { name: 'server', type: 'string' },
  { name: 'nonce', type: 'uint256' },
  { name: 'issuedAt', type: 'uint256' },
  { name: 'expiry', type: 'uint256' }
];

const ACTION_CONFIG = {
  create: {
    primaryType: 'Create',
    types: { Create: BASE_FIELDS },
    buildMessage: ({ contractAddress, server }) => ({
      action: 'create',
      contract: contractAddress,
      server
    })
  },
  join: {
    primaryType: 'Join',
    types: { Join: BASE_FIELDS },
    buildMessage: ({ contractAddress, server }) => ({
      action: 'join',
      contract: contractAddress,
      server
    })
  }
};

function getServerId() {
  const explicit = readTemplEnv('VITE_BACKEND_SERVER_ID') || readTemplEnv('BACKEND_SERVER_ID');
  if (typeof explicit === 'string' && explicit.trim().length > 0) {
    return explicit.trim();
  }
  return 'templ-dev';
}

function buildDomain(chainId) {
  return { name: 'TEMPL', version: '1', chainId };
}

function withTemporalDefaults(message, { nonce, issuedAt, expiry }) {
  const now = Date.now();
  return {
    ...message,
    nonce: Number.isFinite(nonce) ? nonce : message.nonce ?? now,
    issuedAt: Number.isFinite(issuedAt) ? issuedAt : message.issuedAt ?? now,
    expiry: Number.isFinite(expiry) ? expiry : message.expiry ?? now + DEFAULT_EXPIRY_MS
  };
}

function buildTemplTypedData(kind, options) {
  const config = ACTION_CONFIG[kind];
  if (!config) {
    throw new Error(`Unknown templ typed-data action: ${kind}`);
  }
  const server = getServerId();
  const message = config.buildMessage({ ...options, server });
  const finalMessage = withTemporalDefaults(message, options);
  return {
    domain: buildDomain(options.chainId),
    types: config.types,
    primaryType: config.primaryType,
    message: finalMessage
  };
}

/**
 * Build EIP-712 typed data for creating a Templ group.
 */
export function buildCreateTypedData(options) {
  const { contractAddress } = options;
  return buildTemplTypedData('create', { ...options, contractAddress });
}

/**
 * Build EIP-712 typed data for joining a Templ group.
 */
export function buildJoinTypedData(options) {
  const { contractAddress } = options;
  return buildTemplTypedData('join', { ...options, contractAddress });
}

export { buildTemplTypedData };
