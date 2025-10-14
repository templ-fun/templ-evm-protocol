#!/usr/bin/env node
// Demonstrate XMTP group messaging locally without any templ contracts.

import 'dotenv/config';
import { randomBytes } from 'crypto';
import { Wallet, ethers } from 'ethers';
import { Client } from '@xmtp/node-sdk';

const XMTP_ENV = process.env.XMTP_ENV || 'dev';
const LOG_LEVEL = process.env.XMTP_LOG_LEVEL || 'info';
const GROUP_NAME = process.env.XMTP_GROUP_NAME || 'Templ XMTP Demo';

/**
 * Convert an ethers Wallet into the signer shape expected by the XMTP Node SDK.
 * @param {Wallet} wallet
 */
function createSigner(wallet) {
  return {
    type: 'EOA',
    getIdentifier: () => ({
      identifier: wallet.address,
      identifierKind: 0 // IdentifierKind.Ethereum
    }),
    signMessage: async (message) => {
      let toSign = message;
      if (message instanceof Uint8Array) {
        try {
          toSign = ethers.toUtf8String(message);
        } catch {
          toSign = ethers.hexlify(message);
        }
      } else if (typeof message !== 'string') {
        toSign = String(message);
      }
      const signature = await wallet.signMessage(toSign);
      return ethers.getBytes(signature);
    }
  };
}

async function createClient(label, wallet) {
  console.log(`[${label}] address: ${wallet.address}`);
  const client = await Client.create(createSigner(wallet), {
    env: XMTP_ENV,
    dbEncryptionKey: randomBytes(32),
    loggingLevel: LOG_LEVEL
  });
  console.log(`[${label}] inboxId: ${client.inboxId}`);
  return client;
}

async function main() {
  const aliceKey = process.env.XMTP_ALICE_PRIVATE_KEY;
  const bobKey = process.env.XMTP_BOB_PRIVATE_KEY;

  const aliceWallet = aliceKey ? new Wallet(aliceKey) : Wallet.createRandom();
  const bobWallet = bobKey ? new Wallet(bobKey) : Wallet.createRandom();

  const alice = await createClient('alice', aliceWallet);
  const bob = await createClient('bob', bobWallet);

  const group = await alice.conversations.newGroup([bob.inboxId], {
    name: GROUP_NAME
  });
  console.log(`[group] created: ${group.id}`);

  const messageId = await group.send('Hello from Alice via XMTP 🚀');
  console.log(`[alice] sent message ${messageId}`);

  await bob.conversations.syncAll();
  const bobGroup = await bob.conversations.getConversationById(group.id);
  if (!bobGroup) {
    throw new Error('Bob could not find the group conversation');
  }
  const recent = await bobGroup.messages();
  recent.forEach((msg) => {
    const content =
      typeof msg.content === 'string'
        ? msg.content
        : JSON.stringify(msg.content);
    console.log(`[bob view] ${msg.senderInboxId}: ${content}`);
  });

  console.log('\nXMTP demo complete. Set XMTP_ALICE_PRIVATE_KEY / XMTP_BOB_PRIVATE_KEY to reuse identities.');
}

main().catch((err) => {
  console.error('XMTP demo failed:', err);
  process.exitCode = 1;
});
