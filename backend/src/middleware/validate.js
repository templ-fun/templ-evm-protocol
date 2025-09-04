import { ethers } from 'ethers';

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
