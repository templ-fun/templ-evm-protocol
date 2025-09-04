import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from 'express-rate-limit';
import { createApp } from '../src/server.js';

class CustomStore extends MemoryStore {
  constructor() {
    super();
    this.closed = false;
  }
  shutdown() {
    this.closed = true;
    super.shutdown();
  }
}

test('allows injecting a rate limit store', async () => {
  const store = new CustomStore();
  const app = createApp({
    xmtp: { conversations: {} },
    hasPurchased: async () => true,
    rateLimitStore: store,
    dbPath: ':memory:'
  });
  await app.close();
  assert.equal(store.closed, true);
});
