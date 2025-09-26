import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { Wallet, Interface, ZeroAddress, getAddress } from 'ethers';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import Database from 'better-sqlite3';

import { createApp } from '../src/server.js';
import { buildCreateTypedData, buildJoinTypedData, buildRebindTypedData } from '../../shared/signing.js';

process.env.NODE_ENV = 'test';
process.env.BACKEND_SERVER_ID = 'test-server';
process.env.APP_BASE_URL = 'http://localhost:5173';


function createTestNotifier(notifications) {
  return {
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
}

function ensureContractState(contractState, key) {
  const existing = contractState.get(key);
  if (existing && typeof existing === 'object' && existing !== null) {
    if (!existing.activeProposals) existing.activeProposals = new Map();
    if (!existing.snapshots) existing.snapshots = new Map();
    return existing;
  }
  const state = {
    priestAddress: typeof existing === 'string' ? existing : null,
    activeProposals: new Map(),
    snapshots: new Map()
  };
  contractState.set(key, state);
  return state;
}

function createTestConnectContract(handlerRegistry, contractState = new Map()) {
  return (address) => {
    const key = String(address).toLowerCase();
    const state = ensureContractState(contractState, key);
    const entry = { handlers: {}, metadata: new Map(), priestAddress: state.priestAddress };
    handlerRegistry.set(key, entry);
    return {
      on: (event, handler) => {
        entry.handlers[event] = async (...args) => {
          if (event === 'PriestChanged') {
            const [, newPriest] = args;
            const nextPriest = newPriest ? String(newPriest).toLowerCase() : null;
            entry.priestAddress = nextPriest;
            state.priestAddress = nextPriest;
          }
          if (event === 'ProposalCreated') {
            const [id,, endTime, titleArg, descriptionArg] = args;
            entry.metadata.set(String(id), {
              title: titleArg ? String(titleArg) : '',
              description: descriptionArg ? String(descriptionArg) : ''
            });
            const proposalKey = String(id);
            const existingMeta = state.activeProposals.get(proposalKey) || {};
            state.activeProposals.set(proposalKey, {
              title: titleArg ? String(titleArg) : existingMeta.title || '',
              description: descriptionArg ? String(descriptionArg) : existingMeta.description || '',
              endTime: Number(endTime ?? existingMeta.endTime ?? 0),
              executed: false,
              passed: false
            });
          }
          if (event === 'ProposalExecuted') {
            const [id, success] = args;
            const proposalKey = String(id);
            const existingMeta = state.activeProposals.get(proposalKey);
            if (existingMeta) {
              existingMeta.executed = true;
              existingMeta.passed = Boolean(success);
            }
          }
          return handler(...args);
        };
      },
      async priest() {
        return state.priestAddress;
      },
      async getProposal(id) {
        const keyStr = String(id);
        const stored = entry.metadata.get(keyStr);
        const stateMeta = state.activeProposals.get(keyStr) || {};
        return {
          proposer: null,
          yesVotes: 0,
          noVotes: 0,
          endTime: stateMeta.endTime ?? 0,
          executed: Boolean(stateMeta.executed),
          passed: Boolean(stateMeta.passed),
          title: stored?.title ?? stateMeta.title ?? '',
          description: stored?.description ?? stateMeta.description ?? ''
        };
      },
      async getProposalSnapshots(id) {
        const keyStr = String(id);
        const snapshot = state.snapshots.get(keyStr);
        if (!snapshot) return [0, 0, 0, 0, 0, 0];
        return [snapshot.yesVotes ?? 0, snapshot.noVotes ?? 0, 0, 0, 0, snapshot.quorumReachedAt ?? 0];
      },
      async getActiveProposals() {
        return Array.from(state.activeProposals.keys()).map((proposalId) => BigInt(proposalId));
      },
      async treasuryBalance() {
        return 0n;
      },
      async memberPoolBalance() {
        return 0n;
      }
    };
  };
}

function createTestProvider(contractState) {
  const iface = new Interface(['function priest() view returns (address)']);
  const encodedPriestCall = iface.encodeFunctionData('priest');
  return {
    async call({ to, data }) {
      if (data !== encodedPriestCall) {
        return '0x';
      }
      const key = String(to || '').toLowerCase();
      const stored = contractState.get(key);
      const priestAddress = stored && typeof stored === 'object' && stored !== null
        ? stored.priestAddress
        : stored;
      const response = priestAddress ? getAddress(priestAddress) : ZeroAddress;
      return iface.encodeFunctionResult('priest', [response]);
    },
    async getNetwork() {
      return { chainId: 1337 };
    },
    async getCode(address) {
      const key = String(address || '').toLowerCase();
      return contractState.has(key) ? '0x1' : '0x';
    }
  };
}


function makeApp({ hasPurchased = async () => true } = {}) {
  const tmpDir = mkdtempSync(join(os.tmpdir(), 'templ-backend-'));
  const dbPath = join(tmpDir, 'groups.db');
  const db = new Database(dbPath);
  const notifications = [];
  const handlerRegistry = new Map();
  const contractState = new Map();
  const notifier = createTestNotifier(notifications);
  const connectContract = createTestConnectContract(handlerRegistry, contractState);
  const provider = createTestProvider(contractState);
  const app = createApp({ hasPurchased, db, connectContract, provider, telegram: { notifier } });
  return { app, db, tmpDir, notifications, handlerRegistry, contractState, connectContract, provider };
}

async function registerTempl(app, wallet, { telegramChatId = '12345', templHomeLink } = {}, options = {}) {
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
  const contractKey = contractAddress.toLowerCase();
  if (options.contractState) {
    const state = ensureContractState(options.contractState, contractKey);
    state.priestAddress = wallet.address.toLowerCase();
  }
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
  const { app, db, tmpDir, notifications, handlerRegistry, contractState } = makeApp();
  t.after(async () => {
    await app.close?.();
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const wallet = Wallet.createRandom();
  const { contractAddress, response } = await registerTempl(app, wallet, { telegramChatId: 'telegram-chat-1' }, { contractState });

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

  const storedRow = db.prepare('SELECT telegramChatId FROM templ_bindings WHERE contract = ?').get(contractAddress);
  assert.equal(storedRow?.telegramChatId, 'telegram-chat-1');
});

test('join endpoint validates membership', async (t) => {
  const { app, db, tmpDir, contractState } = makeApp({ hasPurchased: async () => true });
  t.after(async () => {
    await app.close?.();
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const templWallet = Wallet.createRandom();
  const memberWallet = Wallet.createRandom();
  const { contractAddress } = await registerTempl(app, templWallet, undefined, { contractState });

  const res = await joinTempl(app, contractAddress, memberWallet);
  assert.equal(res.status, 200);
  assert.equal(res.body.member.address, memberWallet.address.toLowerCase());
  assert.equal(res.body.member.hasAccess, true);
  assert.equal(res.body.templ.contract, contractAddress);
  assert.equal(res.body.templ.templHomeLink, '');
});

test('join endpoint rejects non-members', async (t) => {
  const { app, db, tmpDir, contractState } = makeApp({ hasPurchased: async () => false });
  t.after(async () => {
    await app.close?.();
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const templWallet = Wallet.createRandom();
  const memberWallet = Wallet.createRandom();
  const { contractAddress } = await registerTempl(app, templWallet, undefined, { contractState });

  const res = await joinTempl(app, contractAddress, memberWallet);
  assert.equal(res.status, 403);
  assert.match(res.body.error, /Membership/);
});

test('list templs includes registered entries', async (t) => {
  const { app, db, tmpDir, contractState } = makeApp({ hasPurchased: async () => true });
  t.after(async () => {
    await app.close?.();
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const templWallet = Wallet.createRandom();
  const { contractAddress } = await registerTempl(app, templWallet, { telegramChatId: 'chat-42' }, { contractState });

  const res = await request(app).get('/templs?include=chatId');
  assert.equal(res.status, 403);
  assert.match(res.body.error, /chat id/i);
  const safeRes = await request(app).get('/templs');
  assert.equal(safeRes.status, 200);
  assert.ok(Array.isArray(safeRes.body.templs));
  const match = safeRes.body.templs.find((row) => row.contract === contractAddress);
  assert.ok(match, 'templ present in listing');
  assert.equal(match.telegramChatId, undefined);
  assert.equal(match.groupId, undefined);
  assert.equal(match.templHomeLink, undefined);
});

test('templs listing exposes home links but never chat ids', async (t) => {
  const { app, db, tmpDir, contractState } = makeApp({ hasPurchased: async () => true });
  t.after(async () => {
    await app.close?.();
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const templWallet = Wallet.createRandom();
  const { contractAddress } = await registerTempl(app, templWallet, { telegramChatId: 'chat-77', templHomeLink: 'https://templ.fun/demo' }, { contractState });

  const res = await request(app).get('/templs?include=homeLink');
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.templs));
  const match = res.body.templs.find((row) => row.contract === contractAddress);
  assert.ok(match, 'templ present in listing');
  assert.equal(match.templHomeLink, 'https://templ.fun/demo');
  assert.equal(match.telegramChatId, undefined);
  assert.equal(match.groupId, undefined);
});

test('register templ without chat id issues binding code', async (t) => {
  const { app, db, tmpDir, contractState } = makeApp();
  t.after(async () => {
    await app.close?.();
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const wallet = Wallet.createRandom();
  const { contractAddress, response } = await registerTempl(app, wallet, { telegramChatId: null, templHomeLink: 'https://initial.link' }, { contractState });

  assert.equal(response.contract, contractAddress);
  assert.equal(response.telegramChatId, null);
  assert.equal(response.templHomeLink, 'https://initial.link');
  assert.ok(response.bindingCode);

  const record = app.locals.templs.get(contractAddress);
  assert.equal(record.bindingCode, response.bindingCode);
  assert.equal(record.templHomeLink, 'https://initial.link');

  const mappingRow = db.prepare('SELECT telegramChatId FROM templ_bindings WHERE contract = ?').get(contractAddress);
  assert.ok(mappingRow, 'templ persisted without chat');
  assert.equal(mappingRow.telegramChatId, null);
});

test('signature replay rejected after restart with shared store', async (t) => {
  let { app, db, tmpDir, contractState } = makeApp();
  let appReload = null;
  const wallet = Wallet.createRandom();
  const hasPurchased = async () => true;
  t.after(async () => {
    await app?.close?.();
    await appReload?.close?.();
    db?.close?.();
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  const dbPath = join(tmpDir, 'groups.db');
  const issuedAt = Date.now();
  const chainId = 1337;
  const typed = buildCreateTypedData({
    chainId,
    contractAddress: wallet.address.toLowerCase(),
    nonce: 1n,
    issuedAt,
    expiry: issuedAt + 60_000
  });
  const signature = await wallet.signTypedData(typed.domain, typed.types, typed.message);

  const registerRes = await request(app)
    .post('/templs')
    .send({
      contractAddress: wallet.address,
      priestAddress: wallet.address,
      chainId,
      nonce: typed.message.nonce,
      issuedAt: typed.message.issuedAt,
      expiry: typed.message.expiry,
      signature
    });
  assert.equal(registerRes.status, 200);

  await app.close?.();
  app = null;
  db.close();

  const dbReload = new Database(dbPath);
  appReload = createApp({ hasPurchased, db: dbReload, connectContract: createTestConnectContract(new Map(), contractState) });
  await appReload.locals.restorationPromise;

  const replayRes = await request(appReload)
    .post('/templs')
    .send({
      contractAddress: wallet.address,
      priestAddress: wallet.address,
      nonce: typed.message.nonce,
      issuedAt: typed.message.issuedAt,
      expiry: typed.message.expiry,
      signature
    });
  assert.equal(replayRes.status, 409);
  assert.match(replayRes.body.error, /signature/i);
});

test('templ without chat binding survives restart', async (t) => {
  let { app, db, tmpDir, contractState } = makeApp();
  let appReload = null;
  let dbReload = null;
  const hasPurchased = async () => true;
  t.after(async () => {
    await app?.close?.();
    await appReload?.close?.();
    try { db?.close?.(); } catch (err) { void err; }
    try { dbReload?.close?.(); } catch (err) { void err; }
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  const dbPath = join(tmpDir, 'groups.db');
  const wallet = Wallet.createRandom();
  const { contractAddress, response } = await registerTempl(app, wallet, { telegramChatId: null }, { contractState });
  assert.ok(response.bindingCode);

  const initialRow = db.prepare('SELECT telegramChatId FROM templ_bindings WHERE contract = ?').get(contractAddress);
  assert.ok(initialRow, 'row persisted during initial registration');
  assert.equal(initialRow.telegramChatId, null);

  await app.close?.();
  app = null;
  db.close();
  db = null;

  dbReload = new Database(dbPath);
  const notifications = [];
  const handlerRegistry = new Map();
  const notifier = createTestNotifier(notifications);
  const connectContract = createTestConnectContract(handlerRegistry, contractState);
  appReload = createApp({ hasPurchased, db: dbReload, connectContract, telegram: { notifier } });
  await appReload.locals.restorationPromise;

  const restored = appReload.locals.templs.get(contractAddress);
  assert.ok(restored, 'templ restored into memory');
  assert.equal(restored.telegramChatId, null);

  const listRes = await request(appReload).get('/templs');
  assert.equal(listRes.status, 200);
  const listed = listRes.body.templs.find((row) => row.contract === contractAddress);
  assert.ok(listed, 'templ listed after restart');
  assert.equal(listed.telegramChatId, undefined);
  assert.equal(listed.priest, wallet.address.toLowerCase());

  const memberWallet = Wallet.createRandom();
  const joinRes = await joinTempl(appReload, contractAddress, memberWallet);
  assert.equal(joinRes.status, 200);
  assert.equal(joinRes.body.templ.contract, contractAddress);
  assert.equal(joinRes.body.templ.priest, wallet.address.toLowerCase());

  const persistedRow = dbReload.prepare('SELECT telegramChatId FROM templ_bindings WHERE contract = ?').get(contractAddress);
  assert.ok(persistedRow, 'row still present after restart');
  assert.equal(persistedRow.telegramChatId, null);
});

test('active proposals are backfilled after restart', async (t) => {
  const { app, db, tmpDir, handlerRegistry, contractState } = makeApp();
  let appReload = null;
  let dbReload = null;
  t.after(async () => {
    await app?.close?.();
    await appReload?.close?.();
    try { db?.close?.(); } catch (err) { void err; }
    try { dbReload?.close?.(); } catch (err) { void err; }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const dbPath = join(tmpDir, 'groups.db');
  const wallet = Wallet.createRandom();
  const { contractAddress } = await registerTempl(app, wallet, { telegramChatId: 'chat-restore' }, { contractState });
  const entry = handlerRegistry.get(contractAddress);
  assert.ok(entry, 'contract handlers registered');

  const nowSeconds = Math.floor(Date.now() / 1000);
  const endTime = BigInt(nowSeconds + 3_600);
  await entry.handlers.ProposalCreated(1n, wallet.address, endTime, 'Backfilled proposal', 'Restored metadata');
  const state = ensureContractState(contractState, contractAddress);
  state.snapshots.set('1', { quorumReachedAt: nowSeconds - 120 });

  await app.close?.();
  db.close();

  dbReload = new Database(dbPath);
  const connectContract = createTestConnectContract(new Map(), contractState);
  appReload = createApp({ hasPurchased: async () => true, db: dbReload, connectContract, telegram: { notifier: createTestNotifier([]) } });
  await appReload.locals.restorationPromise;

  const restored = appReload.locals.templs.get(contractAddress);
  assert.ok(restored?.proposalsMeta?.has?.('1'));
  const meta = restored.proposalsMeta.get('1');
  assert.equal(meta.title, 'Backfilled proposal');
  assert.equal(meta.description, 'Restored metadata');
  assert.equal(meta.quorumNotified, true);
  assert.equal(meta.votingClosedNotified, false);
  assert.ok(meta.endTime > nowSeconds);
});

test('priest can request telegram rebind with signature', async (t) => {
  const { app, db, tmpDir, contractState } = makeApp();
  t.after(async () => {
    await app.close?.();
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const wallet = Wallet.createRandom();
  const { contractAddress } = await registerTempl(app, wallet, { telegramChatId: 'chat-old' }, { contractState });

  const typed = buildRebindTypedData({ chainId: 1337, contractAddress });
  const signature = await wallet.signTypedData(typed.domain, typed.types, typed.message);

  const res = await request(app)
    .post('/templs/rebind')
    .send({
      contractAddress,
      priestAddress: wallet.address,
      signature,
      chainId: 1337,
      nonce: typed.message.nonce,
      issuedAt: typed.message.issuedAt,
      expiry: typed.message.expiry
    });

  assert.equal(res.status, 200);
  assert.equal(res.body.contract, contractAddress);
  assert.equal(res.body.telegramChatId, null);
  assert.ok(res.body.bindingCode);

  const record = app.locals.templs.get(contractAddress);
  assert.equal(record?.bindingCode, res.body.bindingCode);
  assert.equal(record?.telegramChatId, null);

  const mappingRow = db.prepare('SELECT telegramChatId FROM templ_bindings WHERE contract = ?').get(contractAddress);
  assert.ok(mappingRow, 'templ persisted without chat across rebind');
  assert.equal(mappingRow.telegramChatId, null);
});

test('rebind rejects signatures from non-priest wallet', async (t) => {
  const { app, db, tmpDir, contractState } = makeApp();
  t.after(async () => {
    await app.close?.();
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const priestWallet = Wallet.createRandom();
  const { contractAddress } = await registerTempl(app, priestWallet, { telegramChatId: 'chat-old' }, { contractState });
  const intruder = Wallet.createRandom();

  const typed = buildRebindTypedData({ chainId: 1337, contractAddress });
  const signature = await intruder.signTypedData(typed.domain, typed.types, typed.message);

  const res = await request(app)
    .post('/templs/rebind')
    .send({
      contractAddress,
      priestAddress: priestWallet.address,
      signature,
      chainId: 1337,
      nonce: typed.message.nonce,
      issuedAt: typed.message.issuedAt,
      expiry: typed.message.expiry
    });

  assert.equal(res.status, 403);
  assert.match(res.body.error, /signature/i);
});

test('rebind rejects non-priest after restart when cache is missing priest', async (t) => {
  const { app, db, tmpDir, contractState } = makeApp();
  t.after(async () => {
    await app.close?.();
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const priestWallet = Wallet.createRandom();
  const { contractAddress } = await registerTempl(app, priestWallet, { telegramChatId: 'chat-old' }, { contractState });

  const cachedRecord = app.locals.templs.get(contractAddress);
  assert.ok(cachedRecord, 'record should exist in cache');
  cachedRecord.priest = null;
  app.locals.templs.set(contractAddress, cachedRecord);
  db.prepare('UPDATE templ_bindings SET priest = NULL WHERE contract = ?').run(contractAddress);

  const intruder = Wallet.createRandom();
  const typed = buildRebindTypedData({ chainId: 1337, contractAddress });
  const signature = await intruder.signTypedData(typed.domain, typed.types, typed.message);

  const res = await request(app)
    .post('/templs/rebind')
    .send({
      contractAddress,
      priestAddress: intruder.address,
      signature,
      chainId: 1337,
      nonce: typed.message.nonce,
      issuedAt: typed.message.issuedAt,
      expiry: typed.message.expiry
    });

  assert.equal(res.status, 403);
  assert.match(res.body.error, /priest/i);
  const reloaded = app.locals.templs.get(contractAddress);
  assert.equal(reloaded?.priest, null);
});
