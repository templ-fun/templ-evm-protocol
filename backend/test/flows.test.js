import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { EventEmitter } from 'node:events';
import { createApp } from '../src/server.js';

const addresses = {
  contract: '0x0000000000000000000000000000000000000001',
  priest: '0x0000000000000000000000000000000000000002',
  member: '0x0000000000000000000000000000000000000003',
  stranger: '0x0000000000000000000000000000000000000004'
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

  await request(app)
    .post('/templs')
    .send({ contractAddress: addresses.contract, priestAddress: addresses.priest })
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

  await request(app)
    .post('/templs')
    .send({ contractAddress: addresses.contract, priestAddress: addresses.priest })
    .expect(200);

  await request(app)
    .post('/join')
    .send({ contractAddress: addresses.contract, memberAddress: addresses.member })
    .expect(403);

  purchased.add(addresses.member.toLowerCase());

  await request(app)
    .post('/join')
    .send({ contractAddress: addresses.contract, memberAddress: addresses.member })
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

  await request(app)
    .post('/templs')
    .send({ contractAddress: addresses.contract, priestAddress: addresses.priest })
    .expect(200);

  await request(app)
    .post('/mute')
    .send({
      contractAddress: addresses.contract,
      priestAddress: addresses.stranger,
      targetAddress: addresses.member
    })
    .expect(403);

  await request(app)
    .post('/mute')
    .send({
      contractAddress: addresses.contract,
      priestAddress: addresses.priest,
      targetAddress: addresses.member
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

  await request(app)
    .post('/templs')
    .send({ contractAddress: addresses.contract, priestAddress: addresses.priest })
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

