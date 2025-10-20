// @ts-check

// XMTP utility helpers shared across frontend, backend, and tests

import { waitFor } from './xmtp-wait.js';
import { isTemplDebugEnabled, isTemplE2EDebug } from './debug.js';

// Minimal debug logger usable in both browser and Node environments
const __isDebug = isTemplDebugEnabled();
const dlog = (...args) => { if (__isDebug) { try { console.log(...args); } catch {} } };

/**
 * Synchronize XMTP conversations and preferences with optional retries.
 * @param {any} xmtp XMTP client
 * @param {number} [retries=1] Number of attempts
 * @param {number} [delayMs=1000] Delay between attempts in ms
 */
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

export async function syncXMTP(xmtp, retries = 1, delayMs = 1000) {
  // In e2e fast mode, avoid long retries
  if (isTemplE2EDebug()) {
    retries = Math.min(retries, 2);
    delayMs = Math.min(delayMs, 200);
  }

  dlog(`Starting XMTP sync with ${retries} retries and ${delayMs}ms delay`);

  for (let i = 0; i < retries; i++) {
    let successCount = 0;
    let totalCount = 0;

    // Sync conversations
    totalCount++;
    try {
      await xmtp?.conversations?.sync?.();
      successCount++;
      dlog(`Attempt ${i + 1}: conversations.sync succeeded`);
    } catch (err) {
      dlog(`Attempt ${i + 1}: conversations.sync failed:`, err?.message || String(err));
    }

    // Sync preferences
    totalCount++;
    try {
      await xmtp?.preferences?.sync?.();
      successCount++;
      dlog(`Attempt ${i + 1}: preferences.sync succeeded`);
    } catch (err) {
      dlog(`Attempt ${i + 1}: preferences.sync failed:`, err?.message || String(err));
    }

    // Sync all conversations by consent state
    totalCount++;
    try {
      await xmtp?.conversations?.syncAll?.([
        XMTP_CONSENT_STATES.ALLOWED,
        XMTP_CONSENT_STATES.UNKNOWN,
        XMTP_CONSENT_STATES.DENIED
      ]);
      successCount++;
      dlog(`Attempt ${i + 1}: conversations.syncAll succeeded`);
    } catch (err) {
      dlog(`Attempt ${i + 1}: conversations.syncAll failed:`, err?.message || String(err));
    }

    dlog(`Attempt ${i + 1}: ${successCount}/${totalCount} sync operations succeeded`);

    if (i < retries - 1) {
      dlog(`Waiting ${delayMs}ms before next sync attempt`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }

  dlog('XMTP sync completed');
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

  dlog(`Waiting for conversation ${groupId} with ${retries} retries and ${delayMs}ms delay`);

  const normaliseId = (value) => {
    const raw = (value ?? '').toString().trim();
    const lower = raw.toLowerCase();
    const no0x = lower.replace(/^0x/i, '');
    return { raw, lower, no0x, prefixedLower: lower.startsWith('0x') ? lower : `0x${no0x}` };
  };
  const idsMatch = (candidate, target) => {
    const a = normaliseId(candidate);
    const b = normaliseId(target);
    if (!a.lower || !b.lower) return false;
    return (
      a.lower === b.lower ||
      a.no0x === b.no0x ||
      a.prefixedLower === b.lower ||
      a.lower === b.prefixedLower
    );
  };

  const wanted = normaliseId(groupId);
  const candidateIds = Array.from(new Set([
    wanted.raw,
    wanted.lower,
    wanted.prefixedLower,
    wanted.no0x,
    wanted.no0x ? `0x${wanted.no0x}` : null
  ].filter(Boolean)));

  dlog(`Looking for group conversation with candidate IDs:`, candidateIds);

  const group = await waitFor({
    tries: retries,
    delayMs,
    check: async () => {
      await syncXMTP(xmtp);
      let conv = null;
      let usedMethod = '';

      // Try with exact, 0x-prefixed, and non-0x forms for maximum compatibility
      for (const candidate of candidateIds) {
        if (conv) break;
        usedMethod = `getConversationById(${candidate})`;
        try {
          conv = await xmtp?.conversations?.getConversationById?.(candidate);
          if (conv) {
            dlog(`Found conversation via ${usedMethod}:`, conv.id);
          }
        } catch (err) {
          dlog(`getConversationById(${candidate}) failed:`, err?.message || String(err));
        }
      }

      if (!conv) {
        usedMethod = 'listConversations';
        try {
          const conversations = await xmtp?.conversations?.list?.({
            consentStates: [
              XMTP_CONSENT_STATES.ALLOWED,
              XMTP_CONSENT_STATES.UNKNOWN,
              XMTP_CONSENT_STATES.DENIED
            ],
            conversationType: XMTP_CONVERSATION_TYPES.GROUP
          }) || [];

          dlog(`Sync attempt: Found ${conversations.length} conversations; firstIds=`, conversations.slice(0,3).map(c => c.id));

          conv = conversations.find((c) => idsMatch(c?.id, groupId)) || null;

          if (conv) {
            dlog(`Found conversation via ${usedMethod}:`, conv.id);
          }
        } catch (err) {
          dlog('list conversations failed:', err?.message || String(err));
        }
      }

      if (conv) {
        dlog(`Found group ${conv.id} via ${usedMethod}, consent state:`, conv.consentState);

        // Ensure consent state is allowed
        const consentState = conv.consentState;
        const consentLabel = typeof consentState === 'string' ? consentState.toLowerCase() : String(consentState ?? '').toLowerCase();
        const isAllowed =
          consentState === XMTP_CONSENT_STATES.ALLOWED ||
          consentLabel === 'allowed';

        if (!isAllowed && typeof conv.updateConsentState === 'function') {
          const targetLabel = 'allowed';
          const targetEnum = XMTP_CONSENT_STATES.ALLOWED;
          dlog(`Updating consent state from '${consentState}' to '${targetLabel}' for conversation ${conv.id}`);
          try {
            await conv.updateConsentState(targetEnum);
            dlog('Successfully updated consent state');
          } catch (err) {
            const message = err?.message || String(err);
            dlog('updateConsentState failed:', message);
            // Fallback to string-based API for legacy SDKs
            try {
              await conv.updateConsentState(targetLabel);
              dlog('Successfully updated consent state using string fallback');
            } catch (fallbackErr) {
              dlog('updateConsentState fallback failed:', fallbackErr?.message || String(fallbackErr));
            }
          }
        }

        return conv;
      }

      dlog(`Conversation ${groupId} not found in this attempt, will retry`);
      return null;
    },
    onError: (err) => {
      dlog('waitForConversation check failed:', err?.message || String(err));
    }
  });

  if (group) {
    dlog(`Successfully found and verified conversation ${group.id}`);
  } else {
    dlog(`Failed to find conversation ${groupId} after ${retries} attempts`);
  }

  return group;
}
