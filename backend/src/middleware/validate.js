import { ethers } from 'ethers';

const SIGNATURE_RETENTION_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Create an in-memory signature store with bounded retention to prevent replay attacks.
 * @param {object} [opts]
 * @param {number} [opts.retentionMs]
 */
export function createSignatureStore({ retentionMs = SIGNATURE_RETENTION_MS } = {}) {
  /** @type {Map<string, number>} */
  const entries = new Map();

  function prune(now = Date.now()) {
    const cutoff = now - retentionMs;
    for (const [sig, ts] of entries.entries()) {
      if (ts < cutoff) {
        entries.delete(sig);
      }
    }
  }

  return {
    /**
     * Attempt to record signature usage.
     * @param {string} signature
     * @param {number} [timestamp]
     * @returns {boolean} false when the signature was already used.
     */
    consume(signature, timestamp = Date.now()) {
      prune(timestamp);
      if (entries.has(signature)) {
        return false;
      }
      entries.set(signature, timestamp);
      return true;
    },
    prune
  };
}

const defaultSignatureStore = createSignatureStore();

/**
 * Verify an EIP-712 typed signature and prevent replay using the provided signature store.
 * @param {object} opts
 * @param {ReturnType<typeof createSignatureStore>} [opts.signatureStore]
 * @param {string} opts.addressField
 * @param {(req: import('express').Request) => { domain:any, types:any, primaryType:string, message:any }} opts.buildTyped
 * @param {string} [opts.errorMessage]
 * @returns {import('express').RequestHandler}
 */
export function verifyTypedSignature({ signatureStore = defaultSignatureStore, addressField, buildTyped, errorMessage = 'Bad signature' }) {
  if (!signatureStore || typeof signatureStore.consume !== 'function') {
    throw new Error('verifyTypedSignature requires a signatureStore with a consume() method');
  }

  return function (req, res, next) {
    try {
      const address = String(req.body?.[addressField] || '').toLowerCase();
      const signature = String(req.body?.signature || '');
      if (!address || !signature) return res.status(403).json({ error: errorMessage });

      let domain, types, message;
      try {
        ({ domain, types, message } = buildTyped(req));
      } catch {
        throw new Error('bad typed');
      }

      const now = Date.now();
      if (message?.expiry && Number(message.expiry) < now) {
        return res.status(403).json({ error: 'Signature expired' });
      }

      const recovered = ethers.verifyTypedData(domain, types, message, signature).toLowerCase();
      if (recovered !== address) return res.status(403).json({ error: errorMessage });

      if (!signatureStore.consume(signature, now)) {
        return res.status(409).json({ error: 'Signature already used' });
      }

      next();
    } catch {
      return res.status(403).json({ error: errorMessage });
    }
  };
}

/**
 * Validate that specified fields contain valid Ethereum addresses.
 * Supports fields from either req.body or req.query.
 * @param {string[]} fields
 * @param {string} [errorMessage='Invalid addresses']
 * @returns {import('express').RequestHandler}
 */
export function requireAddresses(fields, errorMessage = 'Invalid addresses') {
  return function (req, res, next) {
    for (const field of fields) {
      const value = req.body?.[field] ?? req.query?.[field];
      if (!ethers.isAddress(value)) {
        return res.status(400).json({ error: errorMessage });
      }
    }
    next();
  };
}

/**
 * Verify that the provided signature was signed by the expected address.
 * @param {string} addressField Field on req.body containing the address
 * @param {(req: import('express').Request) => string} buildMessage Function to build message
 * @param {string} [errorMessage='Bad signature']
 * @returns {import('express').RequestHandler}
 */
export function verifySignature(
  addressField,
  buildMessage,
  errorMessage = 'Bad signature'
) {
  return function (req, res, next) {
    try {
      const address = req.body?.[addressField];
      const { signature } = req.body || {};
      const message = buildMessage(req);
      const recovered = ethers
        .verifyMessage(message, signature)
        .toLowerCase();
      if (recovered !== String(address).toLowerCase()) {
        return res.status(403).json({ error: errorMessage });
      }
      next();
    } catch {
      return res.status(403).json({ error: errorMessage });
    }
  };
}
