import express from 'express';
import { requireAddresses, verifyTypedSignature } from '../middleware/validate.js';
import { buildJoinTypedData } from '../../../shared/signing.js';
import { logger } from '../logger.js';
import { joinTempl } from '../services/joinTempl.js';
import { extractTypedRequestParams } from './typed.js';

export default function joinRouter({ hasJoined, templs, signatureStore, xmtp, lastJoin, provider, ensureGroup }) {
  const router = express.Router();

  router.post(
    '/join',
    requireAddresses(['contractAddress', 'memberAddress']),
    verifyTypedSignature({
      signatureStore,
      addressField: 'memberAddress',
      buildTyped: (req) => {
        const { chainId, nonce, issuedAt, expiry } = extractTypedRequestParams(req.body);
        return buildJoinTypedData({ chainId, contractAddress: req.body.contractAddress.toLowerCase(), nonce, issuedAt, expiry });
      }
    }),
    async (req, res) => {
      try {
        // Use XMTP join service if XMTP is enabled and the request includes XMTP-specific fields
        const useXmtp = xmtp && (req.body.inboxId || req.body.memberInboxId || process.env.XMTP_ENABLED === '1');

        let result;
        if (useXmtp) {
          // Dynamically import XMTP join service when needed
          const { joinTemplWithXmtp } = await import('../services/xmtpJoinService.js');
          result = await joinTemplWithXmtp(req.body, {
            hasJoined,
            templs,
            logger,
            lastJoin,
            provider,
            xmtp,
            ensureGroup
          });
        } else {
          result = await joinTempl(req.body, {
            hasJoined,
            templs,
            logger,
          });
        }

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
