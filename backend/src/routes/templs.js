import express from 'express';
import { requireAddresses, verifyTypedSignature } from '../middleware/validate.js';
import { buildCreateTypedData } from '../../../shared/signing.js';
import { logger } from '../logger.js';
import { registerTempl } from '../services/registerTempl.js';
import { extractTypedRequestParams } from './typed.js';

export default function templsRouter({ templs, persist, database, provider, watchContract, saveBinding, removeBinding }) {
  const router = express.Router();

  router.get('/templs', (req, res) => {
    try {
      let rows = [];
      try {
        if (database?.prepare) {
          rows = database
            .prepare('SELECT contract, groupId, priest, homeLink FROM groups ORDER BY contract')
            .all()
            .map((r) => ({
              contract: String(r.contract).toLowerCase(),
              telegramChatId: r.groupId || null,
              priest: r.priest ? String(r.priest).toLowerCase() : null,
              templHomeLink: r.homeLink || ''
            }));
        }
      } catch {
        rows = [];
      }
      try {
        for (const [contract, rec] of templs.entries()) {
          const key = String(contract).toLowerCase();
          if (!rows.find((r) => r.contract === key)) {
            rows.push({
              contract: key,
              telegramChatId: rec.telegramChatId || null,
              priest: rec.priest || null,
              templHomeLink: rec.templHomeLink || ''
            });
          } else {
            const existing = rows.find((r) => r.contract === key);
            if (existing) {
              if (!existing.templHomeLink && rec.templHomeLink) {
                existing.templHomeLink = rec.templHomeLink;
              }
              if (!existing.telegramChatId && rec.telegramChatId) {
                existing.telegramChatId = rec.telegramChatId;
              }
            }
          }
        }
      } catch {/* ignore runtime merge errors */}
      const includeRaw = String(req.query.include || '').toLowerCase();
      const includeChat = includeRaw === 'chatid' || includeRaw === 'groupid';
      const includeHomeLink = includeChat || includeRaw === 'homelink' || includeRaw === 'links';
      const payload = rows.map((r) => {
        const base = { contract: r.contract, priest: r.priest };
        if (includeChat) {
          base.telegramChatId = r.telegramChatId;
          base.groupId = r.telegramChatId; // compatibility field
        }
        if (includeHomeLink) {
          base.templHomeLink = r.templHomeLink || '';
        }
        return base;
      });
      res.json({ templs: payload });
    } catch (err) {
      res.status(500).json({ error: err?.message || String(err) });
    }
  });

  router.post(
    '/templs',
    requireAddresses(['contractAddress', 'priestAddress']),
    verifyTypedSignature({
      database,
      addressField: 'priestAddress',
      buildTyped: (req) => {
        const { chainId, nonce, issuedAt, expiry } = extractTypedRequestParams(req.body);
        return buildCreateTypedData({ chainId, contractAddress: req.body.contractAddress.toLowerCase(), nonce, issuedAt, expiry });
      }
    }),
    async (req, res) => {
      try {
        const result = await registerTempl(req.body, {
          provider,
          logger,
          templs,
          persist,
          watchContract,
          saveBinding,
          removeBinding,
        });
        const { templ, bindingCode } = result;
        res.json({
          contract: templ.contract,
          priest: templ.priest,
          telegramChatId: templ.telegramChatId,
          groupId: templ.telegramChatId,
          templHomeLink: templ.templHomeLink,
          bindingCode
        });
      } catch (err) {
        const status = err?.statusCode && Number.isInteger(err.statusCode) ? err.statusCode : 500;
        logger.error({ err, body: req.body }, 'Failed to register templ');
        res.status(status).json({ error: err?.message || 'Failed to register templ' });
      }
    }
  );

  return router;
}
