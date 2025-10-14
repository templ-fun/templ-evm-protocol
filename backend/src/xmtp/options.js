// XMTP configuration options
export function resolveXmtpEnv() {
  const raw = process.env.XMTP_ENV;
  if (raw && ['local', 'dev', 'production'].includes(raw)) {
    return raw;
  }
  if (process.env.NODE_ENV === 'production') {
    return 'production';
  }
  return 'dev';
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
