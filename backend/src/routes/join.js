import express from 'express';
import { requireAddresses, verifyTypedSignature } from '../middleware/validate.js';
import { buildJoinTypedData } from '../../../shared/signing.js';
import { logger } from '../logger.js';
import { joinTempl } from '../services/joinTempl.js';
import { extractTypedRequestParams } from './typed.js';

export default function joinRouter({ xmtp, groups, hasPurchased, lastJoin, database, provider, ensureGroup }) {
  const router = express.Router();
  // (no DISABLE_WAIT flags here; production-safe logic below)

  router.post(
    '/join',
    requireAddresses(['contractAddress', 'memberAddress']),
    verifyTypedSignature({
      database,
      addressField: 'memberAddress',
      buildTyped: (req) => {
        const { chainId, nonce, issuedAt, expiry } = extractTypedRequestParams(req.body);
        return buildJoinTypedData({ chainId, contractAddress: req.body.contractAddress.toLowerCase(), nonce, issuedAt, expiry });
      }
    }),
    async (req, res) => {
      try {
        const result = await joinTempl(req.body, {
          hasPurchased,
          groups,
          logger,
          lastJoin,
          database,
          provider,
          xmtp,
          ensureGroup,
        });
        res.json(result);
      } catch (err) {
        const status = err?.statusCode && Number.isInteger(err.statusCode) ? err.statusCode : 500;
        logger.error({ err, contractAddress: req.body?.contractAddress }, 'Join failed');
        res.status(status).json({ error: err?.message || 'Join failed' });
      }
    }
  );

  return router;
}
