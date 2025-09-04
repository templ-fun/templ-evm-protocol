import express from 'express';
import { requireAddresses, verifySignature } from '../middleware/validate.js';
import { buildMuteMessage } from '../../../shared/signing.js';

export default function mutesRouter({ groups, database }) {
  const router = express.Router();

  router.post(
    '/mute',
    requireAddresses(['contractAddress', 'moderatorAddress', 'targetAddress']),
    (req, res, next) => {
      const record = groups.get(req.body.contractAddress.toLowerCase());
      if (!record) return res.status(404).json({ error: 'Unknown Templ' });
      req.record = record;
      next();
    },
    verifySignature(
      'moderatorAddress',
      (req) => buildMuteMessage(req.body.contractAddress, req.body.targetAddress)
    ),
    async (req, res) => {
      const { contractAddress, moderatorAddress, targetAddress } = req.body;
      const record = /** @type {any} */ (req.record);
      const contractKey = contractAddress.toLowerCase();
      const actorKey = moderatorAddress.toLowerCase();
      const delegated = database
        .prepare('SELECT 1 FROM delegates WHERE contract = ? AND delegate = ?')
        .get(contractKey, actorKey);
      if (record.priest !== actorKey && !delegated) {
        return res
          .status(403)
          .json({ error: 'Only priest or delegate can mute' });
      }
      try {
        const targetKey = targetAddress.toLowerCase();
        const existing = database
          .prepare(
            'SELECT count FROM mutes WHERE contract = ? AND target = ?'
          )
          .get(contractKey, targetKey);
        const count = (existing?.count ?? 0) + 1;
        const durations = [3600e3, 86400e3, 7 * 86400e3, 30 * 86400e3];
        const now = Date.now();
        const until =
          count <= durations.length ? now + durations[count - 1] : 0;
        database
          .prepare(
            'INSERT OR REPLACE INTO mutes (contract, target, count, until) VALUES (?, ?, ?, ?)'
          )
          .run(contractKey, targetKey, count, until);
        res.json({ mutedUntil: until });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    }
  );

  router.get('/mutes', requireAddresses(['contractAddress']), (req, res) => {
    const { contractAddress } = req.query;
    const now = Date.now();
    const rows = database
      .prepare(
        'SELECT target, count, until FROM mutes WHERE contract = ? AND (until = 0 OR until > ?)'
      )
      .all(contractAddress.toLowerCase(), now);
    res.json({
      mutes: rows.map((r) => ({ address: r.target, count: r.count, until: r.until }))
    });
  });

  return router;
}
