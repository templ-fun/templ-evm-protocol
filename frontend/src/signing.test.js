import { describe, it, expect } from 'vitest';
import { buildDelegateMessage, buildMuteMessage } from '../../shared/signing.js';

describe('signing helpers', () => {
  it('buildDelegateMessage formats delegate message', () => {
    expect(buildDelegateMessage('0xAbC', '0xDeF')).toBe('delegate:0xabc:0xdef');
  });

  it('buildMuteMessage formats mute message', () => {
    expect(buildMuteMessage('0xAbC', '0xDeF')).toBe('mute:0xabc:0xdef');
  });
});
