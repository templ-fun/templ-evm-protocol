import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { Wallet, Interface, ZeroAddress, getAddress } from 'ethers';
import { createApp } from '../src/server.js';
import { buildCreateTypedData, buildJoinTypedData, buildRebindTypedData } from '../../shared/signing.js';
import { createMemoryPersistence } from '../src/persistence/index.js';

process.env.NODE_ENV = 'test';
process.env.BACKEND_SERVER_ID = 'test-server';
process.env.APP_BASE_URL = 'http://localhost:5173';


function createTestNotifier(notifications) {
  return {
    notifyMemberJoined: async (payload) => notifications.push({ type: 'access', payload }),
    notifyProposalCreated: async (payload) => notifications.push({ type: 'proposal', payload }),
    notifyVoteCast: async (payload) => notifications.push({ type: 'vote', payload }),
    notifyPriestChanged: async (payload) => notifications.push({ type: 'priest', payload }),
    notifyProposalQuorumReached: async (payload) => notifications.push({ type: 'quorum', payload }),
    notifyProposalVotingClosed: async (payload) => notifications.push({ type: 'votingClosed', payload }),
    notifyDailyDigest: async (payload) => notifications.push({ type: 'digest', payload }),
    notifyTemplHomeLinkUpdated: async (payload) => notifications.push({ type: 'homeLink', payload }),
    notifyBindingComplete: async (payload) => notifications.push({ type: 'binding', payload }),
    notifyProposalExecuted: async (payload) => notifications.push({ type: 'proposalExecuted', payload }),
    notifyMemberRewardsClaimed: async (payload) => notifications.push({ type: 'memberClaimed', payload }),
    notifyExternalRewardClaimed: async (payload) => notifications.push({ type: 'externalClaimed', payload }),
    notifyJoinPauseUpdated: async (payload) => notifications.push({ type: 'paused', payload }),
    notifyConfigUpdated: async (payload) => notifications.push({ type: 'config', payload }),
    notifyTreasuryAction: async (payload) => notifications.push({ type: 'treasuryAction', payload }),
    notifyTreasuryDisbanded: async (payload) => notifications.push({ type: 'treasuryDisbanded', payload }),
    notifyDictatorshipModeChanged: async (payload) => notifications.push({ type: 'dictatorship', payload }),
    notifyMaxMembersUpdated: async (payload) => notifications.push({ type: 'maxMembers', payload }),
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
    snapshots: new Map(),
    homeLink: ''
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
          if (event === 'TemplHomeLinkUpdated') {
            const [, newLink] = args;
            state.homeLink = newLink ? String(newLink) : state.homeLink;
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
      async templHomeLink() {
        return state.homeLink || '';
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
  const iface = new Interface([
    'function priest() view returns (address)',
    'function templHomeLink() view returns (string)'
  ]);
  return {
    async call({ to, data }) {
      let parsed;
      try {
        parsed = iface.parseTransaction({ data });
      } catch {
        return '0x';
      }
      const key = String(to || '').toLowerCase();
      const stored = contractState.get(key);
      if (!stored || typeof stored !== 'object') {
        if (parsed?.name === 'priest') {
          return iface.encodeFunctionResult('priest', [ZeroAddress]);
        }
        if (parsed?.name === 'templHomeLink') {
          return iface.encodeFunctionResult('templHomeLink', ['']);
        }
        return '0x';
      }
      if (parsed?.name === 'priest') {
        const priestAddress = stored.priestAddress ? getAddress(stored.priestAddress) : ZeroAddress;
        return iface.encodeFunctionResult('priest', [priestAddress]);
      }
      if (parsed?.name === 'templHomeLink') {
        return iface.encodeFunctionResult('templHomeLink', [stored.homeLink || '']);
      }
      return '0x';
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


async function makeApp({ hasJoined = async () => true, persistence = createMemoryPersistence() } = {}) {
  const notifications = [];
  const handlerRegistry = new Map();
  const contractState = new Map();
  const notifier = createTestNotifier(notifications);
  const connectContract = createTestConnectContract(handlerRegistry, contractState);
  const provider = createTestProvider(contractState);
  const app = await createApp({ hasJoined, persistence, connectContract, provider, telegram: { notifier } });
  return { app, persistence, notifications, handlerRegistry, contractState, connectContract, provider };
}

async function registerTempl(app, wallet, { telegramChatId = '12345', templHomeLink } = {}, options = {}) {
  const contractAddress = wallet.address;
  const typed = buildCreateTypedData({ chainId: 1337, contractAddress: contractAddress.toLowerCase() });
  const signature = await wallet.signTypedData(typed.domain, typed.types, typed.message);
  if (options.contractState) {
    const state = ensureContractState(options.contractState, contractAddress.toLowerCase());
    state.priestAddress = wallet.address.toLowerCase();
    if (templHomeLink) {
      state.homeLink = templHomeLink;
    }
  }
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
  const { app, persistence, notifications, handlerRegistry, contractState } = await makeApp();
  t.after(async () => {
    await app.close?.();
  });

  const wallet = Wallet.createRandom();
  const { contractAddress, response } = await registerTempl(app, wallet, { telegramChatId: '-1000000000001' }, { contractState });

  assert.equal(response.contract, contractAddress);
  assert.equal(response.priest, wallet.address.toLowerCase());
  assert.equal(response.telegramChatId, '-1000000000001');
  assert.equal(response.groupId, '-1000000000001');
  assert.equal(response.templHomeLink, '');
  assert.equal(response.bindingCode, null);

  const entry = handlerRegistry.get(contractAddress);
  assert.ok(entry, 'contract handlers registered');
  const { handlers, metadata } = entry;
  assert.equal(typeof handlers.MemberJoined, 'function');
  assert.equal(typeof handlers.ProposalCreated, 'function');
  assert.equal(typeof handlers.VoteCast, 'function');
  assert.equal(typeof handlers.PriestChanged, 'function');
  assert.equal(typeof handlers.ProposalExecuted, 'function');
  assert.equal(typeof handlers.TemplHomeLinkUpdated, 'function');
  assert.equal(typeof handlers.MemberRewardsClaimed, 'function');
  assert.equal(typeof handlers.ExternalRewardClaimed, 'function');
  assert.equal(typeof handlers.JoinPauseUpdated, 'function');
  assert.equal(typeof handlers.ConfigUpdated, 'function');
  assert.equal(typeof handlers.TreasuryAction, 'function');
  assert.equal(typeof handlers.TreasuryDisbanded, 'function');
  assert.equal(typeof handlers.DictatorshipModeChanged, 'function');
  assert.equal(typeof handlers.MaxMembersUpdated, 'function');

  await handlers.MemberJoined(wallet.address, wallet.address, 0n, 0n, 0n, 0n, 0n, 1n, 0n, 2n);
  const lastAccess = notifications.at(-1);
  assert.equal(lastAccess?.type, 'access');
  assert.equal(lastAccess?.payload?.memberAddress?.toLowerCase?.(), wallet.address.toLowerCase());
  assert.equal(lastAccess?.payload?.payerAddress?.toLowerCase?.(), wallet.address.toLowerCase());
  assert.equal(lastAccess?.payload?.joinId, '2');
  await handlers.ProposalCreated(1n, wallet.address, 1234n, 'Proposal title', 'Proposal description');
  assert.equal(notifications.at(-1)?.type, 'proposal');
  await handlers.VoteCast(1n, wallet.address, true, 5678n);
  assert.equal(notifications.at(-1)?.type, 'vote');
  await handlers.PriestChanged(wallet.address, wallet.address);
  assert.equal(notifications.at(-1)?.type, 'priest');
  await handlers.MemberRewardsClaimed(wallet.address, 10n, 123n);
  assert.equal(notifications.at(-1)?.type, 'memberClaimed');
  await handlers.ExternalRewardClaimed(wallet.address, wallet.address, 20n);
  assert.equal(notifications.at(-1)?.type, 'externalClaimed');
  await handlers.JoinPauseUpdated(true);
  assert.equal(notifications.at(-1)?.type, 'paused');
  await handlers.ConfigUpdated('0xToken', 1n, 10, 20, 30, 40);
  assert.equal(notifications.at(-1)?.type, 'config');
  await handlers.TreasuryAction(1n, '0xToken', wallet.address, 5n, 'Distribution');
  assert.equal(notifications.at(-1)?.type, 'treasuryAction');
  await handlers.TreasuryDisbanded(1n, '0xToken', 100n, 2n, 0n);
  assert.equal(notifications.at(-1)?.type, 'treasuryDisbanded');
  await handlers.DictatorshipModeChanged(true);
  assert.equal(notifications.at(-1)?.type, 'dictatorship');
  await handlers.MaxMembersUpdated(42n);
  assert.equal(notifications.at(-1)?.type, 'maxMembers');

  const expectedTypes = [
    'access',
    'proposal',
    'vote',
    'priest',
    'memberClaimed',
    'externalClaimed',
    'paused',
    'config',
    'treasuryAction',
    'treasuryDisbanded',
    'dictatorship',
    'maxMembers'
  ];
  assert.equal(notifications.length, expectedTypes.length);
  expectedTypes.forEach((type, index) => {
    assert.equal(notifications[index].type, type);
  });
  assert.equal(notifications[1].payload.title, 'Proposal title');
  assert.equal(notifications[1].payload.description, 'Proposal description');
  assert.equal(notifications[2].payload.title, 'Proposal title');
  const storedMeta = metadata.get('1');
  assert.equal(storedMeta?.title, 'Proposal title');
  const cacheRecord = app.locals.templs.get(contractAddress);
  assert.equal(cacheRecord?.proposalsMeta?.get?.('1')?.title, 'Proposal title');

  const bindings = await persistence.listBindings();
  const storedRow = bindings.find((row) => row.contract === contractAddress);
  assert.equal(storedRow?.telegramChatId, '-1000000000001');
  assert.equal(storedRow?.bindingCode, null);
});

test('proposal executed events capture execution success state', async (t) => {
  const { app, handlerRegistry, contractState, notifications } = await makeApp();
  t.after(async () => {
    await app.close?.();
  });

  const wallet = Wallet.createRandom();
  const { contractAddress } = await registerTempl(app, wallet, undefined, { contractState });
  const entry = handlerRegistry.get(contractAddress);
  assert.ok(entry, 'contract handlers registered');

  await entry.handlers.ProposalCreated(1n, wallet.address, 1234n, 'Successful proposal', '');
  await entry.handlers.ProposalExecuted(1n, true, '0x');
  assert.equal(notifications.at(-1)?.type, 'proposalExecuted');
  notifications.length = 0;

  const record = app.locals.templs.get(contractAddress);
  assert.ok(record?.proposalsMeta, 'proposal metadata tracked');
  const successMeta = record.proposalsMeta.get('1');
  assert.equal(successMeta?.executed, true);
  assert.equal(successMeta?.passed, true);

  await entry.handlers.ProposalCreated(2n, wallet.address, 1234n, 'Failed proposal', '');
  await entry.handlers.ProposalExecuted(2n, false, '0x');
  assert.equal(notifications.at(-1)?.type, 'proposalExecuted');
  const failedMeta = record.proposalsMeta.get('2');
  assert.equal(failedMeta?.executed, true);
  assert.equal(failedMeta?.passed, false);
});

test('join endpoint validates membership', async (t) => {
  const { app, contractState } = await makeApp({ hasJoined: async () => true });
  t.after(async () => {
    await app.close?.();
  });

  const templWallet = Wallet.createRandom();
  const memberWallet = Wallet.createRandom();
  const { contractAddress } = await registerTempl(app, templWallet, undefined, { contractState });

  const res = await joinTempl(app, contractAddress, memberWallet);
  assert.equal(res.status, 200);
  assert.equal(res.body.member.address, memberWallet.address.toLowerCase());
  assert.equal(res.body.member.isMember, true);
  assert.equal(res.body.templ.contract, contractAddress);
  assert.equal(res.body.templ.templHomeLink, '');
});

test('join endpoint rejects non-members', async (t) => {
  const { app, contractState } = await makeApp({ hasJoined: async () => false });
  t.after(async () => {
    await app.close?.();
  });

  const templWallet = Wallet.createRandom();
  const memberWallet = Wallet.createRandom();
  const { contractAddress } = await registerTempl(app, templWallet, undefined, { contractState });

  const res = await joinTempl(app, contractAddress, memberWallet);
  assert.equal(res.status, 403);
  assert.match(res.body.error, /Membership/);
});

test('list templs includes registered entries', async (t) => {
  const { app, contractState } = await makeApp({ hasJoined: async () => true });
  t.after(async () => {
    await app.close?.();
  });

  const templWallet = Wallet.createRandom();
  const { contractAddress } = await registerTempl(app, templWallet, { telegramChatId: '-1000000000042' }, { contractState });

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
  const { app, contractState } = await makeApp({ hasJoined: async () => true });
  t.after(async () => {
    await app.close?.();
  });

  const templWallet = Wallet.createRandom();
  const { contractAddress } = await registerTempl(app, templWallet, { telegramChatId: '-1000000000077', templHomeLink: 'https://templ.fun/demo' }, { contractState });

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
  const { app, persistence, contractState } = await makeApp();
  t.after(async () => {
    await app.close?.();
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

  const bindings = await persistence.listBindings();
  const mappingRow = bindings.find((row) => row.contract === contractAddress);
  assert.ok(mappingRow, 'templ persisted without chat');
  assert.equal(mappingRow.telegramChatId, null);
  assert.equal(mappingRow.bindingCode, response.bindingCode);
});

test('auto registration persists templ without requiring signature', async (t) => {
  const { app, persistence, contractState } = await makeApp();
  t.after(async () => {
    await app.close?.();
  });

  const wallet = Wallet.createRandom();
  const contractKey = wallet.address.toLowerCase();
  const state = ensureContractState(contractState, contractKey);
  state.priestAddress = contractKey;
  state.homeLink = 'https://auto.link';

  const res = await request(app)
    .post('/templs/auto')
    .send({ contractAddress: wallet.address });
  assert.equal(res.status, 200);
  assert.equal(res.body.contract, contractKey);
  assert.equal(res.body.priest, contractKey);
  assert.equal(res.body.templHomeLink, 'https://auto.link');

  const bindings = await persistence.listBindings();
  const row = bindings.find((item) => item.contract === contractKey);
  assert.ok(row, 'templ persisted after auto registration');
});

test('signature replay rejected after restart with shared store', async (t) => {
  const persistence = createMemoryPersistence();
  let { app, contractState } = await makeApp({ persistence });
  let appReload = null;
  const wallet = Wallet.createRandom();
  const hasJoined = async () => true;
  t.after(async () => {
    await app?.close?.();
    await appReload?.close?.();
  });

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

  appReload = await createApp({
    hasJoined,
    persistence,
    connectContract: createTestConnectContract(new Map(), contractState),
    telegram: { notifier: createTestNotifier([]) }
  });
  await appReload.locals.restorationPromise;
  await appReload.locals.leadershipReady;

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
  const persistence = createMemoryPersistence();
  let { app, contractState } = await makeApp({ persistence });
  let appReload = null;
  const hasJoined = async () => true;
  t.after(async () => {
    await app?.close?.();
    await appReload?.close?.();
  });

  const wallet = Wallet.createRandom();
  const { contractAddress, response } = await registerTempl(app, wallet, { telegramChatId: null }, { contractState });
  assert.ok(response.bindingCode);

  const bindings = await persistence.listBindings();
  const initialRow = bindings.find((row) => row.contract === contractAddress);
  assert.ok(initialRow, 'row persisted during initial registration');
  assert.equal(initialRow.telegramChatId, null);
  assert.equal(initialRow.bindingCode, response.bindingCode);

  await app.close?.();
  app = null;

  const notifications = [];
  const handlerRegistry = new Map();
  const notifier = createTestNotifier(notifications);
  const connectContract = createTestConnectContract(handlerRegistry, contractState);
  appReload = await createApp({ hasJoined, persistence, connectContract, telegram: { notifier } });
  await appReload.locals.restorationPromise;

  const restored = appReload.locals.templs.get(contractAddress);
  assert.ok(restored, 'templ restored into memory');
  assert.equal(restored.telegramChatId, null);
  assert.equal(restored.bindingCode, response.bindingCode);

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

  const afterJoinBindings = await persistence.listBindings();
  const persistedRow = afterJoinBindings.find((row) => row.contract === contractAddress);
  assert.ok(persistedRow, 'row still present after restart');
  assert.equal(persistedRow.telegramChatId, null);
  assert.equal(persistedRow.bindingCode, response.bindingCode);
});

test('active proposals are backfilled after restart', async (t) => {
  const persistence = createMemoryPersistence();
  const { app, handlerRegistry, contractState } = await makeApp({ persistence });
  let appReload = null;
  t.after(async () => {
    await app?.close?.();
    await appReload?.close?.();
  });

  const wallet = Wallet.createRandom();
  const { contractAddress } = await registerTempl(app, wallet, { telegramChatId: '-1000000000099' }, { contractState });
  const entry = handlerRegistry.get(contractAddress);
  assert.ok(entry, 'contract handlers registered');

  const nowSeconds = Math.floor(Date.now() / 1000);
  const endTime = BigInt(nowSeconds + 3_600);
  await entry.handlers.ProposalCreated(1n, wallet.address, endTime, 'Backfilled proposal', 'Restored metadata');
  const state = ensureContractState(contractState, contractAddress);
  state.snapshots.set('1', { quorumReachedAt: nowSeconds - 120 });

  await app.close?.();

  const connectContract = createTestConnectContract(new Map(), contractState);
  appReload = await createApp({
    hasJoined: async () => true,
    persistence,
    connectContract,
    telegram: { notifier: createTestNotifier([]) }
  });
  await appReload.locals.restorationPromise;
  await appReload.locals.leadershipReady;
  await appReload.locals.leadershipReady;

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
  const { app, persistence, contractState } = await makeApp();
  t.after(async () => {
    await app.close?.();
  });

  const wallet = Wallet.createRandom();
  const { contractAddress } = await registerTempl(app, wallet, { telegramChatId: '-1000000000101' }, { contractState });

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

  const bindings = await persistence.listBindings();
  const mappingRow = bindings.find((row) => row.contract === contractAddress);
  assert.ok(mappingRow, 'templ persisted without chat across rebind');
  assert.equal(mappingRow.telegramChatId, null);
  assert.equal(mappingRow.bindingCode, res.body.bindingCode);
});

test('rebind rejects signatures from non-priest wallet', async (t) => {
  const { app, contractState } = await makeApp();
  t.after(async () => {
    await app.close?.();
  });

  const priestWallet = Wallet.createRandom();
  const { contractAddress } = await registerTempl(app, priestWallet, { telegramChatId: '-1000000000101' }, { contractState });
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
  const { app, persistence, contractState } = await makeApp();
  t.after(async () => {
    await app.close?.();
  });

  const priestWallet = Wallet.createRandom();
  const { contractAddress } = await registerTempl(app, priestWallet, { telegramChatId: '-1000000000101' }, { contractState });

  const cachedRecord = app.locals.templs.get(contractAddress);
  assert.ok(cachedRecord, 'record should exist in cache');
  cachedRecord.priest = null;
  app.locals.templs.set(contractAddress, cachedRecord);
  await persistence.persistBinding(contractAddress, {
    telegramChatId: cachedRecord.telegramChatId,
    priest: null,
    bindingCode: cachedRecord.bindingCode
  });

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
