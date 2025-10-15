// XMTP helper functions
import { ethers } from 'ethers';
import { Client } from '@xmtp/node-sdk';
import { waitFor } from '../../../shared/xmtp-wait.js';
import { XMTP_CONSENT_STATES } from '../../../shared/xmtp.js';
import { logger } from '../logger.js';
import { resolveXmtpEnv } from './options.js';

const resolvedEnv = resolveXmtpEnv();
export const XMTP_ENV = /** @type {'local' | 'dev' | 'production'} */ (
  ['local', 'dev', 'production'].includes(resolvedEnv) ? resolvedEnv : 'dev'
);

// Linearize: wait until the target inbox is visible on the XMTP network
export async function waitForInboxReady(inboxId, tries = 60) {
  const id = String(inboxId || '').replace(/^0x/i, '');
  if (!id) return false;
  if (!['local', 'dev', 'production'].includes(XMTP_ENV)) return true;
  if (process.env.NODE_ENV === 'test' || process.env.DISABLE_XMTP_WAIT === '1') return true;
  if (typeof Client.inboxStateFromInboxIds !== 'function') return true;
  const envOpt = /** @type {any} */ (
    ['local', 'dev', 'production'].includes(XMTP_ENV) ? XMTP_ENV : 'dev'
  );
  const result = await waitFor({
    tries,
    delayMs: 1000,
    check: async () => {
      const states = await Client.inboxStateFromInboxIds([id], envOpt);
      logger.info({ inboxId: id, states }, 'Inbox states (inboxStateFromInboxIds)');
      return Array.isArray(states) && states.length > 0;
    },
    onError: (e) => {
      logger.debug(
        { err: String(e?.message || e), inboxId: id },
        'Inbox state check failed'
      );
    }
  });
  return Boolean(result);
}

export async function createXmtpWithRotation(wallet, maxAttempts = 20) {
  // Derive a stable 32-byte SQLCipher key for the XMTP Node DB.
  // Priority: explicit BACKEND_DB_ENC_KEY (hex) -> keccak256(privateKey + env) -> zero key (last resort)
  let dbEncryptionKey;
  try {
    const explicit = process.env.BACKEND_DB_ENC_KEY;
    if (explicit && /^0x?[0-9a-fA-F]{64}$/.test(String(explicit))) {
      const hex = explicit.startsWith('0x') ? explicit : `0x${explicit}`;
      dbEncryptionKey = ethers.getBytes(hex);
    } else if (wallet?.privateKey) {
      const env = resolveXmtpEnv();
      const material = ethers.concat([ethers.getBytes(wallet.privateKey), ethers.toUtf8Bytes(`:${env}:templ-db-key`) ]);
      const keyHex = ethers.keccak256(material);
      dbEncryptionKey = ethers.getBytes(keyHex);
    } else {
      // In production, do not allow zero-key fallback
      if (process.env.NODE_ENV === 'production') {
        throw new Error('BACKEND_DB_ENC_KEY required in production');
      }
      // Fallback zeroed key in non-prod; logged for visibility only
      logger.warn('Using fallback zeroed dbEncryptionKey; set BACKEND_DB_ENC_KEY for security');
      dbEncryptionKey = new Uint8Array(32);
    }
  } catch {
    dbEncryptionKey = new Uint8Array(32);
  }
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    /** @type {import('@xmtp/node-sdk').Signer} */
    const xmtpSigner = /** @type {import('@xmtp/node-sdk').Signer} */ ({
      type: 'EOA',
      getIdentifier: () => ({
        identifier: wallet.address.toLowerCase(),
        identifierKind: 0, // Ethereum enum
        nonce: attempt
      }),
      signMessage: async (message) => {
        const messageToSign = typeof message === 'string' ? message : String(message);
        const signature = await wallet.signMessage(messageToSign);
        return ethers.getBytes(signature);
      }
    });
    try {
      // @ts-ignore - Node SDK accepts EOA-like signers; our JS object matches at runtime
      const env = XMTP_ENV;
      // @ts-ignore - TS cannot discriminate the 'EOA' literal on JS object; safe at runtime
      const loggingLevel = /** @type {any} */ (
        process.env.XMTP_LOG_LEVEL ||
        (process.env.NODE_ENV === 'production' ? 'warn' : 'debug')
      );
      const structuredLogging = process.env.XMTP_STRUCTURED_LOGGING === '1';
      const appVersion = process.env.XMTP_APP_VERSION || 'templ/1.0.1';
      const apiUrl = process.env.XMTP_API_URL;
      if (apiUrl) {
        logger.info({ apiUrl }, 'XMTP using custom API URL override');
      }
      return await Client.create(xmtpSigner, {
        dbEncryptionKey,
        env,
        loggingLevel,
        structuredLogging,
        appVersion,
        ...(apiUrl ? { apiUrl } : {})
      });
    } catch (err) {
      const msg = String(err?.message || err);
      if (msg.includes('already registered 10/10 installations')) {
        logger.warn({ attempt }, 'XMTP installation limit reached, rotating inbox');
        continue;
      }
      throw err;
    }
  }
  throw new Error('Unable to register XMTP client after nonce rotation');
}

// Wait for the XMTP client to be able to talk to the network deterministically.
export async function waitForXmtpClientReady(xmtp, tries = 30, delayMs = 500) {
  const env = resolveXmtpEnv();
  return Boolean(await waitFor({
    tries,
    delayMs,
    check: async () => {
      try { await xmtp?.preferences?.inboxState?.(true); } catch { /* ignore */ }
      try { await xmtp?.conversations?.sync?.(); } catch { /* ignore */ }
      try {
        // Attempt a lightweight API call via debug info or list
        const agg = await xmtp?.debugInformation?.apiAggregateStatistics?.();
        if (typeof agg === 'string' && agg.includes('Api Stats')) return true;
      } catch { /* ignore */ }
      try {
        const list = await xmtp?.conversations?.list?.({
          consentStates: [
            XMTP_CONSENT_STATES.ALLOWED,
            XMTP_CONSENT_STATES.UNKNOWN,
            XMTP_CONSENT_STATES.DENIED
          ]
        });
        if (Array.isArray(list)) return true;
      } catch { /* ignore */ }
      // As a last resort, try the static inboxId mapping endpoint
      try {
        const id = String(xmtp?.inboxId || '').replace(/^0x/i, '');
        if (id && typeof Client.inboxStateFromInboxIds === 'function') {
          const envOpt = /** @type {any} */ (['local','dev','production'].includes(env) ? env : 'dev');
          const states = await Client.inboxStateFromInboxIds([id], envOpt);
          if (Array.isArray(states)) return true;
        }
      } catch { /* ignore */ }
      return false;
    }
  }));
}
