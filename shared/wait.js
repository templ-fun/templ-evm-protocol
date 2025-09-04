// @ts-check
import { logger } from './logging.js';

/**
 * Simple sleep helper.
 * @param {number} ms milliseconds to wait
 * @returns {Promise<void>}
 */
export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Linearize: wait until the target inbox is visible on the XMTP network
 * @param {string} inboxId inbox identifier
 * @param {number} [tries=60] number of attempts
 * @returns {Promise<boolean>}
 */
export async function waitForInboxReady(inboxId, tries = 60, Client) {
  const XMTP_ENV =
    (typeof process !== 'undefined' && process.env?.XMTP_ENV) || 'dev';
  const id = String(inboxId || '').replace(/^0x/i, '');
  if (!id) return false;
  if (!['local', 'dev', 'production'].includes(XMTP_ENV)) return true;
  if (
    (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test') ||
    (typeof process !== 'undefined' && process.env?.DISABLE_XMTP_WAIT === '1')
  ) {
    return true;
  }
  if (!Client || typeof Client.inboxStateFromInboxIds !== 'function') return true;
  for (let i = 0; i < tries; i++) {
    try {
      const envOpt = ['local', 'dev', 'production'].includes(XMTP_ENV)
        ? XMTP_ENV
        : 'dev';
      const states = await Client.inboxStateFromInboxIds([id], envOpt);
      logger.info({ inboxId: id, states }, 'Inbox states (inboxStateFromInboxIds)');
      if (Array.isArray(states) && states.length > 0) return true;
    } catch (e) {
      logger.debug(
        { err: String(e?.message || e), inboxId: id },
        'Inbox state check failed'
      );
    }
    await wait(1000);
  }
  return false;
}
