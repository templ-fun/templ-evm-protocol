import assert from 'node:assert/strict';
import { buildDelegateMessage, buildMuteMessage } from './signing.js';

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
  });
}

try {
  const { describe, it } = await import('vitest');
  run(describe, it);
} catch {
  const { describe, it } = await import('node:test');
  run(describe, it);
}
