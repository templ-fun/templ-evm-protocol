import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from 'express-rate-limit';
import { makeApp } from './helpers.js';

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
  const app = makeApp({
    xmtp: { conversations: {} },
    hasPurchased: async () => true,
    rateLimitStore: store
  });
  await app.close();
  assert.equal(store.closed, true);
});
