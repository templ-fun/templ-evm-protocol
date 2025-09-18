import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { EventEmitter } from 'node:events';
import { mkdtemp } from 'fs/promises';
import path from 'path';
import os from 'os';
import { makeApp, wallets } from './helpers.js';
import { buildCreateTypedData, buildJoinTypedData, buildDelegateTypedData, buildMuteTypedData } from '../../shared/signing.js';

const addresses = {
  contract: '0x0000000000000000000000000000000000000001',
  priest: wallets.priest.address,
  member: wallets.member.address,
  stranger: wallets.stranger.address,
  delegate: wallets.delegate.address
};

test('creates templ and returns group id', async () => {
  const fakeGroup = {
    id: 'group-0',
    addMembers: async () => {},
    removeMembers: async () => {}
  };
  const fakeXmtp = {
    inboxId: 'test-inbox-id',
    conversations: {
      newGroup: async () => fakeGroup
    }
  };
  const hasPurchased = async () => false;

  const app = makeApp({ xmtp: fakeXmtp, hasPurchased });
  const ctyped0 = buildCreateTypedData({ chainId: 1337, contractAddress: addresses.contract });
  const signature = await wallets.priest.signTypedData(ctyped0.domain, ctyped0.types, ctyped0.message);
  await request(app)
    .post('/templs')
    .send({
      contractAddress: addresses.contract,
      priestAddress: addresses.priest,
      signature,
      chainId: 1337,
      nonce: ctyped0.message.nonce,
      issuedAt: ctyped0.message.issuedAt,
      expiry: ctyped0.message.expiry
    })
    .expect(200, { groupId: fakeGroup.id });
  await app.close();
});

test('rejects templ creation with malformed addresses', async () => {
  const fakeGroup = { id: 'group-x', addMembers: async () => {}, removeMembers: async () => {} };
  const fakeXmtp = { 
    inboxId: 'test-inbox-id',
    conversations: { newGroup: async () => fakeGroup } 
  };
  const hasPurchased = async () => false;

  const app = makeApp({ xmtp: fakeXmtp, hasPurchased });
  const ctyped1 = buildCreateTypedData({ chainId: 1337, contractAddress: addresses.contract });
  const signature = await wallets.priest.signTypedData(ctyped1.domain, ctyped1.types, ctyped1.message);
  await request(app)
    .post('/templs')
    .send({
      contractAddress: 'not-an-address',
      priestAddress: 'also-bad',
      signature,
      chainId: 1337,
      nonce: ctyped1.message?.nonce ?? 1,
      issuedAt: ctyped1.message?.issuedAt ?? Date.now(),
      expiry: ctyped1.message?.expiry ?? Date.now() + 300000
    })
    .expect(400);
  await app.close();
});

test('rejects templ creation with bad signature', async () => {
  const fakeGroup = { id: 'group-y', addMembers: async () => {}, removeMembers: async () => {} };
  const fakeXmtp = { 
    inboxId: 'test-inbox-id',
    conversations: { newGroup: async () => fakeGroup } 
  };
  const hasPurchased = async () => false;

  const app = makeApp({ xmtp: fakeXmtp, hasPurchased });
  const ctyped2 = buildCreateTypedData({ chainId: 1337, contractAddress: addresses.contract });
  const signature = await wallets.member.signTypedData(ctyped2.domain, ctyped2.types, ctyped2.message);
  await request(app)
    .post('/templs')
    .send({
      contractAddress: addresses.contract,
      priestAddress: addresses.priest,
      signature,
      chainId: 1337
    })
    .expect(403);
  await app.close();
});

test('rejects join with malformed addresses', async () => {
  const app = makeApp({
    xmtp: { conversations: {} },
    hasPurchased: async () => true
  });
  const jtyped0 = buildJoinTypedData({ chainId: 1337, contractAddress: addresses.contract });
  const signature = await wallets.member.signTypedData(jtyped0.domain, jtyped0.types, jtyped0.message);
  await request(app)
    .post('/join')
    .send({
      contractAddress: 'not-an-address',
      memberAddress: 'also-bad',
      signature,
      chainId: 1337
    })
    .expect(400);
  await app.close();
});

test('rejects join with bad signature', async () => {
  const fakeGroup = { id: 'group-bad', addMembers: async () => {}, removeMembers: async () => {} };
  const fakeXmtp = { 
    inboxId: 'test-inbox-id',
    conversations: { newGroup: async () => fakeGroup } 
  };
  const hasPurchased = async () => true;

  const app = makeApp({ xmtp: fakeXmtp, hasPurchased });

  const ctyped3 = buildCreateTypedData({ chainId: 1337, contractAddress: addresses.contract });
  const templSig = await wallets.priest.signTypedData(ctyped3.domain, ctyped3.types, ctyped3.message);
  await request(app)
    .post('/templs')
    .send({
      contractAddress: addresses.contract,
      priestAddress: addresses.priest,
      signature: templSig,
      chainId: 1337,
      nonce: ctyped3.message.nonce,
      issuedAt: ctyped3.message.issuedAt,
      expiry: ctyped3.message.expiry
    })
    .expect(200);

  const jtyped1 = buildJoinTypedData({ chainId: 1337, contractAddress: addresses.contract });
  const badSig = await wallets.stranger.signTypedData(jtyped1.domain, jtyped1.types, jtyped1.message);
  await request(app)
    .post('/join')
    .send({
      contractAddress: addresses.contract,
      memberAddress: addresses.member,
      signature: badSig,
      chainId: 1337,
      nonce: jtyped1.message.nonce,
      issuedAt: jtyped1.message.issuedAt,
      expiry: jtyped1.message.expiry
    })
    .expect(403);
  await app.close();
});

test('rejects join for unknown templ', async () => {
  const app = makeApp({
    xmtp: { conversations: {} },
    hasPurchased: async () => true
  });

  const jtyped2 = buildJoinTypedData({ chainId: 1337, contractAddress: addresses.contract });
  const signature = await wallets.member.signTypedData(jtyped2.domain, jtyped2.types, jtyped2.message);
  await request(app)
    .post('/join')
    .send({
      contractAddress: addresses.contract,
      memberAddress: addresses.member,
      signature,
      chainId: 1337,
      nonce: jtyped2.message.nonce,
      issuedAt: jtyped2.message.issuedAt,
      expiry: jtyped2.message.expiry
    })
    .expect(404);
  await app.close();
});

test('responds with 403 when access not purchased', async () => {
  const fakeGroup = {
    id: 'group-deny',
    addMembers: async () => {},
    removeMembers: async () => {}
  };
  const fakeXmtp = {
    inboxId: 'test-inbox-id',
    conversations: {
      newGroup: async () => fakeGroup
    }
  };
  const hasPurchased = async () => false;

  const app = makeApp({ xmtp: fakeXmtp, hasPurchased });

  const ctyped5 = buildCreateTypedData({ chainId: 1337, contractAddress: addresses.contract });
  const templSig = await wallets.priest.signTypedData(ctyped5.domain, ctyped5.types, ctyped5.message);
  await request(app)
    .post('/templs')
    .send({
      contractAddress: addresses.contract,
      priestAddress: addresses.priest,
      signature: templSig,
      chainId: 1337,
      nonce: ctyped5.message.nonce,
      issuedAt: ctyped5.message.issuedAt,
      expiry: ctyped5.message.expiry
    })
    .expect(200);

  const jtyped4 = buildJoinTypedData({ chainId: 1337, contractAddress: addresses.contract });
  const joinSig = await wallets.member.signTypedData(jtyped4.domain, jtyped4.types, jtyped4.message);
  await request(app)
    .post('/join')
    .send({
      contractAddress: addresses.contract,
      memberAddress: addresses.member,
      signature: joinSig,
      chainId: 1337,
      nonce: jtyped4.message.nonce,
      issuedAt: jtyped4.message.issuedAt,
      expiry: jtyped4.message.expiry
    })
    .expect(403, { error: 'Access not purchased' });
  await app.close();
});

test('join requires on-chain purchase', async () => {
  const added = [];
  const fakeGroup = {
    id: 'group-1',
    addMembers: async (members) => {
      added.push(...members);
    },
    removeMembers: async () => {}
  };
  // Precompute expected inbox id and provide resolver on fake xmtp
  const { generateInboxId } = await import('@xmtp/node-sdk');
  const expectedInboxId = generateInboxId({ identifier: addresses.member.toLowerCase(), identifierKind: 0 });
  const fakeXmtp = {
    inboxId: 'test-inbox-id',
    conversations: {
      newGroup: async () => fakeGroup
    },
    findInboxIdByIdentifier: async (obj) => {
      if (obj && obj.identifier?.toLowerCase?.() === addresses.member.toLowerCase()) return expectedInboxId;
      return null;
    }
  };
  const purchased = new Set();
  const hasPurchased = async (_contract, member) =>
    purchased.has(member.toLowerCase());

  const app = makeApp({ xmtp: fakeXmtp, hasPurchased });

  let ctyped4 = buildCreateTypedData({ chainId: 1337, contractAddress: addresses.contract });
  let sig = await wallets.priest.signTypedData(ctyped4.domain, ctyped4.types, ctyped4.message);
  await request(app)
    .post('/templs')
    .send({
      contractAddress: addresses.contract,
      priestAddress: addresses.priest,
      signature: sig,
      chainId: 1337,
      nonce: ctyped4.message.nonce,
      issuedAt: ctyped4.message.issuedAt,
      expiry: ctyped4.message.expiry
    })
    .expect(200);

  let jtyped3 = buildJoinTypedData({ chainId: 1337, contractAddress: addresses.contract });
  sig = await wallets.member.signTypedData(jtyped3.domain, jtyped3.types, jtyped3.message);
  await request(app)
    .post('/join')
    .send({
      contractAddress: addresses.contract,
      memberAddress: addresses.member,
      signature: sig,
      chainId: 1337,
      nonce: jtyped3.message.nonce,
      issuedAt: jtyped3.message.issuedAt,
      expiry: jtyped3.message.expiry
    })
    .expect(403);

  purchased.add(addresses.member.toLowerCase());
  jtyped3 = buildJoinTypedData({ chainId: 1337, contractAddress: addresses.contract });
  sig = await wallets.member.signTypedData(jtyped3.domain, jtyped3.types, jtyped3.message);
  // expectedInboxId already computed above when mocking findInboxIdByIdentifier
  await request(app)
    .post('/join')
    .send({
      contractAddress: addresses.contract,
      memberAddress: addresses.member,
      signature: sig,
      chainId: 1337,
      nonce: jtyped3.message.nonce,
      issuedAt: jtyped3.message.issuedAt,
      expiry: jtyped3.message.expiry
    })
    .expect(200, { groupId: fakeGroup.id });

  // Now we add inbox IDs instead of addresses
  assert.deepEqual(added, [expectedInboxId]);
  await app.close();
});

test('responds with 500 when hasPurchased throws', async () => {
  const fakeGroup = {
    id: 'group-err',
    addMembers: async () => {},
    removeMembers: async () => {}
  };
  const fakeXmtp = {
    inboxId: 'test-inbox-id',
    conversations: {
      newGroup: async () => fakeGroup
    }
  };
  const hasPurchased = async () => {
    throw new Error('oops');
  };

  const app = makeApp({ xmtp: fakeXmtp, hasPurchased });

  const cx = buildCreateTypedData({ chainId: 1337, contractAddress: addresses.contract });
  const templSig = await wallets.priest.signTypedData(cx.domain, cx.types, cx.message);
  await request(app)
    .post('/templs')
    .send({
      contractAddress: addresses.contract,
      priestAddress: addresses.priest,
      signature: templSig,
      chainId: 1337,
      nonce: cx.message.nonce,
      issuedAt: cx.message.issuedAt,
      expiry: cx.message.expiry
    })
    .expect(200);

  const jx = buildJoinTypedData({ chainId: 1337, contractAddress: addresses.contract });
  const joinSig = await wallets.member.signTypedData(jx.domain, jx.types, jx.message);
  await request(app)
    .post('/join')
    .send({
      contractAddress: addresses.contract,
      memberAddress: addresses.member,
      signature: joinSig,
      chainId: 1337,
      nonce: jx.message.nonce,
      issuedAt: jx.message.issuedAt,
      expiry: jx.message.expiry
    })
    .expect(500, { error: 'Purchase check failed' });
  await app.close();
});

test('join returns 503 when member identity is missing', async () => {
  const fakeGroup = { id: 'group-missing', addMembers: async () => {}, removeMembers: async () => {} };
  const fakeXmtp = {
    inboxId: 'test-inbox-id',
    conversations: { newGroup: async () => fakeGroup },
    findInboxIdByIdentifier: async () => null
  };
  const hasPurchased = async () => true;

  const app = makeApp({ xmtp: fakeXmtp, hasPurchased });

  const ctyped6 = buildCreateTypedData({ chainId: 1337, contractAddress: addresses.contract });
  const templSig = await wallets.priest.signTypedData(ctyped6.domain, ctyped6.types, ctyped6.message);
  await request(app)
    .post('/templs')
    .send({
      contractAddress: addresses.contract,
      priestAddress: addresses.priest,
      signature: templSig,
      chainId: 1337,
      nonce: ctyped6.message.nonce,
      issuedAt: ctyped6.message.issuedAt,
      expiry: ctyped6.message.expiry
    })
    .expect(200);

  const jtypedX = buildJoinTypedData({ chainId: 1337, contractAddress: addresses.contract });
  const joinSig = await wallets.member.signTypedData(jtypedX.domain, jtypedX.types, jtypedX.message);
  const originalSetTimeout = setTimeout;
  try {
    // Collapse retries to avoid long waits
    global.setTimeout = (fn, ms, ...args) => originalSetTimeout(fn, 0, ...args);
    await request(app)
      .post('/join')
      .send({
        contractAddress: addresses.contract,
        memberAddress: addresses.member,
        signature: joinSig,
        chainId: 1337,
        nonce: jtypedX.message.nonce,
        issuedAt: jtypedX.message.issuedAt,
        expiry: jtypedX.message.expiry
      })
      .expect(503);
  } finally {
    global.setTimeout = originalSetTimeout;
  }
  await app.close();
});

test('rate limits after 100 requests', async () => {
  const app = makeApp({ xmtp: { conversations: {} }, hasPurchased: async () => true });
  for (let i = 0; i < 100; i++) {
    await request(app)
      .post('/join')
      .send({
        contractAddress: 'not-an-address',
        memberAddress: 'also-bad',
        signature: '0x',
        chainId: 1337
      })
      .expect(400);
  }
  await request(app)
    .post('/join')
    .send({
      contractAddress: 'not-an-address',
      memberAddress: 'also-bad',
      signature: '0x',
      chainId: 1337
    })
    .expect(429);
  await app.close();
});

test('only authorized addresses can mute members', async () => {
  const fakeGroup = {
    id: 'group-2',
    addMembers: async () => {},
    removeMembers: async () => {}
  };
  const fakeXmtp = {
    inboxId: 'test-inbox-id',
    conversations: {
      newGroup: async () => fakeGroup
    }
  };
  const hasPurchased = async () => true;

  const app = makeApp({ xmtp: fakeXmtp, hasPurchased });

  // Use typed EIP-712 signature for templ creation
  const ctypedX = buildCreateTypedData({ chainId: 1337, contractAddress: addresses.contract });
  let templSig = await wallets.priest.signTypedData(ctypedX.domain, ctypedX.types, ctypedX.message);
  await request(app)
    .post('/templs')
    .send({
      contractAddress: addresses.contract,
      priestAddress: addresses.priest,
      signature: templSig,
      chainId: 1337,
      nonce: ctypedX.message.nonce,
      issuedAt: ctypedX.message.issuedAt,
      expiry: ctypedX.message.expiry
    })
    .expect(200);

  let mtyped0 = buildMuteTypedData({ chainId: 1337, contractAddress: addresses.contract, targetAddress: addresses.member });
  let muteSig = await wallets.stranger.signTypedData(mtyped0.domain, mtyped0.types, mtyped0.message);
  await request(app)
    .post('/mute')
    .send({
      contractAddress: addresses.contract,
      moderatorAddress: addresses.stranger,
      targetAddress: addresses.member,
      signature: muteSig,
      chainId: 1337
    })
    .expect(403);

  mtyped0 = buildMuteTypedData({ chainId: 1337, contractAddress: addresses.contract, targetAddress: addresses.member });
  muteSig = await wallets.priest.signTypedData(mtyped0.domain, mtyped0.types, mtyped0.message);
  const resp = await request(app)
    .post('/mute')
    .send({
      contractAddress: addresses.contract,
      moderatorAddress: addresses.priest,
      targetAddress: addresses.member,
      signature: muteSig,
      chainId: 1337,
      nonce: mtyped0.message.nonce,
      issuedAt: mtyped0.message.issuedAt,
      expiry: mtyped0.message.expiry
    })
    .expect(200);

  assert.ok(resp.body.mutedUntil > Date.now());
  const list = await request(app)
    .get('/mutes')
    .query({ contractAddress: addresses.contract })
    .expect(200);
  assert.deepEqual(list.body.mutes, [
    {
      address: addresses.member.toLowerCase(),
      count: 1,
      until: resp.body.mutedUntil
    }
  ]);
  await app.close();
});

test('priest can delegate mute power', async () => {
  const fakeGroup = { id: 'group-deleg', addMembers: async () => {}, removeMembers: async () => {} };
  const fakeXmtp = { 
    inboxId: 'test-inbox-id',
    conversations: { newGroup: async () => fakeGroup } 
  };
  const hasPurchased = async () => true;

  const app = makeApp({ xmtp: fakeXmtp, hasPurchased });

  const ctyped7 = buildCreateTypedData({ chainId: 1337, contractAddress: addresses.contract });
  const templSig = await wallets.priest.signTypedData(ctyped7.domain, ctyped7.types, ctyped7.message);
  await request(app)
    .post('/templs')
    .send({
      contractAddress: addresses.contract,
      priestAddress: addresses.priest,
      signature: templSig,
      chainId: 1337,
      nonce: ctyped7.message.nonce,
      issuedAt: ctyped7.message.issuedAt,
      expiry: ctyped7.message.expiry
    })
    .expect(200);

  let dtyped0 = buildDelegateTypedData({ chainId: 1337, contractAddress: addresses.contract, delegateAddress: addresses.delegate });
  let delSig = await wallets.priest.signTypedData(dtyped0.domain, dtyped0.types, dtyped0.message);
  await request(app)
    .post('/delegateMute')
    .send({
      contractAddress: addresses.contract,
      priestAddress: addresses.priest,
      delegateAddress: addresses.delegate,
      signature: delSig,
      chainId: 1337,
      nonce: dtyped0.message.nonce,
      issuedAt: dtyped0.message.issuedAt,
      expiry: dtyped0.message.expiry
    })
    .expect(200, { delegated: true });

  const mtyped2 = buildMuteTypedData({ chainId: 1337, contractAddress: addresses.contract, targetAddress: addresses.member });
  const muteSig = await wallets.delegate.signTypedData(mtyped2.domain, mtyped2.types, mtyped2.message);
  await request(app)
    .post('/mute')
    .send({
      contractAddress: addresses.contract,
      moderatorAddress: addresses.delegate,
      targetAddress: addresses.member,
      signature: muteSig,
      chainId: 1337,
      nonce: mtyped2.message.nonce,
      issuedAt: mtyped2.message.issuedAt,
      expiry: mtyped2.message.expiry
    })
    .expect(200);

  dtyped0 = buildDelegateTypedData({ chainId: 1337, contractAddress: addresses.contract, delegateAddress: addresses.delegate });
  delSig = await wallets.priest.signTypedData(dtyped0.domain, dtyped0.types, dtyped0.message);
  await request(app)
    .delete('/delegateMute')
    .send({
      contractAddress: addresses.contract,
      priestAddress: addresses.priest,
      delegateAddress: addresses.delegate,
      signature: delSig,
      chainId: 1337,
      nonce: dtyped0.message.nonce,
      issuedAt: dtyped0.message.issuedAt,
      expiry: dtyped0.message.expiry
    })
    .expect(200, { delegated: false });

  const mtyped6 = buildMuteTypedData({ chainId: 1337, contractAddress: addresses.contract, targetAddress: addresses.member });
  const badSig = await wallets.delegate.signTypedData(mtyped6.domain, mtyped6.types, mtyped6.message);
  await request(app)
    .post('/mute')
    .send({
      contractAddress: addresses.contract,
      moderatorAddress: addresses.delegate,
      targetAddress: addresses.member,
      signature: badSig
    })
    .expect(403);

  await app.close();
});

test('rejects delegate addition with non-priest signature', async () => {
  const fakeGroup = { id: 'group-deleg-bad', addMembers: async () => {}, removeMembers: async () => {} };
  const fakeXmtp = {
    inboxId: 'test-inbox-id',
    conversations: { newGroup: async () => fakeGroup }
  };
  const hasPurchased = async () => true;

  const app = makeApp({ xmtp: fakeXmtp, hasPurchased });

  const ctyped9 = buildCreateTypedData({ chainId: 1337, contractAddress: addresses.contract });
  const templSig = await wallets.priest.signTypedData(ctyped9.domain, ctyped9.types, ctyped9.message);
  await request(app)
    .post('/templs')
    .send({
      contractAddress: addresses.contract,
      priestAddress: addresses.priest,
      signature: templSig,
      chainId: 1337,
      nonce: ctyped9.message.nonce,
      issuedAt: ctyped9.message.issuedAt,
      expiry: ctyped9.message.expiry
    })
    .expect(200);

  const dtypedBad = buildDelegateTypedData({ chainId: 1337, contractAddress: addresses.contract, delegateAddress: addresses.delegate });
  const badSig = await wallets.stranger.signTypedData(dtypedBad.domain, dtypedBad.types, dtypedBad.message);
  await request(app)
    .post('/delegateMute')
    .send({
      contractAddress: addresses.contract,
      priestAddress: addresses.priest,
      delegateAddress: addresses.delegate,
      signature: badSig,
      chainId: 1337,
      nonce: dtypedBad.message.nonce,
      issuedAt: dtypedBad.message.issuedAt,
      expiry: dtypedBad.message.expiry
    })
    .expect(403, { error: 'Only priest can delegate' });

  await app.close();
});

test('rejects delegate removal with malformed signature', async () => {
  const fakeGroup = { id: 'group-deleg-missing', addMembers: async () => {}, removeMembers: async () => {} };
  const fakeXmtp = {
    inboxId: 'test-inbox-id',
    conversations: { newGroup: async () => fakeGroup }
  };
  const hasPurchased = async () => true;

  const app = makeApp({ xmtp: fakeXmtp, hasPurchased });

  const ctyped10 = buildCreateTypedData({ chainId: 1337, contractAddress: addresses.contract });
  const templSig = await wallets.priest.signTypedData(ctyped10.domain, ctyped10.types, ctyped10.message);
  await request(app)
    .post('/templs')
    .send({
      contractAddress: addresses.contract,
      priestAddress: addresses.priest,
      signature: templSig,
      chainId: 1337,
      nonce: ctyped10.message.nonce,
      issuedAt: ctyped10.message.issuedAt,
      expiry: ctyped10.message.expiry
    })
    .expect(200);

  const dtyped1 = buildDelegateTypedData({ chainId: 1337, contractAddress: addresses.contract, delegateAddress: addresses.delegate });
  const delSig = await wallets.priest.signTypedData(dtyped1.domain, dtyped1.types, dtyped1.message);
  await request(app)
    .post('/delegateMute')
    .send({
      contractAddress: addresses.contract,
      priestAddress: addresses.priest,
      delegateAddress: addresses.delegate,
      signature: delSig,
      chainId: 1337,
      nonce: dtyped1.message.nonce,
      issuedAt: dtyped1.message.issuedAt,
      expiry: dtyped1.message.expiry
    })
    .expect(200);

  // Use a typed signature from a non-priest to assert rejection
  const dtypedBad2 = buildDelegateTypedData({ chainId: 1337, contractAddress: addresses.contract, delegateAddress: addresses.delegate });
  const badSig2 = await wallets.stranger.signTypedData(dtypedBad2.domain, dtypedBad2.types, dtypedBad2.message);
  await request(app)
    .delete('/delegateMute')
    .send({
      contractAddress: addresses.contract,
      priestAddress: addresses.priest,
      delegateAddress: addresses.delegate,
      signature: badSig2,
      chainId: 1337,
      nonce: dtypedBad2.message.nonce,
      issuedAt: dtypedBad2.message.issuedAt,
      expiry: dtypedBad2.message.expiry
    })
    .expect(403, { error: 'Only priest can delegate' });

  await app.close();
});

test('mute durations escalate', async () => {
  const fakeGroup = { id: 'group-2b', addMembers: async () => {}, removeMembers: async () => {} };
  const fakeXmtp = { 
    inboxId: 'test-inbox-id',
    conversations: { newGroup: async () => fakeGroup } 
  };
  const hasPurchased = async () => true;
  const app = makeApp({ xmtp: fakeXmtp, hasPurchased });

  const ctyped11 = buildCreateTypedData({ chainId: 1337, contractAddress: addresses.contract });
  const templSig = await wallets.priest.signTypedData(ctyped11.domain, ctyped11.types, ctyped11.message);
  await request(app)
    .post('/templs')
    .send({
      contractAddress: addresses.contract,
      priestAddress: addresses.priest,
      signature: templSig,
      chainId: 1337,
      nonce: ctyped11.message.nonce,
      issuedAt: ctyped11.message.issuedAt,
      expiry: ctyped11.message.expiry
    })
    .expect(200);

  let mtyped4 = buildMuteTypedData({ chainId: 1337, contractAddress: addresses.contract, targetAddress: addresses.member });
  let muteSig = await wallets.priest.signTypedData(mtyped4.domain, mtyped4.types, mtyped4.message);
  const first = await request(app)
    .post('/mute')
    .send({
      contractAddress: addresses.contract,
      moderatorAddress: addresses.priest,
      targetAddress: addresses.member,
      signature: muteSig,
      chainId: 1337,
      nonce: mtyped4.message.nonce,
      issuedAt: mtyped4.message.issuedAt,
      expiry: mtyped4.message.expiry
    })
    .expect(200);

  mtyped4 = buildMuteTypedData({ chainId: 1337, contractAddress: addresses.contract, targetAddress: addresses.member });
  muteSig = await wallets.priest.signTypedData(mtyped4.domain, mtyped4.types, mtyped4.message);
  const second = await request(app)
    .post('/mute')
    .send({
      contractAddress: addresses.contract,
      moderatorAddress: addresses.priest,
      targetAddress: addresses.member,
      signature: muteSig,
      chainId: 1337,
      nonce: mtyped4.message.nonce,
      issuedAt: mtyped4.message.issuedAt,
      expiry: mtyped4.message.expiry
    })
    .expect(200);

  const diff = second.body.mutedUntil - first.body.mutedUntil;
  assert.ok(diff > 23 * 3600 * 1000 && diff < 25 * 3600 * 1000);
  await app.close();
});

test('permanently mutes after repeated escalations', async () => {
  const fakeGroup = { id: 'group-2c', addMembers: async () => {}, removeMembers: async () => {} };
  const fakeXmtp = {
    inboxId: 'test-inbox-id',
    conversations: { newGroup: async () => fakeGroup }
  };
  const hasPurchased = async () => true;
  const app = makeApp({ xmtp: fakeXmtp, hasPurchased });

  const ctyped12 = buildCreateTypedData({ chainId: 1337, contractAddress: addresses.contract });
  const templSig = await wallets.priest.signTypedData(ctyped12.domain, ctyped12.types, ctyped12.message);
  await request(app)
    .post('/templs')
    .send({
      contractAddress: addresses.contract,
      priestAddress: addresses.priest,
      signature: templSig,
      chainId: 1337,
      nonce: ctyped12.message.nonce,
      issuedAt: ctyped12.message.issuedAt,
      expiry: ctyped12.message.expiry
    })
    .expect(200);

  let resp;
  for (let i = 0; i < 5; i++) {
    const mtyped5 = buildMuteTypedData({ chainId: 1337, contractAddress: addresses.contract, targetAddress: addresses.member });
    const muteSig = await wallets.priest.signTypedData(mtyped5.domain, mtyped5.types, mtyped5.message);
    resp = await request(app)
      .post('/mute')
      .send({
        contractAddress: addresses.contract,
        moderatorAddress: addresses.priest,
        targetAddress: addresses.member,
        signature: muteSig,
        chainId: 1337,
        nonce: mtyped5.message.nonce,
        issuedAt: mtyped5.message.issuedAt,
        expiry: mtyped5.message.expiry
      })
      .expect(200);
  }

  assert.deepEqual(resp.body, { mutedUntil: 0 });
  await app.close();
});

test('rejects mute with bad signature', async () => {
  const fakeGroup = { id: 'group-3a', addMembers: async () => {}, removeMembers: async () => {} };
  const fakeXmtp = { 
    inboxId: 'test-inbox-id',
    conversations: { newGroup: async () => fakeGroup } 
  };
  const hasPurchased = async () => true;

  const app = makeApp({ xmtp: fakeXmtp, hasPurchased });

  const ctyped13 = buildCreateTypedData({ chainId: 1337, contractAddress: addresses.contract });
  const templSig = await wallets.priest.signTypedData(ctyped13.domain, ctyped13.types, ctyped13.message);
  await request(app)
    .post('/templs')
    .send({
      contractAddress: addresses.contract,
      priestAddress: addresses.priest,
      signature: templSig,
      chainId: 1337,
      nonce: ctyped13.message.nonce,
      issuedAt: ctyped13.message.issuedAt,
      expiry: ctyped13.message.expiry
    })
    .expect(200);

  const mtyped1 = buildMuteTypedData({ chainId: 1337, contractAddress: addresses.contract, targetAddress: addresses.member });
  const badSig = await wallets.member.signTypedData(mtyped1.domain, mtyped1.types, mtyped1.message);
  await request(app)
    .post('/mute')
    .send({
      contractAddress: addresses.contract,
      moderatorAddress: addresses.priest,
      targetAddress: addresses.member,
      signature: badSig,
      chainId: 1337,
      nonce: mtyped1.message.nonce,
      issuedAt: mtyped1.message.issuedAt,
      expiry: mtyped1.message.expiry
    })
    .expect(403);
  await app.close();
});

test('rejects mute with malformed addresses', async () => {
  const hasPurchased = async () => true;
  const fakeGroup = { id: 'group-3b', addMembers: async () => {}, removeMembers: async () => {} };
  const fakeXmtp = { 
    inboxId: 'test-inbox-id',
    conversations: { newGroup: async () => fakeGroup } 
  };

  const app = makeApp({ xmtp: fakeXmtp, hasPurchased });

  await request(app)
    .post('/mute')
    .send({
      contractAddress: 'not-an-address',
      moderatorAddress: 'also-bad',
      targetAddress: 'nope',
      signature: '0x',
      chainId: 1337
    })
    .expect(400);
  await app.close();
});

test('rejects mute for unknown templ', async () => {
  const hasPurchased = async () => true;
  const fakeGroup = { id: 'group-3c', addMembers: async () => {}, removeMembers: async () => {} };
  const fakeXmtp = { 
    inboxId: 'test-inbox-id',
    conversations: { newGroup: async () => fakeGroup } 
  };

  const app = makeApp({ xmtp: fakeXmtp, hasPurchased });

  await request(app)
    .post('/mute')
    .send({
      contractAddress: addresses.contract,
      moderatorAddress: addresses.priest,
      targetAddress: addresses.member,
      signature: '0x',
      chainId: 1337
    })
    .expect(404);
  await app.close();
});

test('broadcasts proposal and vote events to group', async () => {
  const messages = [];
  const fakeGroup = {
    id: 'group-3',
    addMembers: async () => {},
    removeMembers: async () => {},
    send: async (msg) => {
      messages.push(JSON.parse(msg));
    }
  };
  const fakeXmtp = {
    inboxId: 'test-inbox-id',
    conversations: {
      newGroup: async () => fakeGroup
    }
  };
  const emitter = new EventEmitter();
  const connectContract = () => emitter;
  const hasPurchased = async () => false;

  const app = makeApp({ xmtp: fakeXmtp, hasPurchased, connectContract });

  const ctypedLast = buildCreateTypedData({ chainId: 1337, contractAddress: addresses.contract });
  const signature = await wallets.priest.signTypedData(ctypedLast.domain, ctypedLast.types, ctypedLast.message);
  await request(app)
    .post('/templs')
    .send({
      contractAddress: addresses.contract,
      priestAddress: addresses.priest,
      signature,
      chainId: 1337,
      nonce: ctypedLast.message.nonce,
      issuedAt: ctypedLast.message.issuedAt,
      expiry: ctypedLast.message.expiry
    })
    .expect(200);

  emitter.emit('ProposalCreated', 1, addresses.member, 123);
  emitter.emit('VoteCast', 1, addresses.member, true, 456);

  // Ignore warm-up messages the backend may send on group creation or join
  const filtered = messages.filter(m => m.type !== 'templ-created' && m.type !== 'member-joined');
  assert.deepEqual(filtered, [
    {
      type: 'proposal',
      id: 1,
      proposer: addresses.member,
      endTime: 123
    },
    {
      type: 'vote',
      id: 1,
      voter: addresses.member,
      support: true,
      timestamp: 456
    }
  ]);
  await app.close();
});

test('updates priest when PriestChanged fires and persists to disk', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'templ-priest-'));
  const dbPath = path.join(dir, 'groups.db');

  const fakeGroup = {
    id: 'group-priest-change',
    addMembers: async () => {},
    removeMembers: async () => {},
    send: async () => {}
  };

  const xmtp1 = {
    inboxId: 'test-inbox-id',
    conversations: { newGroup: async () => fakeGroup }
  };
  const emitter = new EventEmitter();
  const connectContract = () => emitter;
  const hasPurchased = async () => true;

  const app1 = makeApp({ xmtp: xmtp1, hasPurchased, connectContract, dbPath });
  try {
    const createTyped = buildCreateTypedData({ chainId: 31337, contractAddress: addresses.contract });
    const createSig = await wallets.priest.signTypedData(createTyped.domain, createTyped.types, createTyped.message);
    await request(app1)
      .post('/templs')
      .send({
        contractAddress: addresses.contract,
        priestAddress: addresses.priest,
        signature: createSig,
        chainId: 31337,
        nonce: createTyped.message.nonce,
        issuedAt: createTyped.message.issuedAt,
        expiry: createTyped.message.expiry
      })
      .expect(200);

    emitter.emit('PriestChanged', addresses.priest, addresses.delegate);
    await new Promise((resolve) => setImmediate(resolve));

    const delegateTyped = buildDelegateTypedData({
      chainId: 31337,
      contractAddress: addresses.contract,
      delegateAddress: addresses.member
    });
    const delegateSig = await wallets.delegate.signTypedData(
      delegateTyped.domain,
      delegateTyped.types,
      delegateTyped.message
    );
    await request(app1)
      .post('/delegateMute')
      .send({
        contractAddress: addresses.contract,
        priestAddress: addresses.delegate,
        delegateAddress: addresses.member,
        signature: delegateSig,
        chainId: 31337,
        nonce: delegateTyped.message.nonce,
        issuedAt: delegateTyped.message.issuedAt,
        expiry: delegateTyped.message.expiry
      })
      .expect(200, { delegated: true });
  } finally {
    await app1.close();
  }

  const xmtp2 = {
    inboxId: 'test-inbox-id',
    conversations: {
      getConversationById: async () => fakeGroup
    }
  };

  const app2 = makeApp({ xmtp: xmtp2, hasPurchased, dbPath });
  try {
    await new Promise((resolve) => setTimeout(resolve, 10));

    const muteTyped = buildMuteTypedData({
      chainId: 31337,
      contractAddress: addresses.contract,
      targetAddress: addresses.stranger
    });
    const muteSig = await wallets.delegate.signTypedData(muteTyped.domain, muteTyped.types, muteTyped.message);
    const resp = await request(app2)
      .post('/mute')
      .send({
        contractAddress: addresses.contract,
        moderatorAddress: addresses.delegate,
        targetAddress: addresses.stranger,
        signature: muteSig,
        chainId: 31337,
        nonce: muteTyped.message.nonce,
        issuedAt: muteTyped.message.issuedAt,
        expiry: muteTyped.message.expiry
      })
      .expect(200);
    assert.ok(resp.body.mutedUntil === 0 || resp.body.mutedUntil > Date.now());
  } finally {
    await app2.close();
  }
});
