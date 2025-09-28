#!/usr/bin/env node
/* eslint-disable no-console */
const path = require('path');
const fs = require('fs/promises');
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

async function putSecret(name, value, configPath) {
  const wranglerInvocation = buildWranglerArgs(['secret', 'put', name, '--config', configPath]);
  await new Promise((resolve, reject) => {
    const child = spawn(wranglerInvocation.command, wranglerInvocation.args, {
      stdio: ['pipe', 'inherit', 'inherit'],
      env: { ...process.env }
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`wrangler secret put ${name} failed with code ${code}`));
      }
    });
    child.stdin.write(value);
    child.stdin.write('\n');
    child.stdin.end();
  });
}

function escapeToml(value) {
  return value.replace(/"/g, '\\"');
}

async function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
}

async function writeWorkerConfig({
  name,
  compatibilityDate,
  d1Binding,
  d1Name,
  d1Id,
  vars,
  configPath
}) {
  const tomlLines = [
    `name = "${escapeToml(name)}"`,
    'main = "src/server.js"',
    `compatibility_date = "${escapeToml(compatibilityDate)}"`,
    'node_compat = true'
  ];
  const varEntries = Object.entries(vars).filter(([, value]) => value !== null && value !== undefined && value !== '');
  if (varEntries.length) {
    tomlLines.push('', '[vars]');
    for (const [key, rawValue] of varEntries) {
      tomlLines.push(`  ${key} = "${escapeToml(String(rawValue))}"`);
    }
  }
  tomlLines.push('', '[[d1_databases]]');
  tomlLines.push(`binding = "${escapeToml(d1Binding)}"`);
  tomlLines.push(`database_name = "${escapeToml(d1Name)}"`);
  tomlLines.push(`database_id = "${escapeToml(d1Id)}"`);
  tomlLines.push('');
  await ensureDir(configPath);
  await fs.writeFile(configPath, `${tomlLines.join('\n')}\n`, 'utf8');
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

  const workerNameEnv = trim(process.env.CF_WORKER_NAME);
  let workerName = workerNameEnv;
  if (!args.skipWorker) {
    workerName = requireEnv('CF_WORKER_NAME', 'Set CF_WORKER_NAME to the Cloudflare Worker name to deploy.');
  } else if (!workerName) {
    workerName = 'templ-backend-worker';
  }
  const d1Name = requireEnv('CF_D1_DATABASE_NAME', 'Set CF_D1_DATABASE_NAME to your D1 database name.');
  const d1Id = requireEnv('CF_D1_DATABASE_ID', 'Set CF_D1_DATABASE_ID to your D1 database id.');
  const d1Binding = trim(process.env.CF_D1_BINDING) || 'TEMPL_DB';
  const compatibilityDate = trim(process.env.CF_COMPATIBILITY_DATE) || new Date().toISOString().slice(0, 10);
  const telegramToken = args.skipWorker
    ? optionalEnv('TELEGRAM_BOT_TOKEN')
    : requireEnv('TELEGRAM_BOT_TOKEN', 'Provide TELEGRAM_BOT_TOKEN so the Worker can notify chats.');
  const rpcUrl = args.skipWorker
    ? optionalEnv('RPC_URL')
    : requireEnv('RPC_URL', 'Provide RPC_URL for the Worker to watch on-chain events.');
  let backendServerId = trim(process.env.BACKEND_SERVER_ID);
  if (!backendServerId) {
    if (args.skipWorker) {
      backendServerId = requireEnv(
        'BACKEND_SERVER_ID',
        'Set BACKEND_SERVER_ID so the frontend knows which backend instance to contact.'
      );
    } else {
      backendServerId = workerName;
    }
  }
  const factoryBlock = trim(process.env.TRUSTED_FACTORY_DEPLOYMENT_BLOCK);
  const requireVerifyEnv = trim(process.env.REQUIRE_CONTRACT_VERIFY);
  const cloudflareAccount = requireEnv('CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_ACCOUNT_ID is required for Wrangler API calls.');
  const cloudflareToken = requireEnv('CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_API_TOKEN is required for Wrangler API calls.');
  const pagesProject = args.skipPages
    ? null
    : requireEnv('CF_PAGES_PROJECT', 'Set CF_PAGES_PROJECT to your Cloudflare Pages project name.');
  const pagesBranch = trim(process.env.CF_PAGES_BRANCH) || 'production';

  process.env.CLOUDFLARE_ACCOUNT_ID = cloudflareAccount;
  process.env.CLOUDFLARE_API_TOKEN = cloudflareToken;

  const repoRoot = path.resolve(__dirname, '..');
  const backendDir = path.join(repoRoot, 'backend');
  const generatedWranglerPath = path.join(backendDir, 'wrangler.deployment.toml');

  const baseVars = {
    BACKEND_SERVER_ID: backendServerId,
    NODE_ENV: 'production'
  };
  if (!args.skipWorker) {
    baseVars.APP_BASE_URL = requireEnv(
      'APP_BASE_URL',
      'APP_BASE_URL must point to the frontend domain used in Telegram deep links.'
    );
    baseVars.TRUSTED_FACTORY_ADDRESS = requireEnv(
      'TRUSTED_FACTORY_ADDRESS',
      'TRUSTED_FACTORY_ADDRESS must be set so the backend only serves templs from your factory.'
    );
    baseVars.REQUIRE_CONTRACT_VERIFY = requireVerifyEnv || '1';
  } else {
    const optionalAppBaseUrl = optionalEnv('APP_BASE_URL');
    if (optionalAppBaseUrl) {
      baseVars.APP_BASE_URL = optionalAppBaseUrl;
    }
    const optionalFactory = optionalEnv('TRUSTED_FACTORY_ADDRESS');
    if (optionalFactory) {
      baseVars.TRUSTED_FACTORY_ADDRESS = optionalFactory;
    }
    if (requireVerifyEnv) {
      baseVars.REQUIRE_CONTRACT_VERIFY = requireVerifyEnv;
    }
  }
  if (factoryBlock) {
    baseVars.TRUSTED_FACTORY_DEPLOYMENT_BLOCK = factoryBlock;
  }
  const extraVars = collectPrefixedEnv('CLOUDFLARE_BACKEND_VAR_');
  Object.assign(baseVars, extraVars);

  console.log(
    args.skipWorker
      ? '> Generating Worker wrangler config (Worker deployment skipped)'
      : '> Generating Worker wrangler config'
  );
  await writeWorkerConfig({
    name: workerName,
    compatibilityDate,
    d1Binding,
    d1Name,
    d1Id,
    vars: baseVars,
    configPath: generatedWranglerPath
  });

  const schemaPath = path.join(backendDir, 'src', 'persistence', 'schema.sql');
  console.log('> Applying D1 schema');
  await runWrangler(['d1', 'execute', d1Name, '--database-id', d1Id, '--file', schemaPath]);

  if (!args.skipWorker) {
    console.log('> Syncing Worker secrets');
    await putSecret('TELEGRAM_BOT_TOKEN', telegramToken, generatedWranglerPath);
    await putSecret('RPC_URL', rpcUrl, generatedWranglerPath);
    const extraSecrets = collectPrefixedEnv('CLOUDFLARE_BACKEND_SECRET_');
    for (const [key, value] of Object.entries(extraSecrets)) {
      if (!value) continue;
      await putSecret(key, value, generatedWranglerPath);
    }

    console.log('> Deploying Worker');
    await runWrangler(['deploy', '--config', generatedWranglerPath], { cwd: backendDir });
  } else {
    console.log('> Skipping Worker deployment (--skip-worker)');
  }

  const frontendEnvKeys = [
    'VITE_BACKEND_URL',
    'VITE_BACKEND_SERVER_ID',
    'VITE_TEMPL_FACTORY_ADDRESS',
    'VITE_TEMPL_FACTORY_PROTOCOL_RECIPIENT',
    'VITE_TEMPL_FACTORY_PROTOCOL_PERCENT',
    'VITE_RPC_URL'
  ];
  const frontendEnv = { ...collectPrefixedEnv('FRONTEND_BUILD_VAR_') };
  for (const key of frontendEnvKeys) {
    const value = optionalEnv(key);
    if (value) {
      frontendEnv[key] = value;
    }
  }
  if (!frontendEnv.VITE_BACKEND_URL) {
    throw new Error('VITE_BACKEND_URL must be set to your production backend URL so the SPA points at the deployed API.');
  }
  if (!frontendEnv.VITE_BACKEND_SERVER_ID) {
    frontendEnv.VITE_BACKEND_SERVER_ID = backendServerId;
  }

  if (!args.skipPages) {
    console.log('> Building frontend for Cloudflare Pages');
    await runCommand('npm', ['--prefix', 'frontend', 'run', 'build'], {
      stdio: 'inherit',
      env: { ...process.env, ...frontendEnv }
    });

    const distDir = path.join(repoRoot, 'frontend', 'dist');
    console.log('> Deploying static assets to Cloudflare Pages');
    await runWrangler(['pages', 'deploy', distDir, '--project-name', pagesProject, '--branch', pagesBranch]);
  } else {
    console.log('> Skipping Pages deployment (--skip-pages)');
  }

  console.log('\nDeployment complete!');
  if (!args.skipWorker) {
    console.log(`  • Worker name: ${workerName}`);
  } else {
    console.log('  • Worker deployment skipped; rerun without --skip-worker after setting Worker env vars.');
  }
  if (!args.skipPages) {
    console.log(`  • Pages project: ${pagesProject} (branch ${pagesBranch})`);
  }
  console.log('  • Update the generated backend/wrangler.deployment.toml if you need to re-run Wrangler manually.');
  console.log('');
}

main().catch((err) => {
  console.error('\nCloudflare deployment failed:', err?.message || err);
  process.exit(1);
});
