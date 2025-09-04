import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDelegateMessage, buildMuteMessage } from '../../shared/signing.js';

test('buildDelegateMessage formats delegate message', () => {
  assert.equal(
    buildDelegateMessage('0xAbC', '0xDeF'),
    'delegate:0xabc:0xdef'
  );
});

test('buildMuteMessage formats mute message', () => {
  assert.equal(
    buildMuteMessage('0xAbC', '0xDeF'),
    'mute:0xabc:0xdef'
  );
});
