import assert from 'node:assert/strict';
import {
  buildCreateTypedData,
  buildDelegateMessage,
  buildDelegateTypedData,
  buildJoinTypedData,
  buildMuteMessage,
  buildMuteTypedData,
} from './signing.js';

function run(describeFn, itFn) {
  describeFn('signing helpers', () => {
    itFn('buildDelegateMessage formats delegate message', () => {
      assert.equal(
        buildDelegateMessage('0xAbC', '0xDeF'),
        'delegate:0xabc:0xdef'
      );
    });

    itFn('buildMuteMessage formats mute message', () => {
      assert.equal(
        buildMuteMessage('0xAbC', '0xDeF'),
        'mute:0xabc:0xdef'
      );
    });

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

    itFn('buildDelegateTypedData includes delegate and mute typed data includes target', () => {
      const delegateTyped = buildDelegateTypedData({ chainId: 1, contractAddress: '0xabc', delegateAddress: '0xdef' });
      assert.equal(delegateTyped.message.delegate, '0xdef');
      assert.equal(delegateTyped.primaryType, 'DelegateMute');

      const muteTyped = buildMuteTypedData({ chainId: 1, contractAddress: '0xabc', targetAddress: '0x123' });
      assert.equal(muteTyped.message.target, '0x123');
      assert.equal(muteTyped.primaryType, 'Mute');
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
