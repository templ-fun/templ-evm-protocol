import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const scriptPath = path.join(repoRoot, 'scripts', 'deploy-cloudflare.js');
const stubWrangler = path.join(repoRoot, 'scripts', '__fixtures__', 'wrangler-success.sh');

const child = spawn('node', [scriptPath, '--skip-worker', '--skip-pages'], {
  cwd: repoRoot,
  env: {
    ...process.env,
    WRANGLER_BIN: stubWrangler,
    CLOUDFLARE_ACCOUNT_ID: 'stub-account-id',
    CLOUDFLARE_API_TOKEN: 'stub-api-token',
    CF_D1_DATABASE_NAME: 'templ-backend',
    CF_D1_DATABASE_ID: '00000000-0000-0000-0000-000000000000',
    BACKEND_SERVER_ID: 'templ-prod',
    VITE_BACKEND_URL: 'https://templ-backend.example'
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

const stdoutChunks = [];
const stderrChunks = [];
child.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
child.stderr.on('data', (chunk) => stderrChunks.push(chunk));

const [code] = await once(child, 'exit');
const stdout = Buffer.concat(stdoutChunks).toString();
const stderr = Buffer.concat(stderrChunks).toString();

assert.strictEqual(
  code,
  0,
  `Expected deploy-cloudflare.js to exit cleanly with --skip-worker. stdout:\n${stdout}\nstderr:\n${stderr}`
);
assert.match(
  stdout,
  /> Skipping Worker deployment \(--skip-worker\)/,
  'Expected script output to mention that Worker deployment was skipped.'
);
assert.strictEqual(
  stderr.trim(),
  '',
  `Expected no stderr output, received:\n${stderr}`
);

console.log('deploy-cloudflare --skip-worker smoke test passed');
