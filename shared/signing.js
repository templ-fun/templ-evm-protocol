// @ts-check

/**
 * Build a delegate message for signing.
 * @param {string} contract contract address
 * @param {string} delegate delegate address
 * @returns {string}
 */
export function buildDelegateMessage(contract, delegate) {
  return `delegate:${contract.toLowerCase()}:${delegate.toLowerCase()}`;
}

/**
 * Build a mute message for signing.
 * @param {string} contract contract address
 * @param {string} target target address
 * @returns {string}
 */
export function buildMuteMessage(contract, target) {
  return `mute:${contract.toLowerCase()}:${target.toLowerCase()}`;
}
