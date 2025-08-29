import test from 'node:test';
import request from 'supertest';
import { Wallet } from 'ethers';
import { mkdtemp } from 'fs/promises';
import path from 'path';
import os from 'os';
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
  const dir = await mkdtemp(path.join(os.tmpdir(), 'templ-'));
  const dbPath = path.join(dir, 'groups.db');

  const fakeGroup = {
    id: 'group-persist',
    addMembers: async () => {},
    removeMembers: async () => {}
  };

  const xmtp1 = { conversations: { newGroup: async () => fakeGroup } };
  const hasPurchased = async () => true;

  let app = createApp({ xmtp: xmtp1, hasPurchased, dbPath });
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
  await app.close();

  const xmtp2 = { conversations: { getGroup: async () => fakeGroup } };
  app = createApp({ xmtp: xmtp2, hasPurchased, dbPath });
  await new Promise((r) => setTimeout(r, 10));

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
  await app.close();
});

test('returns 500 when persistence fails', async () => {
  const fakeGroup = { id: 'group-err', addMembers: async () => {}, removeMembers: async () => {} };
  const xmtp = { conversations: { newGroup: async () => fakeGroup } };
  const hasPurchased = async () => false;
  const failingDb = {
    exec() {},
    prepare(sql) {
      return {
        run() {
          if (sql.startsWith('INSERT')) throw new Error('disk full');
        },
        all() {
          return [];
        }
      };
    },
    close() {}
  };

  const app = createApp({ xmtp, hasPurchased, db: failingDb });

  const sig = await wallets.priest.signMessage(`create:${addresses.contract}`);
  await request(app)
    .post('/templs')
    .send({
      contractAddress: addresses.contract,
      priestAddress: addresses.priest,
      signature: sig
    })
    .expect(500);
  await app.close();
});
