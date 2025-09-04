import express from 'express';
import { syncXMTP } from '../../../shared/xmtp.js';
import { requireAddresses, verifySignature } from '../middleware/validate.js';
import { waitForInboxReady } from '../xmtp/index.js';
import { logger } from '../logger.js';

export default function templsRouter({ xmtp, groups, persist, connectContract, database }) {
  const router = express.Router();

  // List known templs from persistence
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
      } catch (e) { void e; }
      res.json({ templs: rows });
    } catch (err) {
      res.status(500).json({ error: err?.message || String(err) });
    }
  });

  router.post(
    '/templs',
    requireAddresses(['contractAddress', 'priestAddress']),
    verifySignature(
      'priestAddress',
      (req) => `create:${req.body.contractAddress.toLowerCase()}`
    ),
    async (req, res) => {
      const { contractAddress, priestAddress, priestInboxId } = req.body;
      try {
        // Capture baseline set of server conversations to help identify the new one
        let beforeIds = [];
        try {
          await syncXMTP(xmtp);
          const beforeList = (await xmtp.conversations?.list?.()) ?? [];
          beforeIds = beforeList.map((c) => c.id);
        } catch (err) { void err; }
        // Prefer identity-based membership (Ethereum = 0) when supported
        const priestIdentifierObj = { identifier: priestAddress.toLowerCase(), identifierKind: 0 };
        // Ensure the priest identity is registered before creating a group
        async function waitForIdentityReady(identifier, tries = 60) {
          if (!xmtp?.findInboxIdByIdentifier) return;
          for (let i = 0; i < tries; i++) {
            try {
              const found = await xmtp.findInboxIdByIdentifier(identifier);
              if (found) return found;
            } catch (err) { void err; }
            await new Promise((r) => setTimeout(r, 1000));
          }
          return null;
        }
        await waitForIdentityReady(priestIdentifierObj, 60);

      // The SDK often reports successful syncs as errors, so capture that case.
      let group;
      try {
        if (typeof xmtp.conversations.newGroupWithIdentifiers === 'function') {
          group = await xmtp.conversations.newGroupWithIdentifiers([priestIdentifierObj]);
        } else if (typeof xmtp.conversations.newGroup === 'function') {
          // Fallback for test/mocked clients
          group = await xmtp.conversations.newGroup();
        } else {
          throw new Error('XMTP client does not support group creation');
        }
      } catch (err) {
        if (err.message && err.message.includes('succeeded')) {
          logger.info({ message: err.message }, 'XMTP sync message during group creation - attempting deterministic resolve');
          try { await syncXMTP(xmtp); } catch (err) { void err; }
          const afterList = (await xmtp.conversations.list?.()) ?? [];
          const afterIds = afterList.map((c) => c.id);
          // Prefer new conversations that appeared since beforeIds snapshot
          const diffIds = afterIds.filter((id) => !beforeIds.includes(id));
          const byDiff = afterList.filter((c) => diffIds.includes(c.id));
          // Try by name first (if something already set a name)
          const expectedName = `Templ ${contractAddress}`;
          let candidate = byDiff.find((c) => c.name === expectedName) || afterList.find((c) => c.name === expectedName);
          if (!candidate) {
            // Fall back to the newest item among the diffs, then overall list
            candidate = byDiff[byDiff.length - 1] || afterList[afterList.length - 1];
          }
          group = candidate;
          if (!group) {
            // As a last resort, retry identity-based group creation once.
            group = await xmtp.conversations.newGroupWithIdentifiers([priestIdentifierObj]);
          }
        } else {
          throw err;
        }
      }

      // Ensure priest is explicitly added by inboxId for deterministic discovery across SDKs
      try {
        // Prefer inboxId passed from frontend; else resolve from network
        let priestInbox = null;
        if (priestInboxId && typeof priestInboxId === 'string' && priestInboxId.length > 0) {
          priestInbox = priestInboxId.replace(/^0x/i, '');
        } else {
          try {
            if (typeof xmtp.findInboxIdByIdentifier === 'function') {
              priestInbox = await xmtp.findInboxIdByIdentifier(priestIdentifierObj);
            }
          } catch (e) { void e; }
        }
        if (priestInbox && typeof group.addMembers === 'function') {
          const ready = await waitForInboxReady(priestInbox, 30);
          logger.info({ priestInboxId: priestInbox, ready }, 'Priest inbox readiness before add');
          const beforeAgg = xmtp?.debugInformation?.apiAggregateStatistics?.();
          try {
            await group.addMembers([priestInbox]);
            logger.info({ priestInboxId: priestInbox }, 'Added priest by inboxId');
          } catch (addErr) {
            const msg = String(addErr?.message || '');
            // Ignore benign cases like already a member or SDK reporting success as an error
            if (!msg.includes('already') && !msg.includes('succeeded')) throw addErr;
          }
          try {
            await syncXMTP(xmtp);
          } catch (e) { logger.warn({ e }, 'Server sync after priest add failed'); }
          try {
            const afterAgg = xmtp?.debugInformation?.apiAggregateStatistics?.();
            logger.info({ beforeAgg, afterAgg }, 'XMTP API stats around priest add');
          } catch (e) { void e; }
          try {
            // Attempt to read members for diagnostics
            const members = Array.isArray(group.members) ? group.members : [];
            logger.info({ members }, 'Group members snapshot after priest add');
          } catch (e) { void e; }
        }
      } catch (err) {
        logger.warn({ err }, 'Unable to explicitly add priest by inboxId');
      }

      // Proactively nudge message history so new members can discover the group quickly
      try {
        await group.send(JSON.stringify({ type: 'templ-created', contract: contractAddress }));
      } catch (err) {
        logger.warn({ err }, 'Unable to send templ-created message');
      }

      logger.info({
        contract: contractAddress.toLowerCase(),
        groupId: group.id,
        groupName: group.name,
        memberCount: group.members?.length
      }, 'Group created successfully');

      // Log member count after creation (expected to be 1 - the server itself)
      logger.info({
        memberCount: group.members?.length,
        members: group.members
      }, 'Group members after creation');

      // Set the group metadata - these may throw sync errors too
      if (typeof group.updateName === 'function') {
        try {
          await group.updateName(`Templ ${contractAddress}`);
        } catch (err) {
          if (!err.message || !err.message.includes('succeeded')) {
            throw err;
          }
          logger.info({ message: err.message }, 'XMTP sync message during name update - ignoring');
        }
      }

      if (typeof group.updateDescription === 'function') {
        try {
          await group.updateDescription('Private TEMPL group');
        } catch (err) {
          if (!err.message || !err.message.includes('succeeded')) {
            throw err;
          }
          logger.info({ message: err.message }, 'XMTP sync message during description update - ignoring');
        }
      }

      // Ensure the group is fully synced before returning
      try {
        await syncXMTP(xmtp);
      } catch (err) {
        if (!String(err?.message || '').includes('succeeded')) throw err;
        logger.info({ message: err.message }, 'XMTP sync message after creation - ignoring');
      }

      const record = {
        group,
        groupId: group?.id,
        priest: priestAddress.toLowerCase()
      };

      if (connectContract) {
        const contract = connectContract(contractAddress);
        contract.on('ProposalCreated', (id, proposer, title, endTime) => {
          group.send(
            JSON.stringify({
              type: 'proposal',
              id: Number(id),
              proposer,
              title,
              endTime: Number(endTime)
            })
          );
        });
        contract.on('VoteCast', (id, voter, support, timestamp) => {
          group.send(
            JSON.stringify({
              type: 'vote',
              id: Number(id),
              voter,
              support: Boolean(support),
              timestamp: Number(timestamp)
            })
          );
        });
        record.contract = contract;
      }

      const key = contractAddress.toLowerCase();
      groups.set(key, record);
      persist(key, record);
      res.json({ groupId: group.id });
      } catch (err) {
        logger.error({ err, priestAddress, contractAddress }, 'Failed to create group');
        res.status(500).json({ error: err.message });
      }
    }
  );

  return router;
}
