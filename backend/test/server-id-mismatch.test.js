import test from 'node:test';
import request from 'supertest';
import { makeApp, wallets } from './helpers.js';
import { buildCreateTypedData } from '../../shared/signing.js';

test('rejects /templs when BACKEND_SERVER_ID mismatches signed server id', async () => {
  const prev = process.env.BACKEND_SERVER_ID;
  // Sign with server id = srv-one
  process.env.BACKEND_SERVER_ID = 'srv-one';
  const createTyped = buildCreateTypedData({ chainId: 31337, contractAddress: '0x0000000000000000000000000000000000000001' });
  const signature = await wallets.priest.signTypedData(createTyped.domain, createTyped.types, createTyped.message);

  // App can be created now; change expected server id before request so verification mismatches
  const app = makeApp({ xmtp: { conversations: {} }, hasPurchased: async () => false });
  process.env.BACKEND_SERVER_ID = 'srv-two';

  await request(app)
    .post('/templs')
    .send({
      contractAddress: '0x0000000000000000000000000000000000000001',
      priestAddress: wallets.priest.address,
      signature,
      chainId: 31337,
      nonce: createTyped.message.nonce,
      issuedAt: createTyped.message.issuedAt,
      expiry: createTyped.message.expiry
    })
    .expect(403);

  await app.close();
  if (prev === undefined) delete process.env.BACKEND_SERVER_ID;
  else process.env.BACKEND_SERVER_ID = prev;
});

