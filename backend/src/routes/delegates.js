import express from 'express';
import { requireAddresses, verifySignature } from '../middleware/validate.js';
import { buildDelegateMessage } from '../../../shared/signing.js';
import { logger } from '../logger.js';

export default function delegatesRouter({ groups, database }) {
  const router = express.Router();

  router.post(
    '/delegates',
    requireAddresses(['contractAddress', 'priestAddress', 'delegateAddress']),
    (req, res, next) => {
      const record = groups.get(req.body.contractAddress.toLowerCase());
      if (!record) return res.status(404).json({ error: 'Unknown Templ' });
      req.record = record;
      next();
    },
    verifySignature(
      'priestAddress',
      (req) => buildDelegateMessage(req.body.contractAddress, req.body.delegateAddress),
      'Only priest can delegate'
    ),
    (req, res) => {
      const { contractAddress, priestAddress, delegateAddress } = req.body;
      const record = /** @type {any} */ (req.record);
      if (record.priest !== priestAddress.toLowerCase()) {
        return res.status(403).json({ error: 'Only priest can delegate' });
      }
      try {
        database
          .prepare(
            'INSERT OR REPLACE INTO delegates (contract, delegate) VALUES (?, ?)'
          )
          .run(contractAddress.toLowerCase(), delegateAddress.toLowerCase());
        res.json({ delegated: true });
      } catch (err) {
        logger.error({ err, contractAddress }, 'Backend /delegates failed');
        res.status(500).json({ error: err.message });
      }
    }
  );

  router.delete(
    '/delegates',
    requireAddresses(['contractAddress', 'priestAddress', 'delegateAddress']),
    (req, res, next) => {
      const record = groups.get(req.body.contractAddress.toLowerCase());
      if (!record) return res.status(404).json({ error: 'Unknown Templ' });
      req.record = record;
      next();
    },
    verifySignature(
      'priestAddress',
      (req) => buildDelegateMessage(req.body.contractAddress, req.body.delegateAddress),
      'Only priest can delegate'
    ),
    (req, res) => {
      const { contractAddress, priestAddress, delegateAddress } = req.body;
      const record = /** @type {any} */ (req.record);
      if (record.priest !== priestAddress.toLowerCase()) {
        return res.status(403).json({ error: 'Only priest can delegate' });
      }
      try {
        database
          .prepare('DELETE FROM delegates WHERE contract = ? AND delegate = ?')
          .run(contractAddress.toLowerCase(), delegateAddress.toLowerCase());
        res.json({ delegated: false });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  return router;
}
