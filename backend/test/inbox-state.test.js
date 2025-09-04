import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { Client } from '@xmtp/node-sdk';
import { makeApp } from './helpers.js';

// Enable debug endpoints so /debug/inbox-state is available during tests
process.env.ENABLE_DEBUG_ENDPOINTS = '1';

const basePath = '/debug/inbox-state';

test('GET /inbox-state without inboxId returns 400', async () => {
  const app = makeApp({ xmtp: {}, hasPurchased: async () => false });
  await request(app).get(basePath).expect(400);
  await app.close();
});

test('GET /inbox-state handles Client.inboxStateFromInboxIds errors', async () => {
  const original = Client.inboxStateFromInboxIds;
  Client.inboxStateFromInboxIds = async () => {
    throw new Error('boom');
  };
  const app = makeApp({ xmtp: {}, hasPurchased: async () => false });
  await request(app).get(`${basePath}?inboxId=abc`).expect(500);
  await app.close();
  Client.inboxStateFromInboxIds = original;
});

test('GET /inbox-state returns inbox state', async () => {
  const original = Client.inboxStateFromInboxIds;
  const fakeStates = [{ inboxId: 'abc', registered: true }];
  Client.inboxStateFromInboxIds = async (ids) => {
    assert.deepEqual(ids, ['abc']);
    return fakeStates;
  };
  const app = makeApp({ xmtp: {}, hasPurchased: async () => false });
  const res = await request(app)
    .get(`${basePath}?inboxId=abc`)
    .expect(200);
  assert.equal(res.body.inboxId, 'abc');
  assert.deepEqual(res.body.states, fakeStates);
  await app.close();
  Client.inboxStateFromInboxIds = original;
});
