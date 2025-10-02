#!/usr/bin/env node
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runSkipWorkerSmokeTest() {
  const repoRoot = path.resolve(__dirname, '..');
  const deployScript = path.join(repoRoot, 'scripts', 'deploy-cloudflare.js');
  const fakeWrangler = path.join(repoRoot, 'scripts', '__mocks__', 'wrangler-success.js');
  const env = {
    ...process.env,
    WRANGLER_BIN: fakeWrangler,
    CLOUDFLARE_ACCOUNT_ID: 'test-account',
    CLOUDFLARE_API_TOKEN: 'test-token',
    BACKEND_SERVER_ID: 'templ-backend-node',
    VITE_BACKEND_URL: 'https://example.invalid/api'
  };

  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [deployScript, '--skip-worker', '--skip-pages'], {
      cwd: repoRoot,
      env,
      stdio: 'inherit'
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`deploy-cloudflare.js exited with code ${code}`));
      }
    });
  });
}

runSkipWorkerSmokeTest()
  .then(() => {
    console.log('\n[skip-worker smoke test] deploy script exited cleanly.');
  })
  .catch((err) => {
    console.error('\n[skip-worker smoke test] deploy script failed:', err?.message || err);
    process.exit(1);
  });
