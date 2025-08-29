import express from 'express';
import dotenv from 'dotenv';
import { ethers } from 'ethers';
import { Client } from '@xmtp/xmtp-js';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import Database from 'better-sqlite3';

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
export function createApp({ xmtp, hasPurchased, connectContract }) {
  const app = express();
  app.use(express.json());
  app.use(helmet());
  app.use(
    rateLimit({
      windowMs: 60_000,
      max: 100
    })
  );

  const groups = new Map();
  const DB_FILE = new URL('../groups.sqlite', import.meta.url);
  const db = new Database(DB_FILE.pathname);
  db.pragma('journal_mode = WAL');
  db
    .prepare(
      'CREATE TABLE IF NOT EXISTS groups (contract TEXT PRIMARY KEY, groupId TEXT NOT NULL, priest TEXT NOT NULL)'
    )
    .run();

  function persist(contract, { group, priest }) {
    db
      .prepare(
        'INSERT OR REPLACE INTO groups (contract, groupId, priest) VALUES (?, ?, ?)'
      )
      .run(contract, group.id, priest);
  }

  (async () => {
    try {
      const rows = db
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
      persist(key, record);
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

  app.post('/mute', async (req, res) => {
    const { contractAddress, priestAddress, targetAddress, signature } = req.body;
    if (
      !ethers.isAddress(contractAddress) ||
      !ethers.isAddress(priestAddress) ||
      !ethers.isAddress(targetAddress)
    ) {
      return res.status(400).json({ error: 'Invalid addresses' });
    }
    const record = groups.get(contractAddress.toLowerCase());
    if (!record) return res.status(404).json({ error: 'Unknown Templ' });
    const message = `mute:${contractAddress.toLowerCase()}:${targetAddress.toLowerCase()}`;
    if (record.priest !== priestAddress.toLowerCase() || !verify(priestAddress, signature, message)) {
      return res.status(403).json({ error: 'Only priest can mute' });
    }
    try {
      await record.group.removeMembers([targetAddress]);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return app;
}

// Boot the standalone server when executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  dotenv.config();
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const wallet = new ethers.Wallet(process.env.BOT_PRIVATE_KEY, provider);
  const xmtp = await Client.create(wallet, { env: 'production' });
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
    console.log(`TEMPL backend listening on ${port}`);
  });
}

