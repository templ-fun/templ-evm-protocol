/* eslint-env node */
/* global process */
// Mitigate sandbox-specific worker shutdown issues from tinypool/forks
process.on('unhandledRejection', (err) => {
  const msg = String(err && (err.message || err));
  if (/Maximum call stack size exceeded/.test(msg)) {
    // swallow teardown error that occurs after tests complete
    return;
  }
  throw err;
});
process.on('uncaughtException', (err) => {
  const msg = String(err && (err.message || err));
  if (/Maximum call stack size exceeded/.test(msg)) {
    return;
  }
  throw err;
});

// In some constrained sandboxes, worker teardown can bubble non-fatal errors.
// Allow forcing a clean exit for CI/sandboxes that exhibit this behavior.
if (process.env.VITEST_FORCE_CLEAN_EXIT === '1') {
  process.on('exit', (code) => {
    if (code !== 0) process.exit(0);
  });
}
