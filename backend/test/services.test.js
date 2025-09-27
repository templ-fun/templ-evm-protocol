import test from 'node:test';
import assert from 'node:assert/strict';

import { registerTempl } from '../src/services/registerTempl.js';
import { joinTempl } from '../src/services/joinTempl.js';
import { requestTemplRebind } from '../src/services/requestTemplRebind.js';

const noopContext = {
  templs: new Map(),
  persist: () => {},
  logger: { info: () => {}, warn: () => {}, error: () => {} }
};

function expectStatus(err, code) {
  assert.equal(err?.statusCode, code);
  return true;
}

test('registerTempl rejects malformed addresses', async () => {
  await assert.rejects(
    () => registerTempl({ contractAddress: '0x123', priestAddress: '0x123' }, noopContext),
    (err) => expectStatus(err, 400)
  );
});

test('joinTempl rejects malformed addresses', async () => {
  await assert.rejects(
    () => joinTempl({ contractAddress: '0x123', memberAddress: '0x123' }, { ...noopContext, hasPurchased: async () => true }),
    (err) => expectStatus(err, 400)
  );
});

test('requestTemplRebind rejects malformed addresses', async () => {
  await assert.rejects(
    () => requestTemplRebind({ contractAddress: '0x123', priestAddress: '0x123' }, { ...noopContext, templs: new Map(), findBinding: () => null }),
    (err) => expectStatus(err, 400)
  );
});
