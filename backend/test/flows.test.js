import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { EventEmitter } from 'node:events';
import { Wallet } from 'ethers';
import { createApp } from '../src/server.js';

const wallets = {
  priest: new Wallet('0x' + '2'.repeat(64)),
  member: new Wallet('0x' + '3'.repeat(64)),
  stranger: new Wallet('0x' + '4'.repeat(64))
};

const addresses = {
  contract: '0x0000000000000000000000000000000000000001',
  priest: wallets.priest.address,
  member: wallets.member.address,
  stranger: wallets.stranger.address
};

test('creates templ and returns group id', async () => {
  const fakeGroup = {
    id: 'group-0',
    addMembers: async () => {},
    removeMembers: async () => {}
  };
  const fakeXmtp = {
    conversations: {
      newGroup: async () => fakeGroup
    }
  };
  const hasPurchased = async () => false;

  const app = createApp({ xmtp: fakeXmtp, hasPurchased });
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
    conversations: {
      newGroup: async () => fakeGroup
    }
  };
  const purchased = new Set();
  const hasPurchased = async (_contract, member) =>
    purchased.has(member.toLowerCase());

  const app = createApp({ xmtp: fakeXmtp, hasPurchased });

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
  await request(app)
    .post('/join')
    .send({
      contractAddress: addresses.contract,
      memberAddress: addresses.member,
      signature: sig
    })
    .expect(200, { groupId: fakeGroup.id });

  assert.deepEqual(added, [addresses.member]);
});

test('only priest can mute members', async () => {
  const removed = [];
  const fakeGroup = {
    id: 'group-2',
    addMembers: async () => {},
    removeMembers: async (members) => {
      removed.push(...members);
    }
  };
  const fakeXmtp = {
    conversations: {
      newGroup: async () => fakeGroup
    }
  };
  const hasPurchased = async () => true;

  const app = createApp({ xmtp: fakeXmtp, hasPurchased });

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
    `mute:${addresses.contract}:${addresses.member.toLowerCase()}`
  );
  await request(app)
    .post('/mute')
    .send({
      contractAddress: addresses.contract,
      priestAddress: addresses.stranger,
      targetAddress: addresses.member,
      signature: muteSig
    })
    .expect(403);

  muteSig = await wallets.priest.signMessage(
    `mute:${addresses.contract}:${addresses.member.toLowerCase()}`
  );
  await request(app)
    .post('/mute')
    .send({
      contractAddress: addresses.contract,
      priestAddress: addresses.priest,
      targetAddress: addresses.member,
      signature: muteSig
    })
    .expect(200, { ok: true });

  assert.deepEqual(removed, [addresses.member]);
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
    conversations: {
      newGroup: async () => fakeGroup
    }
  };
  const emitter = new EventEmitter();
  const connectContract = () => emitter;
  const hasPurchased = async () => false;

  const app = createApp({ xmtp: fakeXmtp, hasPurchased, connectContract });

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
  emitter.emit('VoteCast', 1, addresses.member, true);

  assert.deepEqual(messages, [
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
      support: true
    }
  ]);
});

