import { describe, expect, it, vi } from 'vitest';
import { formatTokenDisplay } from './format.js';

const mockFormatUnits = vi.fn((value, decimals) => {
  const divisor = 10n ** BigInt(decimals);
  const integerPart = value / divisor;
  const fraction = value % divisor;
  if (fraction === 0n) return integerPart.toString();
  return `${integerPart}.${fraction.toString()}`;
});

describe('formatTokenDisplay', () => {
  it('returns 0 for zero values', () => {
    expect(formatTokenDisplay(mockFormatUnits, 0n, 18)).toBe('0');
  });

  it('formats ether-scale balances with symbol', () => {
    expect(formatTokenDisplay(mockFormatUnits, 10n ** 18n, 18)).toBe('1 ether');
  });

  it('formats gwei-scale balances when decimals >= 9', () => {
    expect(formatTokenDisplay(mockFormatUnits, 10n ** 12n, 18)).toBe('1000 gwei');
  });

  it('falls back to wei when decimals are zero', () => {
    expect(formatTokenDisplay(mockFormatUnits, 12345n, 0)).toBe('12345 token units');
  });

  it('handles string inputs', () => {
    expect(formatTokenDisplay(mockFormatUnits, '1000000000000', 18)).toMatch(/gwei|token/);
  });
});
