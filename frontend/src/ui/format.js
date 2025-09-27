/** @typedef {'wei' | 'gwei' | 'ether'} Unit */

/**
 * Format a token balance into a compact display using ether/gwei/wei as fallbacks.
 * @param {import('ethers').formatUnits} formatUnits
 * @param {string | bigint} value
 * @param {number} decimals
 * @returns {string}
 */
export function formatTokenDisplay(formatUnits, value, decimals) {
  const big = normalizeBigInt(value);
  if (big === 0n) return '0';

  const ether = tryFormat(() => formatUnits(big, decimals));
  if (ether && shouldUse(ether)) {
    return `${ether} ${selectUnit(decimals, 'ether')}`;
  }

  if (decimals >= 9) {
    const gwei = tryFormat(() => formatUnits(big, decimals - 9));
    if (gwei) {
      return `${gwei} gwei`;
    }
  }

  const wei = tryFormat(() => formatUnits(big, 0));
  if (wei) {
    return `${wei} wei`;
  }

  return big.toString();
}

function normalizeBigInt(value) {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'string' && value.length) {
    try {
      return BigInt(value);
    } catch {}
  }
  return 0n;
}

function tryFormat(fn) {
  try {
    return trimTrailingZeros(fn());
  } catch {
    return '';
  }
}

function trimTrailingZeros(value) {
  if (typeof value !== 'string') return value;
  if (!value.includes('.')) return value;
  return value.replace(/\.0+$/, '').replace(/(\.\d*?[1-9])0+$/, '$1');
}

function shouldUse(formatted) {
  const numeric = Number(formatted);
  if (Number.isNaN(numeric)) return false;
  return numeric >= 1 || numeric === 0;
}

/**
 * @param {number} decimals
 * @param {Unit} fallback
 */
function selectUnit(decimals, fallback) {
  if (fallback === 'ether' && decimals !== 18) {
    return 'token units';
  }
  if (fallback === 'gwei' && decimals < 9) {
    return 'token units';
  }
  return fallback;
}

/**
 * Format a duration in seconds into a human readable string.
 * @param {number | string | bigint} seconds
 * @returns {string}
 */
export function formatDuration(seconds) {
  if (seconds === undefined || seconds === null) {
    return '0s';
  }
  let total = Number(seconds);
  if (!Number.isFinite(total)) {
    return '0s';
  }
  if (total <= 0) {
    return '0s';
  }
  total = Math.floor(total);
  const units = [
    { label: 'day', seconds: 24 * 60 * 60 },
    { label: 'hour', seconds: 60 * 60 },
    { label: 'minute', seconds: 60 },
    { label: 'second', seconds: 1 }
  ];
  const parts = [];
  for (const unit of units) {
    if (total < unit.seconds) continue;
    const count = Math.floor(total / unit.seconds);
    total -= count * unit.seconds;
    const suffix = count === 1 ? unit.label : `${unit.label}s`;
    parts.push(`${count} ${suffix}`);
    if (parts.length === 2) break;
  }
  if (parts.length === 0) {
    return '0s';
  }
  return parts.join(', ');
}
