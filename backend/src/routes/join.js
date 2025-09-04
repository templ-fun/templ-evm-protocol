import express from 'express';
import { syncXMTP } from '../../../shared/xmtp.js';
import { requireAddresses, verifySignature } from '../middleware/validate.js';
import { waitForInboxReady } from '../xmtp/index.js';
import { logger } from '../logger.js';

export default function joinRouter({ xmtp, groups, hasPurchased, lastJoin }) {
  const router = express.Router();

  router.post(
    '/join',
    requireAddresses(['contractAddress', 'memberAddress']),
    (req, res, next) => {
      const record = groups.get(req.body.contractAddress.toLowerCase());
      if (!record) return res.status(404).json({ error: 'Unknown Templ' });
      req.record = record;
      next();
    },
    verifySignature(
      'memberAddress',
      (req) => `join:${req.body.contractAddress.toLowerCase()}`
    ),
    async (req, res) => {
      const { contractAddress, memberAddress, memberInboxId } = req.body;
      const record = /** @type {any} */ (req.record);
      let purchased;
      try {
        // Snapshot removal: no longer needed with identity-based add
        purchased = await hasPurchased(contractAddress, memberAddress);
      } catch {
        return res.status(500).json({ error: 'Purchase check failed' });
      }
      if (!purchased) return res.status(403).json({ error: 'Access not purchased' });
      try {
        // Resolve member inboxId and add explicitly by inboxId for maximum compatibility
        const memberIdentifier = { identifier: memberAddress.toLowerCase(), identifierKind: 0 };
        async function waitForInboxId(identifier, tries = 180) {
          if (!xmtp?.findInboxIdByIdentifier) return null;
          for (let i = 0; i < tries; i++) {
            try {
              const found = await xmtp.findInboxIdByIdentifier(identifier);
              if (found) return found;
            } catch (e) { void e; }
            await new Promise((r) => setTimeout(r, 1000));
          }
          return null;
        }
        // Prefer inboxId provided by client; else wait until identity is visible on the network
        let inboxId = null;
        if (memberInboxId && typeof memberInboxId === 'string' && memberInboxId.length > 0) {
          inboxId = String(memberInboxId).replace(/^0x/i, '');
        } else {
          inboxId = await waitForInboxId(memberIdentifier, 180);
        }
        if (!inboxId) {
          return res.status(503).json({ error: 'Member identity not registered yet; retry shortly' });
        }
        // Linearize against identity readiness on XMTP infra
        const ready = await waitForInboxReady(inboxId, 60);
        logger.info({ inboxId, ready }, 'Member inbox readiness before add');
        const beforeAgg = xmtp?.debugInformation?.apiAggregateStatistics?.();
        const joinMeta = { contract: contractAddress.toLowerCase(), member: memberAddress.toLowerCase(), inboxId, serverInboxId: xmtp?.inboxId || null, groupId: record.group?.id || record.groupId || null };
        logger.info(joinMeta, 'Inviting member by inboxId');
        try {
          if (typeof record.group.addMembers === 'function') {
            await record.group.addMembers([inboxId]);
            logger.info({ inboxId }, 'addMembers([inboxId]) succeeded');
          } else if (typeof record.group.addMembersByInboxId === 'function') {
            await record.group.addMembersByInboxId([inboxId]);
            logger.info({ inboxId }, 'addMembersByInboxId([inboxId]) succeeded');
          } else if (typeof record.group.addMembersByIdentifiers === 'function') {
            await record.group.addMembersByIdentifiers([memberIdentifier]);
            logger.info({ member: memberAddress.toLowerCase() }, 'addMembersByIdentifiers([identifier]) succeeded');
          } else {
            throw new Error('XMTP group does not support adding members');
          }
        } catch (err) {
          if (!String(err?.message || '').includes('succeeded')) throw err;
        }

        // Re-sync server view and warm the conversation
        try {
          await syncXMTP(xmtp);
          logger.info('Server conversations synced after join');
        } catch (err) {
          logger.warn({ err }, 'Server sync after join failed');
        }
        try {
          lastJoin.at = Date.now();
          lastJoin.payload = { joinMeta };
          try {
            const afterAgg = xmtp?.debugInformation?.apiAggregateStatistics?.();
            logger.info({ beforeAgg, afterAgg }, 'XMTP API stats around member add');
            lastJoin.payload.afterAgg = afterAgg;
            lastJoin.payload.beforeAgg = beforeAgg;
          } catch (e) { void e; }
        } catch (e) { void e; }
        try {
          const members = Array.isArray(record.group?.members) ? record.group.members : [];
          logger.info({ members }, 'Group members snapshot after member add');
        } catch (e) { void e; }
        try { if (typeof record.group.sync === 'function') await record.group.sync(); } catch (err) { void err; }
        try { await record.group.send(JSON.stringify({ type: 'member-joined', address: memberAddress })); } catch (err) { void err; }
        res.json({ groupId: record.group.id });
      } catch (err) {
        logger.error({ err, contractAddress }, 'Join failed');
        res.status(500).json({ error: err.message });
      }
    }
  );

  return router;
}
