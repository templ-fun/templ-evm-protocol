// @ts-check
import express from 'express';
import dotenv from 'dotenv';
import fs from 'fs';
import { ethers } from 'ethers';
import helmet from 'helmet';
import rateLimit, { MemoryStore } from 'express-rate-limit';
import { createRateLimitStore } from './config.js';
import cors from 'cors';
import Database from 'better-sqlite3';

import templsRouter from './routes/templs.js';
import joinRouter from './routes/join.js';
import delegatesRouter from './routes/delegates.js';
import mutesRouter from './routes/mutes.js';
import debugRouter from './routes/debug.js';

import { logger } from './logger.js';
import { createXmtpWithRotation, waitForInboxReady, XMTP_ENV, waitForXmtpClientReady } from './xmtp/index.js';

export { logger, createXmtpWithRotation, waitForInboxReady, XMTP_ENV };

export function createApp(opts) {
  /** @type {{xmtp:any, hasPurchased:(contract:string,member:string)=>Promise<boolean>, connectContract?: (address:string)=>{on: Function}, dbPath?: string, db?: any, rateLimitStore?: import('express-rate-limit').Store}} */
  // @ts-ignore - runtime validation below
  const { xmtp, hasPurchased, connectContract, dbPath, db, rateLimitStore, provider } =
    opts || {};
  const app = express();
  const allowedOrigins =
    process.env.ALLOWED_ORIGINS?.split(',')
      .map((o) => o.trim())
      .filter(Boolean) ?? ['http://localhost:5173'];
  app.use(cors({ origin: allowedOrigins }));
  app.use(express.json());
  app.use(helmet());
  const store = rateLimitStore ?? new MemoryStore();
  // In tests/e2e runs we disable rate limiting to avoid 429s during heavy polling
  if (process.env.NODE_ENV !== 'test') {
    const limiter = rateLimit({ windowMs: 60_000, max: 100, store });
    app.use(limiter);
  }

  const groups = new Map();
  const lastJoin = { at: 0, payload: null };
  const database =
    db ??
    new Database(dbPath ?? new URL('../groups.db', import.meta.url).pathname);
  database.exec(
    'CREATE TABLE IF NOT EXISTS groups (contract TEXT PRIMARY KEY, groupId TEXT, priest TEXT)'
  );
  database.exec(
    'CREATE TABLE IF NOT EXISTS mutes (contract TEXT, target TEXT, count INTEGER, until INTEGER, PRIMARY KEY(contract, target))'
  );
  database.exec(
    'CREATE TABLE IF NOT EXISTS delegates (contract TEXT, delegate TEXT, PRIMARY KEY(contract, delegate))'
  );
  database.exec(
    'CREATE TABLE IF NOT EXISTS signatures (sig TEXT PRIMARY KEY, usedAt INTEGER)'
  );

  function persist(contract, record) {
    database
      .prepare(
        'INSERT OR REPLACE INTO groups (contract, groupId, priest) VALUES (?, ?, ?)'
      )
      .run(contract, (record.groupId || record.group?.id), record.priest);
  }

  (async () => {
    try {
      const rows = database
        .prepare('SELECT contract, groupId, priest FROM groups')
        .all();
      for (const row of rows) {
        try {
          const group = await xmtp.conversations.getConversationById(row.groupId);
          groups.set(row.contract, { group, groupId: row.groupId, priest: row.priest, memberSet: new Set() });
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
  })();

  const context = { xmtp, hasPurchased, connectContract, database, groups, persist, lastJoin, provider };

  app.use(templsRouter(context));
  app.use(joinRouter(context));
  app.use(delegatesRouter(context));
  app.use(mutesRouter(context));
  if (process.env.ENABLE_DEBUG_ENDPOINTS === '1') {
    app.use(debugRouter(context));
  }

  app.close = async () => {
    await store.shutdown?.();
    database.close();
  };

  return app;
}

// Boot the standalone server when executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  dotenv.config();
  const { RPC_URL } = process.env;
  if (!RPC_URL) {
    throw new Error('Missing RPC_URL environment variable');
  }
  if (process.env.NODE_ENV === 'production' && !process.env.BACKEND_DB_ENC_KEY) {
    throw new Error('BACKEND_DB_ENC_KEY required in production');
  }
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  // Determine DB path early (used to persist bot key)
  const dbPathEnv = process.env.DB_PATH;
  const defaultDbPath = new URL('../groups.db', import.meta.url).pathname;
  const dbPath = dbPathEnv || defaultDbPath;
  // Optionally wipe database before reading bot key (e2e/dev only)
  if (dbPath && process.env.CLEAR_DB === '1') {
    try { fs.rmSync(dbPath, { force: true }); } catch (e) { logger.warn({ err: e?.message || e }); }
  }
  // Generate or load a persistent bot private key tied to this server instance.
  let botPrivateKey = process.env.BOT_PRIVATE_KEY;
  try {
    const db = new Database(dbPath);
    try { db.exec('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT)'); } catch { /* ignore */ }
    if (!botPrivateKey) {
      try {
        const row = db.prepare('SELECT value FROM kv WHERE key = ?').get('bot_private_key');
        if (row && row.value) {
          botPrivateKey = String(row.value);
        }
      } catch { /* ignore */ }
    }
    if (!botPrivateKey) {
      // Create a fresh key and persist it so the "invite bot" is stable across restarts
      const w = ethers.Wallet.createRandom();
      botPrivateKey = w.privateKey;
      try { db.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)').run('bot_private_key', botPrivateKey); } catch { /* ignore */ }
      logger.info('Generated and persisted new invite-bot key');
    }
    try { db.close(); } catch { /* ignore */ }
  } catch (e) {
    // Fall back to env-only key if DB init fails
    if (!botPrivateKey) throw e;
  }
  const wallet = new ethers.Wallet(botPrivateKey, provider);
  const envMax = Number(process.env.XMTP_MAX_ATTEMPTS);
  let xmtp;
  const bootTries = Number.isFinite(Number(process.env.XMTP_BOOT_MAX_TRIES))
    ? Number(process.env.XMTP_BOOT_MAX_TRIES)
    : 30;
  for (let i = 1; i <= bootTries; i++) {
    try {
      xmtp = await createXmtpWithRotation(
        wallet,
        Number.isFinite(envMax) && envMax > 0 ? envMax : undefined
      );
      const ready = await waitForXmtpClientReady(xmtp, 30, 500);
      if (!ready) throw new Error('XMTP client not ready');
      break;
    } catch (e) {
      logger.warn({ attempt: i, err: String(e?.message || e) }, 'XMTP boot not ready; retrying');
      if (i === bootTries) throw e;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  const hasPurchased = async (contractAddress, memberAddress) => {
    const contract = new ethers.Contract(
      contractAddress,
      ['function hasAccess(address) view returns (bool)'],
      provider
    );
    return contract.hasAccess(memberAddress);
  };
  // Pass dbPath through to createApp for group mappings and moderation state
  const rateLimitStore = await createRateLimitStore();
  const app = createApp({ xmtp, hasPurchased, dbPath, rateLimitStore, provider });
  const port = process.env.PORT || 3001;
  app.listen(port, () => {
    logger.info({ port }, 'TEMPL backend listening');
  });
}
