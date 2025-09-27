import test from 'node:test';
import assert from 'node:assert/strict';

import { registerTempl } from '../src/services/registerTempl.js';

process.env.NODE_ENV = 'test';

function createContext() {
  return {
    templs: new Map(),
    persist: () => {},
    watchContract: async () => {}
  };
}

test('registerTempl rejects malformed addresses', async () => {
  const ctx = createContext();
  const body = {
    contractAddress: '0xzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz',
    priestAddress: '0xzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz'
  };

  await assert.rejects(
    registerTempl(body, ctx),
    /Invalid contractAddress/
  );
});

test('registerTempl accepts checksum and lowercased addresses', async () => {
  const ctx = createContext();
  const body = {
    contractAddress: '0x0000000000000000000000000000000000000001',
    priestAddress: '0x0000000000000000000000000000000000000002'
  };

  const result = await registerTempl(body, ctx);
  assert.equal(result.templ.contract, body.contractAddress);
  assert.equal(result.templ.priest, body.priestAddress);
});
