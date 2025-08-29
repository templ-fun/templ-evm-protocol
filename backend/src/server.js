import express from 'express';
import dotenv from 'dotenv';
import { ethers } from 'ethers';
import { Client } from '@xmtp/node-sdk';
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
 */
export function createApp({ xmtp, hasPurchased, connectContract, dbPath, db }) {
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
      .run(contract, record.group.id, record.priest);
  }

  (async () => {
    try {
      const rows = database
        .prepare('SELECT contract, groupId, priest FROM groups')
        .all();
      for (const row of rows) {
        try {
          const group = await xmtp.conversations.getGroup(row.groupId);
          groups.set(row.contract, { group, priest: row.priest });
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
    const { contractAddress, priestAddress, signature } = req.body;
    if (!ethers.isAddress(contractAddress) || !ethers.isAddress(priestAddress)) {
      return res.status(400).json({ error: 'Invalid addresses' });
    }
    const message = `create:${contractAddress.toLowerCase()}`;
    if (!verify(priestAddress, signature, message)) {
      return res.status(403).json({ error: 'Bad signature' });
    }
    try {
      const group = await xmtp.conversations.newGroup([priestAddress], {
        title: `Templ ${contractAddress}`,
        description: 'Private TEMPL group'
      });
      const record = {
        group,
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
      await persist(key, record);
      res.json({ groupId: group.id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/join', async (req, res) => {
    const { contractAddress, memberAddress, signature } = req.body;
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
      await record.group.addMembers([memberAddress]);
      res.json({ groupId: record.group.id });
    } catch (err) {
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
  const xmtpSigner = {
    getAddress: () => wallet.address,
    getIdentifier: () => ({
      identifier: wallet.address,
      identifierKind: 0  // Ethereum = 0 in the enum
    }),
    signMessage: async (message) => {
      // Handle different message types
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
  
  const dbEncryptionKey = new Uint8Array(32);
  const xmtp = await Client.create(xmtpSigner, { 
    dbEncryptionKey,
    env: 'production' 
  });
  const hasPurchased = async (contractAddress, memberAddress) => {
    const contract = new ethers.Contract(
      contractAddress,
      ['function hasPurchased(address) view returns (bool)'],
      provider
    );
    return contract.hasPurchased(memberAddress);
  };
  const app = createApp({ xmtp, hasPurchased });
  const port = process.env.PORT || 3001;
  app.listen(port, () => {
    logger.info({ port }, 'TEMPL backend listening');
  });
}

