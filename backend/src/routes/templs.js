import express from 'express';
import { syncXMTP } from '../../../shared/xmtp.js';
import { requireAddresses, verifyTypedSignature } from '../middleware/validate.js';
// import { ethers } from 'ethers';
import { buildCreateTypedData } from '../../../shared/signing.js';
import { generateInboxId, getInboxIdForIdentifier } from '@xmtp/node-sdk';
import { logger } from '../logger.js';

export default function templsRouter({ xmtp, groups, persist, connectContract, database, provider }) {
  const router = express.Router();
  const DISABLE_WAIT = process.env.DISABLE_XMTP_WAIT === '1' || process.env.NODE_ENV === 'test';
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
        const chainId = Number(req.body?.chainId || 31337);
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
      const { contractAddress, priestAddress } = req.body;
      try {
        // Optional contract verification (prod): ensure address is a contract when configured
        const requireVerify = process.env.REQUIRE_CONTRACT_VERIFY === '1' || process.env.NODE_ENV === 'production';
        if (requireVerify && provider) {
          try {
            const code = await provider.getCode(contractAddress);
            if (!code || code === '0x') {
              return res.status(400).json({ error: 'Not a contract' });
            }
          } catch { /* ignore in permissive mode */ }
        }
        // Capture baseline set of server conversations to help identify the new one
        let beforeIds = [];
        try {
          await syncXMTP(xmtp);
          const beforeList = (await xmtp.conversations?.list?.()) ?? [];
          beforeIds = beforeList.map((c) => c.id);
        } catch (err) { void err; }
        // Prefer identity-based membership (Ethereum = 0) when supported
        const priestIdentifierObj = { identifier: priestAddress.toLowerCase(), identifierKind: 0 };

      // The SDK often reports successful syncs as errors, so capture that case.
      let group;
      try {
        // Build initial participant list using inbox IDs as required by node-sdk@4.x
        // Always include the server's own inboxId. Add priest inboxId if resolvable.
        const inboxIds = [];
        if (xmtp?.inboxId) inboxIds.push(xmtp.inboxId);
        try {
          const envOpt = /** @type {'local'|'dev'|'production'} */ (
            ['local','dev','production'].includes(String(process.env.XMTP_ENV)) ? process.env.XMTP_ENV : 'dev'
          );
          const priestInboxMaybe = await getInboxIdForIdentifier(priestIdentifierObj, envOpt);
          if (priestInboxMaybe) {
            inboxIds.push(priestInboxMaybe);
          } else {
            // Only allow deterministic generation in local/test to avoid accidental mismatches in dev/prod
            if (envOpt === 'local' || process.env.NODE_ENV === 'test') {
              try { inboxIds.push(generateInboxId(priestIdentifierObj)); } catch { /* ignore */ }
            }
          }
        } catch {
          // ignore resolution errors silently
        }
        if (!inboxIds.length) {
          throw new Error('No inboxIds available for group creation');
        }
        if (typeof xmtp.conversations.newGroup !== 'function') {
          throw new Error('XMTP client does not support newGroup(inboxIds)');
        }
        group = await xmtp.conversations.newGroup(inboxIds);
      } catch (err) {
        const msg = String(err?.message || '');
        logger.warn({ err: msg }, 'Group creation initial attempt failed; attempting recovery');
        try { await syncXMTP(xmtp); } catch (e) { void e; }
        // Attempt to resolve the newly created conversation by diffing before/after
        try {
          const afterList = (await xmtp.conversations.list?.()) ?? [];
          const afterIds = afterList.map((c) => c.id);
          const diffIds = afterIds.filter((id) => !beforeIds.includes(id));
          const byDiff = afterList.filter((c) => diffIds.includes(c.id));
          const expectedName = `Templ ${contractAddress}`;
          let candidate = byDiff.find((c) => c.name === expectedName) || afterList.find((c) => c.name === expectedName);
          if (!candidate) candidate = byDiff[byDiff.length - 1] || afterList[afterList.length - 1];
          if (candidate) group = candidate;
        } catch (e) { void e; }
        // If still no group, retry with just the server's inboxId
        if (!group && typeof xmtp.conversations.newGroup === 'function' && xmtp?.inboxId) {
          group = await xmtp.conversations.newGroup([xmtp.inboxId]);
        }
        if (!group) {
          throw err;
        }
      }

      // Priest is included in newGroup creation via inboxIds; no explicit add required here.

      // Proactively nudge message history so clients can discover the group quickly
      try {
        if (typeof group.send === 'function') {
          await group.send(JSON.stringify({ type: 'templ-created', contract: contractAddress }));
        }
      } catch (err) {
        logger.warn({ msg: 'Unable to send templ-created message', err: String(err?.message || err) });
      }

      logger.info({
        contract: contractAddress.toLowerCase(),
        groupId: group.id,
        groupName: group.name,
        // avoid members in logs by default
      }, 'Group created successfully');

      // Log member count after creation (expected to be 1 - the server itself)
      // Skip dumping member arrays in non-debug logs

      // Set the group metadata - these may throw sync errors too
      if (!DISABLE_WAIT && typeof group.updateName === 'function') {
        try {
          await group.updateName(`Templ ${contractAddress}`);
        } catch (err) {
          if (!err.message || !err.message.includes('succeeded')) {
            throw err;
          }
          logger.info({ message: err.message }, 'XMTP sync message during name update - ignoring');
        }
      }

      if (!DISABLE_WAIT && typeof group.updateDescription === 'function') {
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
        priest: priestAddress.toLowerCase(),
        memberSet: new Set()
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
