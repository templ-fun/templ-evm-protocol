// XMTP configuration options
export function resolveXmtpEnv() {
  const env = process.env.XMTP_ENV || 'dev';
  return ['local', 'dev', 'production'].includes(env) ? env : 'dev';
}

export function isFastEnv() {
  return process.env.NODE_ENV === 'test' || process.env.FAST_XMTP === '1';
}

export function allowDeterministicInbox() {
  return process.env.ALLOW_DETERMINISTIC_INBOX === '1';
}

export function shouldVerifyContracts() {
  return process.env.VERIFY_CONTRACTS === '1';
}