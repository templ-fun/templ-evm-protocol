// @ts-check

// XMTP utility helpers shared across frontend, backend, and tests

import { waitFor } from './xmtp-wait.js';
import { isTemplDebugEnabled, isTemplE2EDebug } from './debug.js';

// Minimal debug logger usable in both browser and Node environments
const __isDebug = isTemplDebugEnabled();
const dlog = (...args) => { if (__isDebug) { try { console.log(...args); } catch {} } };

export const XMTP_CONSENT_STATES = {
  UNKNOWN: 0,
  ALLOWED: 1,
  DENIED: 2
};

export const XMTP_CONVERSATION_TYPES = {
  DM: 0,
  GROUP: 1,
  SYNC: 2
};

/**
 * Derive the standard templ group name given a contract address.
 * @param {string} [contractAddress]
 * @returns {string}
 */
export function deriveTemplGroupName(contractAddress) {
  if (!contractAddress) return 'templ';
  const raw = String(contractAddress).trim();
  if (!raw) return 'templ';
  const bareHex = /^[0-9a-fA-F]{40}$/;
  const prefixedHex = /^0x[0-9a-fA-F]{40}$/;
  let normalized = raw;
  if (bareHex.test(raw)) {
    normalized = `0x${raw}`;
  }
  if (prefixedHex.test(normalized)) {
    const lower = normalized.toLowerCase();
    const prefix = lower.slice(0, 10);
    return prefix ? `templ:${prefix}` : 'templ';
  }
  const lower = raw.toLowerCase();
  if (lower.startsWith('templ:')) return lower;
  const fallback = lower.startsWith('0x') ? lower.slice(0, 10) : lower.slice(0, Math.min(10, lower.length));
  return fallback ? `templ:${fallback}` : 'templ';
}

/**
 * Synchronize XMTP conversations and preferences with optional retries.
 * @param {any} xmtp XMTP client
 * @param {number} [retries=1] Number of attempts
 * @param {number} [delayMs=1000] Delay between attempts in ms
 */
export async function syncXMTP(xmtp, retries = 1, delayMs = 1000) {
  // In e2e fast mode, avoid long retries
  if (isTemplE2EDebug()) {
    retries = Math.min(retries, 2);
    delayMs = Math.min(delayMs, 200);
  }
  for (let i = 0; i < retries; i++) {
    try { await xmtp?.conversations?.sync?.(); } catch (err) {
      dlog('conversations.sync failed:', err?.message || String(err));
    }
    try { await xmtp?.preferences?.sync?.(); } catch (err) {
      dlog('preferences.sync failed:', err?.message || String(err));
    }
    try { await xmtp?.conversations?.syncAll?.(['allowed','unknown','denied']); } catch (err) {
      dlog('conversations.syncAll failed:', err?.message || String(err));
    }
    if (i < retries - 1) await new Promise(r => setTimeout(r, delayMs));
  }
}

/**
 * Wait for a conversation by ID, syncing XMTP between attempts.
 * @param {object} params
 * @param {any} params.xmtp XMTP client
 * @param {string} params.groupId Conversation ID to search for
 * @param {number} [params.retries=60] Number of attempts
 * @param {number} [params.delayMs=1000] Delay between attempts in ms
 * @returns {Promise<any|null>} Conversation if found, else null
 */
export async function waitForConversation({ xmtp, groupId, retries = 60, delayMs = 1000 }) {
  // Fast mode for tests/dev
  if (isTemplE2EDebug()) {
    retries = Math.min(retries, 5);
    delayMs = Math.min(delayMs, 200);
  }
  const norm = (id) => (id || '').toString();
  const wantedRaw = norm(groupId);
  const wantedNo0x = wantedRaw.replace(/^0x/i, '');
  const wanted0x = wantedRaw.startsWith('0x') ? wantedRaw : `0x${wantedNo0x}`;
  const group = await waitFor({
    tries: retries,
    delayMs,
    check: async () => {
      await syncXMTP(xmtp);
      let conv = null;
      // Try with exact, 0x-prefixed, and non-0x forms for maximum compatibility
      for (const candidate of [wantedRaw, wanted0x, wantedNo0x]) {
        if (conv) break;
        try {
          conv = await xmtp?.conversations?.getConversationById?.(candidate);
        } catch (err) {
          dlog('getConversationById failed:', err?.message || String(err));
        }
      }
      if (!conv) {
        try {
          const conversations = await xmtp?.conversations?.list?.({ consentStates: ['allowed','unknown','denied'], conversationType: 1 /* Group */ }) || [];
          dlog(`Sync attempt: Found ${conversations.length} conversations; firstIds=`, conversations.slice(0,3).map(c => c.id));
          conv = conversations.find(c => {
            const cid = String(c.id);
            return cid === wantedRaw || cid === wanted0x || cid === wantedNo0x || `0x${cid}` === wanted0x || cid.replace(/^0x/i,'') === wantedNo0x;
          }) || null;
        } catch (err) {
          dlog('list conversations failed:', err?.message || String(err));
        }
      }
      if (conv) {
        dlog('Found group:', conv.id, 'consent state:', conv.consentState);
        if (conv.consentState !== 'allowed' && typeof conv.updateConsentState === 'function') {
          try {
            await conv.updateConsentState('allowed');
          } catch (err) {
            dlog('updateConsentState failed:', err?.message || String(err));
          }
        }
        return conv;
      }
      return null;
    }
  });
  return group;
}
