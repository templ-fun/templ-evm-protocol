/** @type {Array<'local'|'dev'|'production'>} */
const XMTP_ENV_VALUES = ['local', 'dev', 'production'];

/**
 * @param {string} value
 * @returns {value is 'local'|'dev'|'production'}
 */
function isValidEnv(value) {
  return value === 'local' || value === 'dev' || value === 'production';
}

/**
 * @param {unknown} value
 * @returns {'local'|'dev'|'production'}
 */
function normalizeEnv(value) {
  if (!value) return 'production';
  const lower = String(value).toLowerCase();
  return isValidEnv(lower) ? lower : 'production';
}

export function resolveXmtpEnv() {
  return normalizeEnv(process.env.XMTP_ENV);
}

export function isFastEnv() {
  return process.env.NODE_ENV === 'test' || process.env.DISABLE_XMTP_WAIT === '1';
}

export function allowDeterministicInbox() {
  return resolveXmtpEnv() === 'local' || process.env.NODE_ENV === 'test';
}

export function shouldSkipNetworkResolution() {
  return process.env.DISABLE_XMTP_WAIT === '1' || process.env.NODE_ENV === 'test';
}

export function shouldUpdateMetadata() {
  return process.env.XMTP_METADATA_UPDATES !== '0';
}

export function shouldVerifyContracts() {
  return process.env.REQUIRE_CONTRACT_VERIFY === '1' || process.env.NODE_ENV === 'production';
}

export { XMTP_ENV_VALUES };
