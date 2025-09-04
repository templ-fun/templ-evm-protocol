// @ts-check
import express from 'express';
import dotenv from 'dotenv';
import fs from 'fs';
import { ethers } from 'ethers';
import { Client } from '@xmtp/node-sdk';
import helmet from 'helmet';
import rateLimit, { MemoryStore } from 'express-rate-limit';
import cors from 'cors';
import Database from 'better-sqlite3';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const XMTP_ENV = process.env.XMTP_ENV || 'dev';

/**
 * Build an express application for managing TEMPL groups.
 * Dependencies like XMTP client and purchase verifier are injected to make
 * the server testable.
 * @param {object} deps
 * @param {object} deps.xmtp XMTP client instance
 * @param {(contract: string, member: string) => Promise<boolean>} deps.hasPurchased
 * @param {(address: string) => { on: Function }} [deps.connectContract] Optional
 *        factory returning a contract instance used to watch on-chain events.
 * @param {{
 *   xmtp: any,
 *   hasPurchased: (contract: string, member: string) => Promise<boolean>,
 *   connectContract?: (address: string) => { on: Function },
 *   dbPath?: string,
 *   db?: any,
 * }} opts
 */
export function createApp(opts) {
  /** @type {{xmtp:any, hasPurchased:(contract:string,member:string)=>Promise<boolean>, connectContract?: (address:string)=>{on:Function}, dbPath?: string, db?: any}} */
  // @ts-ignore - runtime validation below
  const { xmtp, hasPurchased, connectContract, dbPath, db } = opts || {};
  const app = express();
  const allowedOrigins =
    process.env.ALLOWED_ORIGINS?.split(',').filter(Boolean) ?? [
      'http://localhost:5173'
    ];
  app.use(cors({ origin: allowedOrigins }));
  app.use(express.json());
  app.use(helmet());
  const store = new MemoryStore();
  const limiter = rateLimit({
    windowMs: 60_000,
    max: 100,
    store
  });
  app.use(limiter);

  const groups = new Map();
  const lastJoin = { at: 0, payload: null };
  const database =
    db ??
    new Database(dbPath ?? new URL('../groups.db', import.meta.url).pathname);
  database.exec(
    'CREATE TABLE IF NOT EXISTS groups (contract TEXT PRIMARY KEY, groupId TEXT, priest TEXT)'
  );
  database.exec(
    'CREATE TABLE IF NOT EXISTS mutes (contract TEXT, target TEXT, count INTEGER, until INTEGER, PRIMARY KEY(contract, target))'
  );
  database.exec(
    'CREATE TABLE IF NOT EXISTS delegates (contract TEXT, delegate TEXT, PRIMARY KEY(contract, delegate))'
  );

  function persist(contract, record) {
    database
      .prepare(
        'INSERT OR REPLACE INTO groups (contract, groupId, priest) VALUES (?, ?, ?)'
      )
      .run(contract, (record.groupId || record.group?.id), record.priest);
  }

  (async () => {
    try {
      const rows = database
        .prepare('SELECT contract, groupId, priest FROM groups')
        .all();
      for (const row of rows) {
        try {
          const group = await xmtp.conversations.getConversationById(row.groupId);
          groups.set(row.contract, { group, groupId: row.groupId, priest: row.priest });
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
  })();

  function verify(address, signature, message) {
    try {
      return (
        ethers.verifyMessage(message, signature).toLowerCase() ===
        address.toLowerCase()
      );
    } catch {
      return false;
    }
  }

  // Linearize: wait until the target inbox is visible on the XMTP network
  async function waitForInboxReady(inboxId, tries = 60) {
    const id = String(inboxId || '').replace(/^0x/i, '');
    if (!id) return false;
    // Only attempt in known XMTP envs; otherwise, skip
    if (!['local', 'dev', 'production'].includes(XMTP_ENV)) return true;
    // In test/mocked environments, don't block on network checks
    if (process.env.NODE_ENV === 'test' || process.env.DISABLE_XMTP_WAIT === '1') return true;
    // If the static helper is not available (older SDK or mock), skip waiting
    if (typeof Client.inboxStateFromInboxIds !== 'function') return true;
    for (let i = 0; i < tries; i++) {
      try {
        if (typeof Client.inboxStateFromInboxIds === 'function') {
          const envOpt = /** @type {any} */ (['local','dev','production'].includes(XMTP_ENV) ? XMTP_ENV : 'dev');
          const states = await Client.inboxStateFromInboxIds([id], envOpt);
          logger.info({ inboxId: id, states }, 'Inbox states (inboxStateFromInboxIds)');
          if (Array.isArray(states) && states.length > 0) return true;
        }
      } catch (e) {
        logger.debug({ err: String(e?.message || e), inboxId: id }, 'Inbox state check failed');
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    return false;
  }

  app.post('/templs', async (req, res) => {
    const { contractAddress, priestAddress, signature, priestInboxId } = req.body;
    if (!ethers.isAddress(contractAddress) || !ethers.isAddress(priestAddress)) {
      return res.status(400).json({ error: 'Invalid addresses' });
    }
    const message = `create:${contractAddress.toLowerCase()}`;
    if (!verify(priestAddress, signature, message)) {
      return res.status(403).json({ error: 'Bad signature' });
    }
    try {
      // Capture baseline set of server conversations to help identify the new one
      let beforeIds = [];
      try {
        if (xmtp.conversations?.sync) await xmtp.conversations.sync();
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
          try { if (xmtp.conversations.sync) await xmtp.conversations.sync(); } catch (err) { void err; }
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
            if (xmtp.conversations?.sync) await xmtp.conversations.sync();
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
      if (xmtp.conversations.sync) {
        try { await xmtp.conversations.sync(); } catch (err) {
          if (!String(err?.message || '').includes('succeeded')) throw err;
          logger.info({ message: err.message }, 'XMTP sync message after creation - ignoring');
        }
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
  });

  app.post('/join', async (req, res) => {
    const { contractAddress, memberAddress, signature, memberInboxId } = req.body;
    if (!ethers.isAddress(contractAddress) || !ethers.isAddress(memberAddress)) {
      return res.status(400).json({ error: 'Invalid addresses' });
    }
    const record = groups.get(contractAddress.toLowerCase());
    if (!record) return res.status(404).json({ error: 'Unknown Templ' });
    const message = `join:${contractAddress.toLowerCase()}`;
    if (!verify(memberAddress, signature, message)) {
      return res.status(403).json({ error: 'Bad signature' });
    }
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
      try { if (xmtp.conversations.sync) await xmtp.conversations.sync(); logger.info('Server conversations synced after join'); } catch (err) { logger.warn({ err }, 'Server sync after join failed'); }
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
  });

  app.post('/delegates', (req, res) => {
    const { contractAddress, priestAddress, delegateAddress, signature } = req.body;
    if (
      !ethers.isAddress(contractAddress) ||
      !ethers.isAddress(priestAddress) ||
      !ethers.isAddress(delegateAddress)
    ) {
      return res.status(400).json({ error: 'Invalid addresses' });
    }
    const record = groups.get(contractAddress.toLowerCase());
    if (!record) return res.status(404).json({ error: 'Unknown Templ' });
    const message = `delegate:${contractAddress.toLowerCase()}:${delegateAddress.toLowerCase()}`;
    if (
      record.priest !== priestAddress.toLowerCase() ||
      !verify(priestAddress, signature, message)
    ) {
      return res.status(403).json({ error: 'Only priest can delegate' });
    }
    try {
      database
        .prepare(
          'INSERT OR REPLACE INTO delegates (contract, delegate) VALUES (?, ?)'
        )
        .run(contractAddress.toLowerCase(), delegateAddress.toLowerCase());
      res.json({ delegated: true });
    } catch (err) {
      logger.error({ err, contractAddress }, 'Backend /delegates failed');
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/delegates', (req, res) => {
    const { contractAddress, priestAddress, delegateAddress, signature } = req.body;
    if (
      !ethers.isAddress(contractAddress) ||
      !ethers.isAddress(priestAddress) ||
      !ethers.isAddress(delegateAddress)
    ) {
      return res.status(400).json({ error: 'Invalid addresses' });
    }
    const record = groups.get(contractAddress.toLowerCase());
    if (!record) return res.status(404).json({ error: 'Unknown Templ' });
    const message = `delegate:${contractAddress.toLowerCase()}:${delegateAddress.toLowerCase()}`;
    if (
      record.priest !== priestAddress.toLowerCase() ||
      !verify(priestAddress, signature, message)
    ) {
      return res.status(403).json({ error: 'Only priest can delegate' });
    }
    try {
      database
        .prepare('DELETE FROM delegates WHERE contract = ? AND delegate = ?')
        .run(contractAddress.toLowerCase(), delegateAddress.toLowerCase());
      res.json({ delegated: false });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/mute', async (req, res) => {
    const { contractAddress, moderatorAddress, targetAddress, signature } = req.body;
    if (
      !ethers.isAddress(contractAddress) ||
      !ethers.isAddress(moderatorAddress) ||
      !ethers.isAddress(targetAddress)
    ) {
      return res.status(400).json({ error: 'Invalid addresses' });
    }
    const record = groups.get(contractAddress.toLowerCase());
    if (!record) return res.status(404).json({ error: 'Unknown Templ' });
    const message = `mute:${contractAddress.toLowerCase()}:${targetAddress.toLowerCase()}`;
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
    if (!verify(moderatorAddress, signature, message)) {
      return res.status(403).json({ error: 'Bad signature' });
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
  });

  // --- Debug endpoints to help E2E diagnostics (test-only) ---
  if (process.env.ENABLE_DEBUG_ENDPOINTS === '1') {
  app.get('/debug/membership', async (req, res) => {
    try {
      const contractAddress = String(req.query.contractAddress || '').toLowerCase();
      const who = String(req.query.inboxId || '').replace(/^0x/i, '');
      if (!ethers.isAddress(contractAddress)) {
        return res.status(400).json({ error: 'Invalid contractAddress' });
      }
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
        if (xmtp?.conversations?.sync) await xmtp.conversations.sync();
        const members = Array.isArray(record.group?.members) ? record.group.members : [];
        info.members = members;
        info.contains = who ? members.includes(who) : null;
      } catch (e) { logger.warn({ e }, 'membership debug failed'); }
      res.json(info);
    } catch (err) {
      logger.error({ err }, 'Debug membership failed');
      res.status(500).json({ error: err.message });
    }
  });
  app.get('/debug/group', async (req, res) => {
    try {
      const contractAddress = String(req.query.contractAddress || '').toLowerCase();
      const refresh = String(req.query.refresh || '0') === '1';
      if (!ethers.isAddress(contractAddress)) {
        return res.status(400).json({ error: 'Invalid contractAddress' });
      }
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
      if (refresh && xmtp?.conversations?.sync) {
        try { await xmtp.conversations.sync(); } catch (e) { logger.warn({ err: e?.message || e }) }
        try {
          const gid = record.groupId || record.group?.id;
          if (gid && xmtp.conversations?.getConversationById) {
            const maybe = await xmtp.conversations.getConversationById(gid);
            if (maybe) record.group = maybe;
          }
        } catch (e) { logger.warn({ err: e?.message || e }) }
      }
      info.resolvedGroupId = record.group?.id || null;
      try {
        if (record.group && Array.isArray(record.group.members)) {
          info.membersCount = record.group.members.length;
          info.members = record.group.members;
        }
      } catch (e) { logger.warn({ err: e?.message || e }) }
      logger.info(info, 'Debug group info');
      res.json(info);
    } catch (err) {
      logger.error({ err }, 'Debug group failed');
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/debug/conversations', async (req, res) => {
    try {
      const limit = Number.parseInt(String(req.query.limit || '10'), 10) || 10;
      if (xmtp?.conversations?.sync) {
        try { await xmtp.conversations.sync(); } catch (e) { logger.warn({ err: e?.message || e }) }
      }
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
  app.get('/debug/last-join', (req, res) => {
    res.json(lastJoin);
  });
  app.get('/debug/inbox-state', async (req, res) => {
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
  }

  app.get('/mutes', (req, res) => {
    const { contractAddress } = req.query;
    if (!ethers.isAddress(contractAddress)) {
      return res.status(400).json({ error: 'Invalid addresses' });
    }
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


  app.close = () => {
    store.shutdown();
    database.close();
  };

  return app;
}

// Boot the standalone server when executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  dotenv.config();
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const wallet = new ethers.Wallet(process.env.BOT_PRIVATE_KEY, provider);
  
  // Create signer compatible with new SDK - using the pattern that worked in tests
  async function createXmtpWithRotation() {
    const dbEncryptionKey = new Uint8Array(32);
    for (let attempt = 1; attempt <= 100000000; attempt++) {
      const xmtpSigner = {
        type: 'EOA',
        getAddress: () => wallet.address,
        getIdentifier: () => ({
          identifier: wallet.address.toLowerCase(),
          identifierKind: 0, // Ethereum enum
          nonce: attempt,
        }),
        signMessage: async (message) => {
          let messageToSign;
          if (message instanceof Uint8Array) {
            try {
              messageToSign = ethers.toUtf8String(message);
            } catch {
              messageToSign = ethers.hexlify(message);
            }
          } else if (typeof message === 'string') {
            messageToSign = message;
          } else {
            messageToSign = String(message);
          }
          const signature = await wallet.signMessage(messageToSign);
          return ethers.getBytes(signature);
        }
      };
      try {
        // @ts-ignore - Node SDK accepts EOA-like signers; our JS object matches at runtime
        const env = process.env.XMTP_ENV || 'dev';
        // @ts-ignore - TS cannot discriminate the 'EOA' literal on JS object; safe at runtime
        return await Client.create(xmtpSigner, {
          dbEncryptionKey,
          env,
          loggingLevel: 'off',
          appVersion: 'templ/0.1.0'
        });
      } catch (err) {
        const msg = String(err?.message || err);
        if (msg.includes('already registered 10/10 installations')) {
          logger.warn({ attempt }, 'XMTP installation limit reached, rotating inbox');
          continue;
        }
        throw err;
      }
    }
    throw new Error('Unable to register XMTP client after nonce rotation');
  }

  const xmtp = await createXmtpWithRotation();
  const hasPurchased = async (contractAddress, memberAddress) => {
    const contract = new ethers.Contract(
      contractAddress,
      ['function hasPurchased(address) view returns (bool)'],
      provider
    );
    return contract.hasPurchased(memberAddress);
  };
  // Optional: use an ephemeral DB path for e2e to avoid stale group mappings
  const dbPath = process.env.DB_PATH;
  if (dbPath && process.env.CLEAR_DB === '1') {
    try { fs.rmSync(dbPath, { force: true }); } catch (e) { logger.warn({ err: e?.message || e }); };
  }
  const app = createApp({ xmtp, hasPurchased, dbPath });
  const port = process.env.PORT || 3001;
  app.listen(port, () => {
    logger.info({ port }, 'TEMPL backend listening');
  });
}
