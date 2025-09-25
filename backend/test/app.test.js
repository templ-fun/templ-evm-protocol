import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { Wallet } from 'ethers';

import { createMemoryDatabase } from '../src/memoryDb.js';

import { createApp } from '../src/server.js';
import { buildCreateTypedData, buildJoinTypedData } from '../../shared/signing.js';

process.env.NODE_ENV = 'test';
process.env.BACKEND_SERVER_ID = 'test-server';
process.env.APP_BASE_URL = 'http://localhost:5173';


function makeApp({ hasPurchased = async () => true } = {}) {
  const db = createMemoryDatabase();
  const notifications = [];
  const handlerRegistry = new Map();
  const notifier = {
    notifyAccessPurchased: async (payload) => notifications.push({ type: 'access', payload }),
    notifyProposalCreated: async (payload) => notifications.push({ type: 'proposal', payload }),
    notifyVoteCast: async (payload) => notifications.push({ type: 'vote', payload }),
    notifyPriestChanged: async (payload) => notifications.push({ type: 'priest', payload }),
    notifyProposalQuorumReached: async (payload) => notifications.push({ type: 'quorum', payload }),
    notifyProposalVotingClosed: async (payload) => notifications.push({ type: 'votingClosed', payload }),
    notifyDailyDigest: async (payload) => notifications.push({ type: 'digest', payload }),
    notifyTemplHomeLinkUpdated: async (payload) => notifications.push({ type: 'homeLink', payload }),
    notifyBindingComplete: async (payload) => notifications.push({ type: 'binding', payload }),
    fetchUpdates: async () => ({ updates: [], nextOffset: 0 })
  };
  const connectContract = (address) => {
    const key = String(address).toLowerCase();
    const entry = { handlers: {}, metadata: new Map() };
    handlerRegistry.set(key, entry);
    return {
      on: (event, handler) => {
        entry.handlers[event] = async (...args) => {
          if (event === 'ProposalCreated') {
            const [id,, , titleArg, descriptionArg] = args;
            entry.metadata.set(String(id), {
              title: titleArg ? String(titleArg) : '',
              description: descriptionArg ? String(descriptionArg) : ''
            });
          }
          return handler(...args);
        };
      },
      async getProposal(id) {
        const stored = entry.metadata.get(String(id));
        return {
          proposer: null,
          yesVotes: 0,
          noVotes: 0,
          endTime: 0,
          executed: false,
          passed: false,
          title: stored?.title ?? '',
          description: stored?.description ?? ''
        };
      },
      async getProposalSnapshots() {
        return [0, 0, 0, 0, 0, 0];
      },
      async treasuryBalance() {
        return 0n;
      },
      async memberPoolBalance() {
        return 0n;
      }
    };
  };
  const app = createApp({ hasPurchased, db, connectContract, telegram: { notifier } });
  return { app, db, notifications, handlerRegistry };
}

async function registerTempl(app, wallet, { telegramChatId = '12345', templHomeLink } = {}) {
  const contractAddress = wallet.address;
  const typed = buildCreateTypedData({ chainId: 1337, contractAddress: contractAddress.toLowerCase() });
  const signature = await wallet.signTypedData(typed.domain, typed.types, typed.message);
  const res = await request(app)
    .post('/templs')
    .send({
      contractAddress,
      priestAddress: wallet.address,
      signature,
      chainId: 1337,
      telegramChatId,
      templHomeLink,
      nonce: typed.message.nonce,
      issuedAt: typed.message.issuedAt,
      expiry: typed.message.expiry
    });
  assert.equal(res.status, 200);
  return { contractAddress: contractAddress.toLowerCase(), response: res.body };
}

async function joinTempl(app, contractAddress, wallet) {
  const typed = buildJoinTypedData({ chainId: 1337, contractAddress });
  const signature = await wallet.signTypedData(typed.domain, typed.types, typed.message);
  return request(app)
    .post('/join')
    .send({
      contractAddress,
      memberAddress: wallet.address,
      signature,
      chainId: 1337,
      nonce: typed.message.nonce,
      issuedAt: typed.message.issuedAt,
      expiry: typed.message.expiry
    });
}

test('register templ persists record and wires contract listeners', async (t) => {
  const { app, db, notifications, handlerRegistry } = makeApp();
  t.after(async () => {
    await app.close?.();
    db.close();
  });

  const wallet = Wallet.createRandom();
  const { contractAddress, response } = await registerTempl(app, wallet, { telegramChatId: 'telegram-chat-1' });

  assert.equal(response.contract, contractAddress);
  assert.equal(response.priest, wallet.address.toLowerCase());
  assert.equal(response.telegramChatId, 'telegram-chat-1');
  assert.equal(response.groupId, 'telegram-chat-1');
  assert.equal(response.templHomeLink, '');
  assert.equal(response.bindingCode, null);

  const entry = handlerRegistry.get(contractAddress);
  assert.ok(entry, 'contract handlers registered');
  const { handlers, metadata } = entry;
  assert.equal(typeof handlers.AccessPurchased, 'function');
  assert.equal(typeof handlers.ProposalCreated, 'function');
  assert.equal(typeof handlers.VoteCast, 'function');
  assert.equal(typeof handlers.PriestChanged, 'function');

  await handlers.AccessPurchased(wallet.address, 0n, 0n, 0n, 0n, 0n, 1n, 0n, 2n);
  await handlers.ProposalCreated(1n, wallet.address, 1234n, 'Proposal title', 'Proposal description');
  await handlers.VoteCast(1n, wallet.address, true, 5678n);
  await handlers.PriestChanged(wallet.address, wallet.address);

  assert.equal(notifications.length, 4);
  assert.equal(notifications[0].type, 'access');
  assert.equal(notifications[1].type, 'proposal');
  assert.equal(notifications[2].type, 'vote');
  assert.equal(notifications[3].type, 'priest');
  assert.equal(notifications[1].payload.title, 'Proposal title');
  assert.equal(notifications[1].payload.description, 'Proposal description');
  assert.equal(notifications[2].payload.title, 'Proposal title');
  const storedMeta = metadata.get('1');
  assert.equal(storedMeta?.title, 'Proposal title');
  const cacheRecord = app.locals.templs.get(contractAddress);
  assert.equal(cacheRecord?.proposalsMeta?.get?.('1')?.title, 'Proposal title');
});

test('join endpoint validates membership', async (t) => {
  const { app, db } = makeApp({ hasPurchased: async () => true });
  t.after(async () => {
    await app.close?.();
    db.close();
  });

  const templWallet = Wallet.createRandom();
  const memberWallet = Wallet.createRandom();
  const { contractAddress } = await registerTempl(app, templWallet);

  const res = await joinTempl(app, contractAddress, memberWallet);
  assert.equal(res.status, 200);
  assert.equal(res.body.member.address, memberWallet.address.toLowerCase());
  assert.equal(res.body.member.hasAccess, true);
  assert.equal(res.body.templ.contract, contractAddress);
  assert.equal(res.body.templ.templHomeLink, '');
});

test('join endpoint rejects non-members', async (t) => {
  const { app, db } = makeApp({ hasPurchased: async () => false });
  t.after(async () => {
    await app.close?.();
    db.close();
  });

  const templWallet = Wallet.createRandom();
  const memberWallet = Wallet.createRandom();
  const { contractAddress } = await registerTempl(app, templWallet);

  const res = await joinTempl(app, contractAddress, memberWallet);
  assert.equal(res.status, 403);
  assert.match(res.body.error, /Membership/);
});

test('list templs includes registered entries', async (t) => {
  const { app, db } = makeApp({ hasPurchased: async () => true });
  t.after(async () => {
    await app.close?.();
    db.close();
  });

  const templWallet = Wallet.createRandom();
  const { contractAddress } = await registerTempl(app, templWallet, { telegramChatId: 'chat-42' });

  const res = await request(app).get('/templs?include=chatId');
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.templs));
  const match = res.body.templs.find((row) => row.contract === contractAddress);
  assert.ok(match, 'templ present in listing');
  assert.equal(match.telegramChatId, 'chat-42');
  assert.equal(match.groupId, 'chat-42');
  assert.equal(match.templHomeLink, '');
});

test('register templ without chat id issues binding code', async (t) => {
  const { app, db } = makeApp();
  t.after(async () => {
    await app.close?.();
    db.close();
  });

  const wallet = Wallet.createRandom();
  const { contractAddress, response } = await registerTempl(app, wallet, { telegramChatId: null, templHomeLink: 'https://initial.link' });

  assert.equal(response.contract, contractAddress);
  assert.equal(response.telegramChatId, null);
  assert.equal(response.templHomeLink, 'https://initial.link');
  assert.ok(response.bindingCode);

  const record = app.locals.templs.get(contractAddress);
  assert.equal(record.bindingCode, response.bindingCode);
  assert.equal(record.templHomeLink, 'https://initial.link');
});
