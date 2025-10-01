#!/usr/bin/env node
/* eslint-disable no-console */
const path = require('path');
const { spawn } = require('child_process');
const dotenv = require('dotenv');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === '--env-file' || value === '-e') {
      args.envFile = argv[i + 1];
      i += 1;
      continue;
    }
    if (value.startsWith('--env-file=')) {
      args.envFile = value.slice('--env-file='.length);
      continue;
    }
    if (value === '--skip-pages') {
      args.skipPages = true;
      continue;
    }
    if (value === '--skip-worker') {
      // Legacy flag kept for compatibility with older scripts/tests.
      args.skipWorker = true;
      continue;
    }
    args._.push(value);
  }
  return args;
}

function loadEnv(envFile) {
  if (envFile) {
    const result = dotenv.config({ path: path.resolve(envFile) });
    if (result.error) {
      throw result.error;
    }
    return;
  }
  const defaultCandidate = path.resolve('.cloudflare.env');
  dotenv.config({ path: defaultCandidate });
  dotenv.config();
}

function trim(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function requireEnv(key, message) {
  const value = trim(process.env[key]);
  if (!value) {
    throw new Error(message || `Missing required environment variable ${key}`);
  }
  return value;
}

function optionalEnv(key) {
  return trim(process.env[key]) || null;
}

function buildWranglerArgs(args) {
  const binary = trim(process.env.WRANGLER_BIN);
  if (binary) {
    return { command: binary, args };
  }
  return { command: 'npx', args: ['--yes', 'wrangler', ...args] };
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
      }
    });
  });
}

async function runWrangler(args, options = {}) {
  const { command, args: finalArgs } = buildWranglerArgs(args);
  const mergedEnv = { ...process.env };
  if (trim(process.env.CLOUDFLARE_API_TOKEN)) {
    mergedEnv.CLOUDFLARE_API_TOKEN = trim(process.env.CLOUDFLARE_API_TOKEN);
  }
  if (trim(process.env.CLOUDFLARE_ACCOUNT_ID)) {
    mergedEnv.CLOUDFLARE_ACCOUNT_ID = trim(process.env.CLOUDFLARE_ACCOUNT_ID);
  }
  return runCommand(command, finalArgs, {
    stdio: options.stdio || 'inherit',
    cwd: options.cwd || process.cwd(),
    env: mergedEnv
  });
}

function collectPrefixedEnv(prefix) {
  const entries = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith(prefix)) {
      const finalKey = key.slice(prefix.length);
      entries[finalKey] = trim(value);
    }
  }
  return entries;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadEnv(args.envFile);

  if (args.skipWorker) {
    console.log('[info] --skip-worker ignored (backend deploy handled separately).');
  }

  if (args.skipPages) {
    console.log('> Skipping Pages deployment (--skip-pages)');
    console.log('\nNothing to do.');
    return;
  }

  const pagesProject = requireEnv('CF_PAGES_PROJECT', 'Set CF_PAGES_PROJECT to your Cloudflare Pages project name.');
  const pagesBranch = trim(process.env.CF_PAGES_BRANCH) || 'production';

  const frontendEnv = { ...collectPrefixedEnv('FRONTEND_BUILD_VAR_') };
  const requiredFrontendKeys = ['VITE_BACKEND_URL', 'VITE_BACKEND_SERVER_ID', 'VITE_TEMPL_FACTORY_ADDRESS', 'VITE_TEMPL_FACTORY_DEPLOYMENT_BLOCK'];
  for (const key of requiredFrontendKeys) {
    const value = optionalEnv(key);
    if (!value) {
      throw new Error(`${key} must be set to build the frontend for production.`);
    }
    frontendEnv[key] = value;
  }
  const optionalFrontendKeys = ['VITE_TEMPL_FACTORY_PROTOCOL_RECIPIENT', 'VITE_TEMPL_FACTORY_PROTOCOL_PERCENT', 'VITE_RPC_URL'];
  for (const key of optionalFrontendKeys) {
    const value = optionalEnv(key);
    if (value) {
      frontendEnv[key] = value;
    }
  }

  console.log('> Building frontend for Cloudflare Pages');
  await runCommand('npm', ['--prefix', 'frontend', 'run', 'build'], {
    stdio: 'inherit',
    env: { ...process.env, ...frontendEnv }
  });

  const repoRoot = path.resolve(__dirname, '..');
  const distDir = path.join(repoRoot, 'frontend', 'dist');

  console.log('> Deploying static assets to Cloudflare Pages');
  await runWrangler(['pages', 'deploy', distDir, '--project-name', pagesProject, '--branch', pagesBranch], { cwd: repoRoot });

  console.log('\nDeployment complete!');
  console.log(`  • Pages project: ${pagesProject} (branch ${pagesBranch})`);
  console.log('  • Backend deploy is managed separately (Fly).');
  console.log('');
}

main().catch((err) => {
  console.error('\nCloudflare deployment failed:', err?.message || err);
  process.exit(1);
});
