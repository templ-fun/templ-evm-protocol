import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { EventEmitter } from 'node:events';
import { makeApp, wallets } from './helpers.js';
import { buildDelegateMessage, buildMuteMessage } from '../../shared/signing.js';

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
  const signature = await wallets.priest.signMessage(
    `create:${addresses.contract}`
  );
  await request(app)
    .post('/templs')
    .send({
      contractAddress: addresses.contract,
      priestAddress: addresses.priest,
      signature
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
  const signature = await wallets.priest.signMessage(`create:${addresses.contract}`);
  await request(app)
    .post('/templs')
    .send({
      contractAddress: 'not-an-address',
      priestAddress: 'also-bad',
      signature
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
  const signature = await wallets.member.signMessage(`create:${addresses.contract}`);
  await request(app)
    .post('/templs')
    .send({
      contractAddress: addresses.contract,
      priestAddress: addresses.priest,
      signature
    })
    .expect(403);
  await app.close();
});

test('rejects join with malformed addresses', async () => {
  const app = makeApp({
    xmtp: { conversations: {} },
    hasPurchased: async () => true
  });
  const signature = await wallets.member.signMessage(`join:${addresses.contract}`);
  await request(app)
    .post('/join')
    .send({
      contractAddress: 'not-an-address',
      memberAddress: 'also-bad',
      signature
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

  const templSig = await wallets.priest.signMessage(`create:${addresses.contract}`);
  await request(app)
    .post('/templs')
    .send({
      contractAddress: addresses.contract,
      priestAddress: addresses.priest,
      signature: templSig
    })
    .expect(200);

  const badSig = await wallets.stranger.signMessage(`join:${addresses.contract}`);
  await request(app)
    .post('/join')
    .send({
      contractAddress: addresses.contract,
      memberAddress: addresses.member,
      signature: badSig
    })
    .expect(403);
  await app.close();
});

test('rejects join for unknown templ', async () => {
  const app = makeApp({
    xmtp: { conversations: {} },
    hasPurchased: async () => true
  });

  const signature = await wallets.member.signMessage(`join:${addresses.contract}`);
  await request(app)
    .post('/join')
    .send({
      contractAddress: addresses.contract,
      memberAddress: addresses.member,
      signature
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

  const templSig = await wallets.priest.signMessage(
    `create:${addresses.contract}`
  );
  await request(app)
    .post('/templs')
    .send({
      contractAddress: addresses.contract,
      priestAddress: addresses.priest,
      signature: templSig
    })
    .expect(200);

  const joinSig = await wallets.member.signMessage(
    `join:${addresses.contract}`
  );
  await request(app)
    .post('/join')
    .send({
      contractAddress: addresses.contract,
      memberAddress: addresses.member,
      signature: joinSig
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
  const fakeXmtp = {
    inboxId: 'test-inbox-id',
    conversations: {
      newGroup: async () => fakeGroup
    }
  };
  const purchased = new Set();
  const hasPurchased = async (_contract, member) =>
    purchased.has(member.toLowerCase());

  const app = makeApp({ xmtp: fakeXmtp, hasPurchased });

  let sig = await wallets.priest.signMessage(`create:${addresses.contract}`);
  await request(app)
    .post('/templs')
    .send({
      contractAddress: addresses.contract,
      priestAddress: addresses.priest,
      signature: sig
    })
    .expect(200);

  sig = await wallets.member.signMessage(`join:${addresses.contract}`);
  await request(app)
    .post('/join')
    .send({
      contractAddress: addresses.contract,
      memberAddress: addresses.member,
      signature: sig
    })
    .expect(403);

  purchased.add(addresses.member.toLowerCase());
  sig = await wallets.member.signMessage(`join:${addresses.contract}`);
  // Compute expected inboxId and pass through to backend to avoid relying on on-chain lookup
  const { generateInboxId } = await import('@xmtp/node-sdk');
  const memberIdentifier = {
    identifier: addresses.member.toLowerCase(),
    identifierKind: 0
  };
  const expectedInboxId = generateInboxId(memberIdentifier);
  await request(app)
    .post('/join')
    .send({
      contractAddress: addresses.contract,
      memberAddress: addresses.member,
      signature: sig,
      memberInboxId: expectedInboxId
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

  const templSig = await wallets.priest.signMessage(
    `create:${addresses.contract}`
  );
  await request(app)
    .post('/templs')
    .send({
      contractAddress: addresses.contract,
      priestAddress: addresses.priest,
      signature: templSig
    })
    .expect(200);

  const joinSig = await wallets.member.signMessage(
    `join:${addresses.contract}`
  );
  await request(app)
    .post('/join')
    .send({
      contractAddress: addresses.contract,
      memberAddress: addresses.member,
      signature: joinSig
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

  const templSig = await wallets.priest.signMessage(`create:${addresses.contract}`);
  await request(app)
    .post('/templs')
    .send({
      contractAddress: addresses.contract,
      priestAddress: addresses.priest,
      signature: templSig
    })
    .expect(200);

  const joinSig = await wallets.member.signMessage(`join:${addresses.contract}`);
  const originalSetTimeout = setTimeout;
  try {
    // Collapse retries to avoid long waits
    global.setTimeout = (fn, ms, ...args) => originalSetTimeout(fn, 0, ...args);
    await request(app)
      .post('/join')
      .send({
        contractAddress: addresses.contract,
        memberAddress: addresses.member,
        signature: joinSig
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
        signature: '0x'
      })
      .expect(400);
  }
  await request(app)
    .post('/join')
    .send({
      contractAddress: 'not-an-address',
      memberAddress: 'also-bad',
      signature: '0x'
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

  let templSig = await wallets.priest.signMessage(`create:${addresses.contract}`);
  await request(app)
    .post('/templs')
    .send({
      contractAddress: addresses.contract,
      priestAddress: addresses.priest,
      signature: templSig
    })
    .expect(200);

  let muteSig = await wallets.stranger.signMessage(
    buildMuteMessage(addresses.contract, addresses.member)
  );
  await request(app)
    .post('/mute')
    .send({
      contractAddress: addresses.contract,
      moderatorAddress: addresses.stranger,
      targetAddress: addresses.member,
      signature: muteSig
    })
    .expect(403);

  muteSig = await wallets.priest.signMessage(
    buildMuteMessage(addresses.contract, addresses.member)
  );
  const resp = await request(app)
    .post('/mute')
    .send({
      contractAddress: addresses.contract,
      moderatorAddress: addresses.priest,
      targetAddress: addresses.member,
      signature: muteSig
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

  const templSig = await wallets.priest.signMessage(`create:${addresses.contract}`);
  await request(app)
    .post('/templs')
    .send({
      contractAddress: addresses.contract,
      priestAddress: addresses.priest,
      signature: templSig
    })
    .expect(200);

  let delSig = await wallets.priest.signMessage(
    buildDelegateMessage(addresses.contract, addresses.delegate)
  );
  await request(app)
    .post('/delegateMute')
    .send({
      contractAddress: addresses.contract,
      priestAddress: addresses.priest,
      delegateAddress: addresses.delegate,
      signature: delSig
    })
    .expect(200, { delegated: true });

  const muteSig = await wallets.delegate.signMessage(
    buildMuteMessage(addresses.contract, addresses.member)
  );
  await request(app)
    .post('/mute')
    .send({
      contractAddress: addresses.contract,
      moderatorAddress: addresses.delegate,
      targetAddress: addresses.member,
      signature: muteSig
    })
    .expect(200);

  delSig = await wallets.priest.signMessage(
    buildDelegateMessage(addresses.contract, addresses.delegate)
  );
  await request(app)
    .delete('/delegateMute')
    .send({
      contractAddress: addresses.contract,
      priestAddress: addresses.priest,
      delegateAddress: addresses.delegate,
      signature: delSig
    })
    .expect(200, { delegated: false });

  const badSig = await wallets.delegate.signMessage(
    buildMuteMessage(addresses.contract, addresses.member)
  );
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

  const templSig = await wallets.priest.signMessage(`create:${addresses.contract}`);
  await request(app)
    .post('/templs')
    .send({
      contractAddress: addresses.contract,
      priestAddress: addresses.priest,
      signature: templSig
    })
    .expect(200);

  const badSig = await wallets.stranger.signMessage(
    buildDelegateMessage(addresses.contract, addresses.delegate)
  );
  await request(app)
    .post('/delegateMute')
    .send({
      contractAddress: addresses.contract,
      priestAddress: addresses.priest,
      delegateAddress: addresses.delegate,
      signature: badSig
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

  const templSig = await wallets.priest.signMessage(`create:${addresses.contract}`);
  await request(app)
    .post('/templs')
    .send({
      contractAddress: addresses.contract,
      priestAddress: addresses.priest,
      signature: templSig
    })
    .expect(200);

  const delSig = await wallets.priest.signMessage(
    buildDelegateMessage(addresses.contract, addresses.delegate)
  );
  await request(app)
    .post('/delegateMute')
    .send({
      contractAddress: addresses.contract,
      priestAddress: addresses.priest,
      delegateAddress: addresses.delegate,
      signature: delSig
    })
    .expect(200);

  await request(app)
    .delete('/delegateMute')
    .send({
      contractAddress: addresses.contract,
      priestAddress: addresses.priest,
      delegateAddress: addresses.delegate,
      signature: '0x'
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

  const templSig = await wallets.priest.signMessage(`create:${addresses.contract}`);
  await request(app)
    .post('/templs')
    .send({
      contractAddress: addresses.contract,
      priestAddress: addresses.priest,
      signature: templSig
    })
    .expect(200);

  let muteSig = await wallets.priest.signMessage(
    buildMuteMessage(addresses.contract, addresses.member)
  );
  const first = await request(app)
    .post('/mute')
    .send({
      contractAddress: addresses.contract,
      moderatorAddress: addresses.priest,
      targetAddress: addresses.member,
      signature: muteSig
    })
    .expect(200);

  muteSig = await wallets.priest.signMessage(
    buildMuteMessage(addresses.contract, addresses.member)
  );
  const second = await request(app)
    .post('/mute')
    .send({
      contractAddress: addresses.contract,
      moderatorAddress: addresses.priest,
      targetAddress: addresses.member,
      signature: muteSig
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

  const templSig = await wallets.priest.signMessage(`create:${addresses.contract}`);
  await request(app)
    .post('/templs')
    .send({
      contractAddress: addresses.contract,
      priestAddress: addresses.priest,
      signature: templSig
    })
    .expect(200);

  let resp;
  for (let i = 0; i < 5; i++) {
    const muteSig = await wallets.priest.signMessage(
      buildMuteMessage(addresses.contract, addresses.member)
    );
    resp = await request(app)
      .post('/mute')
      .send({
        contractAddress: addresses.contract,
        moderatorAddress: addresses.priest,
        targetAddress: addresses.member,
        signature: muteSig
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

  const templSig = await wallets.priest.signMessage(`create:${addresses.contract}`);
  await request(app)
    .post('/templs')
    .send({
      contractAddress: addresses.contract,
      priestAddress: addresses.priest,
      signature: templSig
    })
    .expect(200);

  const badSig = await wallets.member.signMessage(
    buildMuteMessage(addresses.contract, addresses.member)
  );
  await request(app)
    .post('/mute')
    .send({
      contractAddress: addresses.contract,
      moderatorAddress: addresses.priest,
      targetAddress: addresses.member,
      signature: badSig
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
      signature: '0x'
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
      signature: '0x'
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

  const signature = await wallets.priest.signMessage(
    `create:${addresses.contract}`
  );
  await request(app)
    .post('/templs')
    .send({
      contractAddress: addresses.contract,
      priestAddress: addresses.priest,
      signature
    })
    .expect(200);

  emitter.emit('ProposalCreated', 1, addresses.member, 'Test', 123);
  emitter.emit('VoteCast', 1, addresses.member, true, 456);

  // Ignore warm-up messages the backend may send on group creation or join
  const filtered = messages.filter(m => m.type !== 'templ-created' && m.type !== 'member-joined');
  assert.deepEqual(filtered, [
    {
      type: 'proposal',
      id: 1,
      proposer: addresses.member,
      title: 'Test',
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
