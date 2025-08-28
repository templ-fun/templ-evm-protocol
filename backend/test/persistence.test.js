import test from 'node:test';
import request from 'supertest';
import fs from 'fs/promises';
import { Wallet } from 'ethers';
import { createApp } from '../src/server.js';

const wallets = {
  priest: new Wallet('0x' + '2'.repeat(64)),
  member: new Wallet('0x' + '3'.repeat(64))
};

const addresses = {
  contract: '0x0000000000000000000000000000000000000001',
  priest: wallets.priest.address,
  member: wallets.member.address
};

test('reloads groups from disk on restart', async () => {
  const originalWrite = fs.writeFile;
  const originalRead = fs.readFile;
  let stored;
   
  fs.writeFile = async (_path, data) => {
    void _path;
    stored = data;
  };
  fs.readFile = async (_path, _encoding) => {
    void _path;
    void _encoding;
    if (stored) return stored;
    throw new Error('no file');
  };

  const fakeGroup = {
    id: 'group-persist',
    addMembers: async () => {},
    removeMembers: async () => {}
  };

  const xmtp1 = { conversations: { newGroup: async () => fakeGroup } };
  const hasPurchased = async () => true;

  let app = createApp({ xmtp: xmtp1, hasPurchased });
  const createSig = await wallets.priest.signMessage(
    `create:${addresses.contract}`
  );
  await request(app)
    .post('/templs')
    .send({
      contractAddress: addresses.contract,
      priestAddress: addresses.priest,
      signature: createSig
    })
    .expect(200);

  const xmtp2 = { conversations: { getGroup: async () => fakeGroup } };
  app = createApp({ xmtp: xmtp2, hasPurchased });
  await new Promise((r) => setImmediate(r));

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
    .expect(200, { groupId: fakeGroup.id });

  fs.writeFile = originalWrite;
  fs.readFile = originalRead;
});

test('returns 500 when persistence fails', async () => {
  const originalWrite = fs.writeFile;
  fs.writeFile = async () => {
    throw new Error('disk full');
  };

  const fakeGroup = { id: 'group-err', addMembers: async () => {}, removeMembers: async () => {} };
  const xmtp = { conversations: { newGroup: async () => fakeGroup } };
  const hasPurchased = async () => false;
  const app = createApp({ xmtp, hasPurchased });

  const sig = await wallets.priest.signMessage(`create:${addresses.contract}`);
  await request(app)
    .post('/templs')
    .send({
      contractAddress: addresses.contract,
      priestAddress: addresses.priest,
      signature: sig
    })
    .expect(500);

  fs.writeFile = originalWrite;
});
