#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const run = (cmd, args, env = {}) => {
  const result = spawnSync(cmd, args, {
    stdio: 'inherit',
    env: { ...process.env, ...env }
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

const shouldRunLocal = process.env.E2E_XMTP_LOCAL !== '0';
let localRan = false;
if (shouldRunLocal) {
  let dockerAvailable = false;
  try {
    const check = spawnSync('docker', ['info'], { stdio: 'ignore' });
    dockerAvailable = check.status === 0;
  } catch (err) {
    dockerAvailable = false;
  }
  if (dockerAvailable) {
    run('npm', ['run', 'test:e2e:local']);
    spawnSync('npm', ['run', 'xmtp:local:down'], { stdio: 'inherit' });
    localRan = true;
  } else {
    console.log('[matrix] Docker unavailable; skipping local XMTP test run');
  }
} else {
  console.log('[matrix] E2E_XMTP_LOCAL=0; skipping local XMTP test run');
}

run('npm', ['run', 'test:e2e:prod']);
if (localRan) {
  console.log('[matrix] Local + production XMTP e2e runs completed');
} else {
  console.log('[matrix] Production XMTP e2e run completed');
}
