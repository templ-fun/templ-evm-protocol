// @ts-check

// XMTP utility helpers shared across frontend, backend, and tests

// Minimal debug logger usable in both browser and Node environments
const __isDebug = (() => {
  try { if (globalThis?.process?.env?.DEBUG_TEMPL === '1') return true; } catch {}
  try {
    // @ts-ignore - vite injects env on import.meta at build time
    const env = import.meta?.env;
    if (env?.VITE_E2E_DEBUG === '1') return true;
  } catch {}
  return false;
})();
const dlog = (...args) => { if (__isDebug) { try { console.log(...args); } catch {} } };

/**
 * Synchronize XMTP conversations and preferences with optional retries.
 * @param {any} xmtp XMTP client
 * @param {number} [retries=1] Number of attempts
 * @param {number} [delayMs=1000] Delay between attempts in ms
 */
export async function syncXMTP(xmtp, retries = 1, delayMs = 1000) {
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
  let group = null;
  for (let i = 0; i < retries; i++) {
    await syncXMTP(xmtp);
    try {
      group = await xmtp?.conversations?.getConversationById?.(groupId);
    } catch (err) {
      dlog('getConversationById failed:', err?.message || String(err));
    }
    if (!group) {
      try {
        const conversations = await xmtp?.conversations?.list?.({ consentStates: ['allowed','unknown','denied'] }) || [];
        dlog(`Sync attempt ${i + 1}: Found ${conversations.length} conversations; firstIds=`, conversations.slice(0,3).map(c => c.id));
        group = conversations.find(c => c.id === groupId) || null;
      } catch (err) {
        dlog('list conversations failed:', err?.message || String(err));
      }
    }
    if (group) {
      dlog('Found group:', group.id, 'consent state:', group.consentState);
      if (group.consentState !== 'allowed' && typeof group.updateConsentState === 'function') {
        try {
          await group.updateConsentState('allowed');
        } catch (err) {
          dlog('updateConsentState failed:', err?.message || String(err));
        }
      }
      break;
    }
    if (i < retries - 1) await new Promise(r => setTimeout(r, delayMs));
  }
  return group;
}
