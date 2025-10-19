import { ethers } from 'ethers';

export const XMTP_CONSENT_STATE_VALUES = [
  'allowed',
  'unknown',
  'denied'
];

export const XMTP_GROUP_CONVERSATION_TYPE = 'group';
export const XMTP_SYNC_CONVERSATION_TYPE = 'sync';

export const XMTP_TIMEOUT_MS = 30000; // 30 seconds default
export const XMTP_DEV_TIMEOUT_MS = 60000; // 60 seconds for dev environment
export const XMTP_RETRY_DELAYS = [1000, 2000, 5000, 10000];

export function normalizeAddressLower(address) {
  if (!address) return '';
  const raw = typeof address === 'string' ? address.trim() : String(address || '').trim();
  if (!raw) return '';
  try {
    return ethers.getAddress(raw).toLowerCase();
  } catch {
    if (ethers.isAddress(raw)) {
      try {
        return ethers.getAddress(raw).toLowerCase();
      } catch {
        return raw.toLowerCase();
      }
    }
  }
  return '';
}

export function extractKeyPackageStatus(statuses, installationId) {
  if (!statuses) return null;
  const target = String(installationId || '');
  const candidates = [target, target.toLowerCase(), target.replace(/^0x/i, '')];
  const matchKey = (key) => {
    if (!key) return false;
    const val = String(key);
    return candidates.includes(val) || candidates.includes(val.toLowerCase()) || candidates.includes(val.replace(/^0x/i, ''));
  };
  if (statuses instanceof Map) {
    for (const [key, value] of statuses.entries()) {
      if (matchKey(key)) return value;
    }
    return null;
  }
  if (Array.isArray(statuses)) {
    for (const entry of statuses) {
      if (!entry) continue;
      if (Array.isArray(entry) && entry.length >= 2) {
        const [key, value] = entry;
        if (matchKey(key)) return value;
      } else if (entry.installationId || entry.id) {
        const key = entry.installationId || entry.id;
        if (matchKey(key)) return entry;
      }
    }
    return null;
  }
  if (typeof statuses === 'object') {
    for (const key of Object.keys(statuses)) {
      if (matchKey(key)) return statuses[key];
    }
  }
  return null;
}

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, typeof ms === 'number' && ms > 0 ? ms : 0));
}

export function resolveXmtpEnv() {
  if (typeof window !== 'undefined' && window?.import?.meta?.env) {
    const forced = window.import.meta.env.VITE_XMTP_ENV?.trim();
    if (forced) return forced;
    if (['localhost', '127.0.0.1'].includes(window.location.hostname)) {
      return 'dev';
    }
  }
  return 'production';
}

export function createReinstallError(details = 'Missing XMTP installation metadata') {
  const error = new Error(details);
  error.name = 'XMTP_REINSTALL';
  return error;
}

export function isMissingInstallationError(err) {
  if (!err) return false;
  const message = String(err?.message || err);
  if (!message) return false;
  const normalized = message.toLowerCase();
  if (normalized.includes('missing installation')) return true;
  if (normalized.includes('installation metadata')) return true;
  if (normalized.includes('installation not found')) return true;
  return message.includes('Database(NotFound');
}