import express from 'express';
import { requireAddresses, verifyTypedSignature } from '../middleware/validate.js';
import { buildCreateTypedData } from '../../../shared/signing.js';
import { logger } from '../logger.js';
import { createXmtpWithRotation } from '../xmtp/index.js';
import { registerTempl } from '../services/registerTempl.js';

export default function templsRouter({ xmtp, groups, persist, database, provider, watchContract }) {
  const router = express.Router();
  // Optionally attach provider for contract verification if xmtp exposes it in app context
  // In standalone server we can assign xmtp.provider when creating client; tests may omit.

  // List known templs from persistence (omit groupId unless explicitly requested)
  router.get('/templs', (req, res) => {
    try {
      // If a DB is available, read from it; otherwise enumerate the in-memory map
      /** @type {{ contract: string, groupId: string|null, priest: string|null }[]} */
      let rows = [];
      try {
        if (database?.prepare) {
          rows = database
            .prepare('SELECT contract, groupId, priest FROM groups ORDER BY contract')
            .all()
            .map((r) => ({ contract: r.contract, groupId: r.groupId || null, priest: r.priest || null }));
        }
      } catch {
        rows = [];
      }
      // Merge with any runtime-only groups not yet persisted
      try {
        for (const [contract, rec] of groups.entries()) {
          const key = String(contract).toLowerCase();
          if (!rows.find((r) => r.contract.toLowerCase() === key)) {
            rows.push({ contract: key, groupId: rec.groupId || rec.group?.id || null, priest: rec.priest || null });
          }
        }
      } catch { /* ignore */ }
      const includeGroupId = String(req.query.include || '') === 'groupId';
      const payload = rows.map(r => includeGroupId ? r : ({ contract: r.contract, priest: r.priest || null }));
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
        const chainId = Number(req.body?.chainId || 1337);
        const n = Number(req.body?.nonce);
        const i = Number(req.body?.issuedAt);
        const e = Number(req.body?.expiry);
        const nonce = Number.isFinite(n) ? n : undefined;
        const issuedAt = Number.isFinite(i) ? i : undefined;
        const expiry = Number.isFinite(e) ? e : undefined;
        return buildCreateTypedData({ chainId, contractAddress: req.body.contractAddress.toLowerCase(), nonce, issuedAt, expiry });
      }
    }),
    async (req, res) => {
      try {
        const result = await registerTempl(req.body, {
          xmtp,
          provider,
          groups,
          persist,
          watchContract,
          logger,
          createXmtpWithRotation,
        });
        res.json(result);
      } catch (err) {
        const status = err?.statusCode && Number.isInteger(err.statusCode) ? err.statusCode : 500;
        logger.error({ err, body: req.body }, 'Failed to create group');
        res.status(status).json({ error: err?.message || 'Failed to create group' });
      }
    }
  );

  return router;
}
