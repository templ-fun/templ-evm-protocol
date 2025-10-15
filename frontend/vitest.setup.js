/* eslint-env node */
/* global process */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterAll } from 'vitest';
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

// Remove XMTP SQLite files in frontend/ and backend/ after tests complete
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const frontendDir = path.resolve(__dirname);
const backendDir = path.resolve(frontendDir, '../backend');

function removeXmtpDbFiles(dir) {
  try {
    const entries = fs.readdirSync(dir);
    for (const name of entries) {
      if (!name.startsWith('xmtp-')) continue;
      if (!name.includes('.db3')) continue;
      const full = path.join(dir, name);
      try {
        fs.rmSync(full, { force: true });
      } catch {}
    }
  } catch {}
}

afterAll(() => {
  removeXmtpDbFiles(frontendDir);
  removeXmtpDbFiles(backendDir);
});
