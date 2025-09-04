import test from 'node:test';
import request from 'supertest';
import { createApp } from '../src/server.js';

const makeApp = (opts) => createApp({ dbPath: ':memory:', ...opts });

test('trims ALLOWED_ORIGINS entries', async () => {
  const prev = process.env.ALLOWED_ORIGINS;
  process.env.ALLOWED_ORIGINS = 'http://foo.com, http://bar.com ';
  const app = makeApp({ xmtp: { conversations: {} }, hasPurchased: async () => true });
  await request(app)
    .options('/templs')
    .set('Origin', 'http://bar.com')
    .expect('Access-Control-Allow-Origin', 'http://bar.com')
    .expect(204);
  await app.close();
  if (prev === undefined) delete process.env.ALLOWED_ORIGINS;
  else process.env.ALLOWED_ORIGINS = prev;
});
