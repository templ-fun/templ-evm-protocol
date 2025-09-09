import express from 'express';
import { requireAddresses } from '../middleware/validate.js';
import { syncXMTP } from '../../../shared/xmtp.js';
import { Client } from '@xmtp/node-sdk';
import { XMTP_ENV } from '../xmtp/index.js';
import { logger } from '../logger.js';

export default function debugRouter({ xmtp, groups, lastJoin }) {
  const router = express.Router();

  // Restrict debug endpoints to localhost by default for safety
  router.use((req, res, next) => {
    try {
      const ip = req.ip || req.connection?.remoteAddress || '';
      const ok = ip === '127.0.0.1' || ip === '::1' || ip.endsWith('127.0.0.1') || ip.startsWith('::ffff:127.0.0.1');
      if (!ok) return res.status(403).json({ error: 'Debug endpoints restricted to localhost' });
    } catch { /* ignore */ }
    next();
  });

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
          // Ensure we have a fresh group handle if not yet hydrated
          try {
            if ((!record.group || !record.group.id) && record.groupId && xmtp?.conversations?.getConversationById) {
              const maybe = await xmtp.conversations.getConversationById(record.groupId);
              if (maybe) record.group = maybe;
            }
          } catch (e) { logger.warn({ e }, 'rehydrate group failed'); }
          await syncXMTP(xmtp);
          try { await record.group?.sync?.(); } catch { /* ignore */ }
          const norm = (s) => String(s || '').replace(/^0x/i, '').toLowerCase();
          let rawMembers = Array.isArray(record.group?.members) ? record.group.members : [];
          // If SDK does not expose members, use server-tracked memberSet
          if ((!rawMembers || rawMembers.length === 0) && record.memberSet && record.memberSet.size > 0) {
            rawMembers = Array.from(record.memberSet);
          }
          const membersNorm = (rawMembers || []).map(norm);
          info.members = rawMembers; // keep original surface for debug
          info.contains = who ? membersNorm.includes(norm(who)) : null;
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
          const rawMembers = Array.isArray(record.group?.members) ? record.group.members : [];
          let list = rawMembers;
          if ((!list || list.length === 0) && record.memberSet && record.memberSet.size > 0) {
            list = Array.from(record.memberSet);
          }
          if (Array.isArray(list)) {
            info.membersCount = list.length;
            info.members = list;
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
