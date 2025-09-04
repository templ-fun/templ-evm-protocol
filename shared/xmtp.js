// @ts-check

// XMTP utility helpers shared across frontend, backend, and tests
import { logger } from './logging.js';
import { wait } from './wait.js';

/**
 * Synchronize XMTP conversations and preferences with optional retries.
 * @param {any} xmtp XMTP client
 * @param {number} [retries=1] Number of attempts
 * @param {number} [delayMs=1000] Delay between attempts in ms
 */
export async function syncXMTP(xmtp, retries = 1, delayMs = 1000) {
  for (let i = 0; i < retries; i++) {
    try { await xmtp?.conversations?.sync?.(); } catch (err) {
      logger.debug('conversations.sync failed:', err?.message || String(err));
    }
    try { await xmtp?.preferences?.sync?.(); } catch (err) {
      logger.debug('preferences.sync failed:', err?.message || String(err));
    }
    try { await xmtp?.conversations?.syncAll?.(['allowed','unknown','denied']); } catch (err) {
      logger.debug('conversations.syncAll failed:', err?.message || String(err));
    }
    if (i < retries - 1) await wait(delayMs);
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
  let group = null;
  for (let i = 0; i < retries; i++) {
    await syncXMTP(xmtp);
    try {
      group = await xmtp?.conversations?.getConversationById?.(groupId);
    } catch (err) {
      logger.debug('getConversationById failed:', err?.message || String(err));
    }
    if (!group) {
      try {
        const conversations = await xmtp?.conversations?.list?.({ consentStates: ['allowed','unknown','denied'] }) || [];
        logger.debug(`Sync attempt ${i + 1}: Found ${conversations.length} conversations; firstIds=`, conversations.slice(0,3).map(c => c.id));
        group = conversations.find(c => c.id === groupId) || null;
      } catch (err) {
        logger.debug('list conversations failed:', err?.message || String(err));
      }
    }
    if (group) {
      logger.debug('Found group:', group.id, 'consent state:', group.consentState);
      if (group.consentState !== 'allowed' && typeof group.updateConsentState === 'function') {
        try {
          await group.updateConsentState('allowed');
        } catch (err) {
          logger.debug('updateConsentState failed:', err?.message || String(err));
        }
      }
      break;
    }
    if (i < retries - 1) await wait(delayMs);
  }
  return group;
}
