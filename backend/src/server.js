import express from 'express';
import dotenv from 'dotenv';
import { ethers } from 'ethers';
import { Client } from '@xmtp/xmtp-js';

/**
 * Build an express application for managing TEMPL groups.
 * Dependencies like XMTP client and purchase verifier are injected to make
 * the server testable.
 * @param {object} deps
 * @param {object} deps.xmtp XMTP client instance
 * @param {(contract: string, member: string) => Promise<boolean>} deps.hasPurchased
 */
export function createApp({ xmtp, hasPurchased }) {
  const app = express();
  app.use(express.json());

  const groups = new Map();

  app.post('/templs', async (req, res) => {
    const { contractAddress, priestAddress } = req.body;
    if (!ethers.isAddress(contractAddress) || !ethers.isAddress(priestAddress)) {
      return res.status(400).json({ error: 'Invalid addresses' });
    }
    try {
      const group = await xmtp.conversations.newGroup([priestAddress], {
        title: `Templ ${contractAddress}`,
        description: 'Private TEMPL group'
      });
      groups.set(contractAddress.toLowerCase(), {
        group,
        priest: priestAddress.toLowerCase()
      });
      res.json({ groupId: group.id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/join', async (req, res) => {
    const { contractAddress, memberAddress } = req.body;
    if (!ethers.isAddress(contractAddress) || !ethers.isAddress(memberAddress)) {
      return res.status(400).json({ error: 'Invalid addresses' });
    }
    const record = groups.get(contractAddress.toLowerCase());
    if (!record) return res.status(404).json({ error: 'Unknown Templ' });
    const purchased = await hasPurchased(contractAddress, memberAddress);
    if (!purchased) return res.status(403).json({ error: 'Access not purchased' });
    try {
      await record.group.addMembers([memberAddress]);
      res.json({ groupId: record.group.id });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/mute', async (req, res) => {
    const { contractAddress, priestAddress, targetAddress } = req.body;
    if (
      !ethers.isAddress(contractAddress) ||
      !ethers.isAddress(priestAddress) ||
      !ethers.isAddress(targetAddress)
    ) {
      return res.status(400).json({ error: 'Invalid addresses' });
    }
    const record = groups.get(contractAddress.toLowerCase());
    if (!record) return res.status(404).json({ error: 'Unknown Templ' });
    if (record.priest !== priestAddress.toLowerCase()) {
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

