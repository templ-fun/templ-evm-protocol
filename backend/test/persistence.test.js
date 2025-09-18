import test from 'node:test';
import request from 'supertest';
import { mkdtemp } from 'fs/promises';
import path from 'path';
import os from 'os';
import { makeApp, wallets } from './helpers.js';

// Load typed-data builders once for this module
const { buildCreateTypedData, buildJoinTypedData } = await import('../../shared/signing.js');

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

  const xmtp1 = { 
    inboxId: 'test-inbox-id',
    conversations: { newGroup: async (inboxIds) => { void inboxIds; return fakeGroup; } }
  };
  const hasPurchased = async () => true;

  let app = makeApp({ xmtp: xmtp1, hasPurchased, dbPath });
  const createTyped = buildCreateTypedData({ chainId: 1337, contractAddress: addresses.contract });
  const createSig = await wallets.priest.signTypedData(createTyped.domain, createTyped.types, createTyped.message);
  await request(app)
    .post('/templs')
    .send({
      contractAddress: addresses.contract,
      priestAddress: addresses.priest,
      signature: createSig,
      chainId: 1337,
      nonce: createTyped.message.nonce,
      issuedAt: createTyped.message.issuedAt,
      expiry: createTyped.message.expiry
    })
    .expect(200);
  await app.close();

  const xmtp2 = { 
    inboxId: 'test-inbox-id',
    conversations: { getConversationById: async () => fakeGroup },
    findInboxIdByIdentifier: async () => 'test-inbox-id'
  };
  app = makeApp({ xmtp: xmtp2, hasPurchased, dbPath });
  await new Promise((r) => setTimeout(r, 10));

  const joinTyped = buildJoinTypedData({ chainId: 1337, contractAddress: addresses.contract });
  const joinSig = await wallets.member.signTypedData(joinTyped.domain, joinTyped.types, joinTyped.message);
  await request(app)
    .post('/join')
    .send({
      contractAddress: addresses.contract,
      memberAddress: addresses.member,
      signature: joinSig,
      chainId: 1337,
      nonce: joinTyped.message.nonce,
      issuedAt: joinTyped.message.issuedAt,
      expiry: joinTyped.message.expiry
    })
    .expect(200, { groupId: fakeGroup.id });
  await app.close();
});

test('returns 500 when persistence fails', async () => {
  const fakeGroup = { id: 'group-err', addMembers: async () => {}, removeMembers: async () => {} };
  const xmtp = { 
    inboxId: 'test-inbox-id',
    conversations: { newGroup: async () => fakeGroup } 
  };
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

  const app = makeApp({ xmtp, hasPurchased, db: failingDb });

  const createTyped2 = buildCreateTypedData({ chainId: 1337, contractAddress: addresses.contract });
  const sig = await wallets.priest.signTypedData(createTyped2.domain, createTyped2.types, createTyped2.message);
  await request(app)
    .post('/templs')
    .send({
      contractAddress: addresses.contract,
      priestAddress: addresses.priest,
      signature: sig,
      chainId: 1337,
      nonce: createTyped2.message.nonce,
      issuedAt: createTyped2.message.issuedAt,
      expiry: createTyped2.message.expiry
    })
    .expect(500);
  await app.close();
});
