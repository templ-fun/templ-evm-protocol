import express from 'express';
import { requireAddresses } from '../middleware/validate.js';
import { syncXMTP } from '../../../shared/xmtp.js';
import { Client } from '@xmtp/node-sdk';
import { XMTP_ENV } from '../xmtp/index.js';
import { logger } from '../logger.js';

export default function debugRouter({ xmtp, groups, lastJoin }) {
  const router = express.Router();

  router.get(
    '/debug/membership',
    requireAddresses(['contractAddress'], 'Invalid contractAddress'),
    async (req, res) => {
      try {
        const contractAddress = String(
          req.query.contractAddress || ''
        ).toLowerCase();
        const who = String(req.query.inboxId || '').replace(/^0x/i, '');
        const record = groups.get(contractAddress);
        if (!record) return res.status(404).json({ error: 'Unknown Templ' });
        const info = {
          contract: contractAddress,
          serverInboxId: xmtp?.inboxId || null,
          groupId: record.group?.id || record.groupId || null,
          members: null,
          contains: null,
        };
        try {
          await syncXMTP(xmtp);
          const members = Array.isArray(record.group?.members)
            ? record.group.members
            : [];
          // Emit members only on debug endpoint; keep as-is
          info.members = members;
          info.contains = who ? members.includes(who) : null;
        } catch (e) {
          logger.warn({ e }, 'membership debug failed');
        }
        res.json(info);
      } catch (err) {
        logger.error({ err }, 'Debug membership failed');
        res.status(500).json({ error: err.message });
      }
    }
  );

  router.get(
    '/debug/group',
    requireAddresses(['contractAddress'], 'Invalid contractAddress'),
    async (req, res) => {
      try {
        const contractAddress = String(
          req.query.contractAddress || ''
        ).toLowerCase();
        const refresh = String(req.query.refresh || '0') === '1';
        const record = groups.get(contractAddress);
        if (!record) return res.status(404).json({ error: 'Unknown Templ' });
        const info = {
          contract: contractAddress,
          serverInboxId: xmtp?.inboxId || null,
          storedGroupId: record.groupId || record.group?.id || null,
          resolvedGroupId: null,
          membersCount: null,
          members: null,
        };
        if (refresh) {
          try {
            await syncXMTP(xmtp);
          } catch (e) {
            logger.warn({ err: e?.message || e });
          }
          try {
            const gid = record.groupId || record.group?.id;
            if (gid && xmtp.conversations?.getConversationById) {
              const maybe = await xmtp.conversations.getConversationById(gid);
              if (maybe) record.group = maybe;
            }
          } catch (e) {
            logger.warn({ err: e?.message || e });
          }
        }
        info.resolvedGroupId = record.group?.id || null;
        try {
          if (record.group && Array.isArray(record.group.members)) {
            info.membersCount = record.group.members.length;
            info.members = record.group.members;
          }
        } catch (e) {
          logger.warn({ err: e?.message || e });
        }
        logger.info(info, 'Debug group info');
        res.json(info);
      } catch (err) {
        logger.error({ err }, 'Debug group failed');
        res.status(500).json({ error: err.message });
      }
    }
  );

  router.get('/debug/conversations', async (req, res) => {
    try {
      const limit = Number.parseInt(String(req.query.limit || '10'), 10) || 10;
      try { await syncXMTP(xmtp); } catch (e) { logger.warn({ err: e?.message || e }); }
      const list = xmtp?.conversations?.list ? await xmtp.conversations.list() : [];
      const ids = (list || []).map(c => c.id);
      const result = { count: ids.length, firstIds: ids.slice(0, limit) };
      logger.info(result, 'Debug conversations');
      res.json(result);
    } catch (err) {
      logger.error({ err }, 'Debug conversations failed');
      res.status(500).json({ error: err.message });
    }
  });

  // Send a message to a group's conversation for debugging and discovery warmup
  router.post('/debug/send', async (req, res) => {
    try {
      const contractAddress = String(req.body?.contractAddress || '').toLowerCase();
      const content = String(req.body?.content || '').trim();
      if (!contractAddress || !content) return res.status(400).json({ error: 'Missing contractAddress or content' });
      const record = groups.get(contractAddress);
      if (!record) return res.status(404).json({ error: 'Unknown Templ' });
      try { await syncXMTP(xmtp); } catch (e) { logger.warn({ err: e?.message || e }); }
      try {
        if (!record.group && record.groupId && xmtp?.conversations?.getConversationById) {
          const maybe = await xmtp.conversations.getConversationById(record.groupId);
          if (maybe) record.group = maybe;
        }
      } catch (e) { logger.warn({ err: e?.message || e }); }
      if (!record.group) return res.status(500).json({ error: 'Group not resolved' });
      await record.group.send(content);
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err }, 'Debug send failed');
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/debug/last-join', (req, res) => {
    res.json(lastJoin);
  });

  router.get('/debug/inbox-state', async (req, res) => {
    try {
      const inboxId = String(req.query.inboxId || '').replace(/^0x/i, '');
      const env = String(req.query.env || XMTP_ENV);
      if (!inboxId) return res.status(400).json({ error: 'Missing inboxId' });
      let states = null;
      try {
        if (typeof Client.inboxStateFromInboxIds === 'function') {
          const envOpt = /** @type {any} */ (['local','dev','production'].includes(env) ? env : 'dev');
          states = await Client.inboxStateFromInboxIds([inboxId], envOpt);
        }
      } catch (e) {
        return res.status(500).json({ error: String(e?.message || e) });
      }
      // BigInt-safe serialization
      const safe = JSON.parse(JSON.stringify({ env, inboxId, states }, (_, v) => typeof v === 'bigint' ? v.toString() : v));
      res.json(safe);
    } catch (err) {
      logger.error({ err }, 'Debug inbox-state failed');
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
