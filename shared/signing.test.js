import assert from 'node:assert/strict';
import {
  buildCreateTypedData,
  buildJoinTypedData
} from './signing.js';

function run(describeFn, itFn) {
  describeFn('signing helpers', () => {
    itFn('buildCreateTypedData applies defaults and overrides', () => {
      const prev = globalThis.process?.env?.BACKEND_SERVER_ID;
      if (globalThis.process?.env) {
        globalThis.process.env.BACKEND_SERVER_ID = 'test-srv';
      }
      const typed = buildCreateTypedData({ chainId: 8453, contractAddress: '0xabc', nonce: 123 });
      assert.equal(typed.domain.chainId, 8453);
      assert.equal(typed.message.action, 'create');
      assert.equal(typed.message.contract, '0xabc');
      assert.equal(typed.message.server, 'test-srv');
      assert.equal(typed.message.nonce, 123);
      assert.ok(typed.message.expiry > typed.message.issuedAt);
      if (globalThis.process?.env) {
        globalThis.process.env.BACKEND_SERVER_ID = prev;
      }
    });

    itFn('buildJoinTypedData produces join payload', () => {
      const typed = buildJoinTypedData({ chainId: 1, contractAddress: '0x123' });
      assert.equal(typed.primaryType, 'Join');
      assert.equal(typed.message.action, 'join');
      assert.equal(typed.message.contract, '0x123');
    });
  });
}

try {
  const { describe, it } = await import('vitest');
  run(describe, it);
} catch {
  const { describe, it } = await import('node:test');
  run(describe, it);
}
