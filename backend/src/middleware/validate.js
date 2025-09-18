import { ethers } from 'ethers';

/**
 * Verify an EIP-712 typed signature and prevent replay by tracking signatures in DB.
 * @param {object} opts
 * @param {import('better-sqlite3').Database} opts.database
 * @param {string} opts.addressField - field on req.body containing the address
 * @param {(req: import('express').Request) => { domain:any, types:any, primaryType:string, message:any }} opts.buildTyped
 * @param {string} [opts.errorMessage]
 * @returns {import('express').RequestHandler}
 */
export function verifyTypedSignature({ database, addressField, buildTyped, errorMessage = 'Bad signature' }) {
  // Strict verification path; no header-based bypass in any environment.
  let insertSig = null;
  let hasSig = null;
  try {
    if (database?.prepare) {
      insertSig = database.prepare('INSERT OR IGNORE INTO signatures (sig, usedAt) VALUES (?, ?)');
      hasSig = database.prepare('SELECT 1 FROM signatures WHERE sig = ?');
    }
  } catch { /* ignore - fallback to no-op replay checks */ }
  return function (req, res, next) {
    try {
      const address = String(req.body?.[addressField] || '').toLowerCase();
      const signature = String(req.body?.signature || '');
      // Require both address and signature in all environments
      if (!address || !signature) return res.status(403).json({ error: errorMessage });
      let domain, types, message;
      try {
        ({ domain, types, message } = buildTyped(req));
      } catch {
        throw new Error('bad typed');
      }
      // Basic expiry check if present
      if (message?.expiry && Number(message.expiry) < Date.now()) {
        return res.status(403).json({ error: 'Signature expired' });
      }
      const recovered = ethers.verifyTypedData(domain, types, message, signature).toLowerCase();
      if (recovered !== address) return res.status(403).json({ error: errorMessage });
      // Replay protection: reject reused signatures
      try {
        const seen = hasSig?.get ? hasSig.get(signature) : null;
        if (seen) return res.status(409).json({ error: 'Signature already used' });
      } catch { /* ignore */ }
      try {
        if (insertSig?.run) {
          const usedAt = Date.now();
          const result = insertSig.run(signature, usedAt);
          if (typeof result?.changes === 'number' && result.changes === 0) {
            return res.status(409).json({ error: 'Signature already used' });
          }
        }
      } catch (err) {
        if (err?.code && String(err.code).startsWith('SQLITE_CONSTRAINT')) {
          return res.status(409).json({ error: 'Signature already used' });
        }
        /* ignore other failures */
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
