// @ts-check
import express from 'express';
import dotenv from 'dotenv';
import fs from 'fs';
import { ethers } from 'ethers';
import { Client, generateInboxId } from '@xmtp/node-sdk';
import helmet from 'helmet';
import rateLimit, { MemoryStore } from 'express-rate-limit';
import cors from 'cors';
import Database from 'better-sqlite3';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

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

  app.post('/templs', async (req, res) => {
    const { contractAddress, priestAddress, priestInboxId, signature } = req.body;
    if (!ethers.isAddress(contractAddress) || !ethers.isAddress(priestAddress)) {
      return res.status(400).json({ error: 'Invalid addresses' });
    }
    const message = `create:${contractAddress.toLowerCase()}`;
    if (!verify(priestAddress, signature, message)) {
      return res.status(403).json({ error: 'Bad signature' });
    }
    try {
      // Create a new group including the priest so they can discover it immediately.
      // If an explicit inbox ID isn't provided, derive one from the address.
      let priestId = priestInboxId;
      if (!priestId) {
        const priestIdentifier = {
          identifier: priestAddress.toLowerCase(),
          identifierKind: 0
        };
        priestId = generateInboxId(priestIdentifier);
      }

      // Wait for the priest inbox to have at least one installation (Browser SDK may need a moment)
      async function waitForInboxReady(inboxId, tries = 20) {
        if (!xmtp?.preferences?.inboxStateFromInboxIds) return;
        for (let i = 0; i < tries; i++) {
          try {
            const states = await xmtp.preferences.inboxStateFromInboxIds([inboxId]);
            const st = states?.[0];
            if (st && Array.isArray(st.installations) && st.installations.length > 0) return;
          } catch (e) { console.warn(e); };
          await new Promise((r) => setTimeout(r, 500));
        }
      }
      try { await waitForInboxReady(priestId, 20); } catch (e) { console.warn(e); };

      // The SDK often reports successful syncs as errors, so capture that case.
      let group;
      try {
        group = await xmtp.conversations.newGroup([priestId]);
      } catch (err) {
        if (err.message && err.message.includes('succeeded')) {
          logger.info({ message: err.message }, 'XMTP sync message during group creation - ignoring');
          if (xmtp.conversations.sync) {
            await xmtp.conversations.sync();
          }
          const conversations = (await xmtp.conversations.list?.()) ?? [];
          const serverId = xmtp.inboxId;
          const candidates = conversations.filter((c) => {
            // members can be Array, Set, or undefined depending on SDK
            const mm = c.members;
            let members;
            if (Array.isArray(mm)) members = mm;
            else if (mm && typeof mm.has === 'function' && typeof mm.size === 'number') members = Array.from(mm);
            else members = [];
            const hasPriest = members.includes?.(priestId);
            const hasServer = serverId ? members.includes?.(serverId) : true;
            return Boolean(hasPriest && hasServer);
          });
          group = candidates[candidates.length - 1] || conversations[conversations.length - 1];
        } else {
          throw err;
        }
      }

      // Proactively nudge message history so new members can discover the group quickly
      try {
        await group.send(JSON.stringify({ type: 'templ-created', contract: contractAddress }));
      } catch (e) {
        logger.warn({ err: e }, 'Unable to send templ-created message');
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
        await xmtp.conversations.sync();
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
    const { contractAddress, memberAddress, memberInboxId, signature } = req.body;
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
      purchased = await hasPurchased(contractAddress, memberAddress);
    } catch {
      return res.status(500).json({ error: 'Purchase check failed' });
    }
    if (!purchased) return res.status(403).json({ error: 'Access not purchased' });
    try {
      // Use the provided inbox ID, or generate one from the address as fallback
      let inboxIdToAdd = memberInboxId;
      if (!inboxIdToAdd) {
        const memberIdentifier = {
          identifier: memberAddress.toLowerCase(),
          identifierKind: 0
        };
        // Generate inbox ID deterministically from the identifier
        inboxIdToAdd = generateInboxId(memberIdentifier);
      }
      
      // Ensure the member inbox has a published installation before adding
      async function waitForInboxReady(inboxId, tries = 20) {
        if (!xmtp?.preferences?.inboxStateFromInboxIds) return;
        for (let i = 0; i < tries; i++) {
          try {
            const states = await xmtp.preferences.inboxStateFromInboxIds([inboxId]);
            const st = states?.[0];
            if (st && Array.isArray(st.installations) && st.installations.length > 0) return;
          } catch (e) { console.warn(e); };
          await new Promise((r) => setTimeout(r, 500));
        }
      }
      try { await waitForInboxReady(inboxIdToAdd, 20); } catch (e) { console.warn(e); };

      try {
        await record.group.addMembers([inboxIdToAdd]);
      } catch (err) {
        if (!err.message || !err.message.includes('succeeded')) {
          throw err;
        }
        logger.info({ message: err.message }, 'XMTP sync message during member add - ignoring');
      }

      logger.info({ contract: contractAddress.toLowerCase(), groupId: record.group.id, memberInboxId: inboxIdToAdd }, 'Member added to group');

      // Ensure the server sees the updated membership before responding
      if (xmtp.conversations.sync) {
        await xmtp.conversations.sync();
      }

      // Send a lightweight welcome message so the client has fresh activity to sync
      try {
        await record.group.send(
          JSON.stringify({ type: 'member-joined', address: memberAddress })
        );
      } catch (e) {
        logger.warn({ err: e }, 'Unable to send member-joined message');
      }
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
      logger.error({ err, contractAddress }, 'Backend /send failed');
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
        try { await xmtp.conversations.sync(); } catch (e) { console.warn(e.message)}
        try {
          const gid = record.groupId || record.group?.id;
          if (gid && xmtp.conversations?.getConversationById) {
            const maybe = await xmtp.conversations.getConversationById(gid);
            if (maybe) record.group = maybe;
          }
        } catch (e) { console.warn(e.message)}
      }
      info.resolvedGroupId = record.group?.id || null;
      try {
        if (record.group && Array.isArray(record.group.members)) {
          info.membersCount = record.group.members.length;
          info.members = record.group.members;
        }
      } catch (e) { console.warn(e.message)}
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
        try { await xmtp.conversations.sync(); } catch (e) { console.warn(e.message)}
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

  // Minimal endpoint to allow the server to post a message into a group's chat.
  // Useful as a fallback while a browser client is still discovering the group.
  app.post('/send', async (req, res) => {
    const { contractAddress, content } = req.body || {};
    if (!ethers.isAddress(contractAddress) || typeof content !== 'string') {
      return res.status(400).json({ error: 'Invalid request' });
    }
    const record = groups.get(contractAddress.toLowerCase());
    if (!record) return res.status(404).json({ error: 'Unknown Templ' });
    try {
      // Be resilient to eventual consistency on XMTP dev: re-sync and re-resolve
      const maxTries = 20;
      for (let i = 0; i < maxTries; i++) {
        try {
          // Ensure consent if supported by SDK
          try {
            if (typeof record.group.updateConsentState === 'function') {
              await record.group.updateConsentState('allowed');
            }
          } catch {
            // Some SDKs signal success as errors; ignore unless real failure
          }
          await record.group.send(content);
          return res.json({ ok: true });
        } catch (e) {
          if (xmtp.conversations?.sync) {
            try { await xmtp.conversations.sync(); }
            catch (syncErr) { logger.debug({ err: syncErr }, 'XMTP sync failed during /send retry'); }
          }
          try {
            // Attempt to resolve the group again by id
            const gid = (record.groupId || record.group?.id);
            if (gid && xmtp.conversations?.getConversationById) {
              const maybe = await xmtp.conversations.getConversationById(gid);
              if (maybe) record.group = maybe;
            } else if (xmtp.conversations?.list) {
              const list = await xmtp.conversations.list();
              if (list && list.length) {
                const found = gid ? list.find((c) => c.id === gid) : null;
                record.group = found || list[list.length - 1];
              }
            }
          } catch (resolveErr) {
            logger.debug({ err: resolveErr }, 'XMTP re-resolve failed during /send retry');
          }
          await new Promise((r) => setTimeout(r, 750));
          if (i === maxTries - 1) throw e;
        }
      }
    } catch (err) {
      logger.error({ err }, 'Backend /send failed');
      res.status(500).json({ error: err.message });
    }
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
        // @ts-ignore - Node SDK accepts EOA-like signers
        return await Client.create(xmtpSigner, {
          dbEncryptionKey,
          env: 'dev',
          loggingLevel: 'off'
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
    try { fs.rmSync(dbPath, { force: true }); } catch (e) { console.warn(e); };
  }
  const app = createApp({ xmtp, hasPurchased, dbPath });
  const port = process.env.PORT || 3001;
  app.listen(port, () => {
    logger.info({ port }, 'TEMPL backend listening');
  });
}
