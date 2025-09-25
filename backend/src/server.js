// @ts-check
import express from 'express';
import dotenv from 'dotenv';
import fs from 'fs';
import { ethers } from 'ethers';
import helmet from 'helmet';
import rateLimit, { MemoryStore } from 'express-rate-limit';
import { createRateLimitStore } from './config.js';
import cors from 'cors';

import templsRouter from './routes/templs.js';
import joinRouter from './routes/join.js';

import { logger } from './logger.js';
import { createTelegramNotifier } from './telegram.js';
import { createMemoryDatabase } from './memoryDb.js';

let BetterSqlite = null;
try {
  const mod = await import('better-sqlite3');
  BetterSqlite = mod.default;
} catch (err) {
  if (process.env.BACKEND_USE_MEMORY_DB === '1') {
    // Memory DB fallback enabled; ignore missing native bindings.
  } else {
    throw err;
  }
}

const TEMPL_EVENT_ABI = [
  'event AccessPurchased(address indexed purchaser,uint256 totalAmount,uint256 burnedAmount,uint256 treasuryAmount,uint256 memberPoolAmount,uint256 protocolAmount,uint256 timestamp,uint256 blockNumber,uint256 purchaseId)',
  'event ProposalCreated(uint256 indexed proposalId,address indexed proposer,uint256 endTime,string title,string description)',
  'event VoteCast(uint256 indexed proposalId,address indexed voter,bool support,uint256 timestamp)',
  'event PriestChanged(address indexed oldPriest,address indexed newPriest)',
  'event ProposalExecuted(uint256 indexed proposalId,bool success,bytes returnData)',
  'event TemplHomeLinkUpdated(string previousLink,string newLink)',
  'function treasuryBalance() view returns (uint256)',
  'function memberPoolBalance() view returns (uint256)',
  'function templHomeLink() view returns (string)',
  'function getProposal(uint256 proposalId) view returns (address proposer,uint256 yesVotes,uint256 noVotes,uint256 endTime,bool executed,bool passed,string title,string description)',
  'function getProposalSnapshots(uint256 proposalId) view returns (uint256,uint256,uint256,uint256,uint256,uint256)'
];

const PROPOSAL_CHECK_INTERVAL_MS = 60_000;
const DAILY_DIGEST_CHECK_INTERVAL_MS = 60_000;
const DAILY_DIGEST_PERIOD_MS = 24 * 60 * 60 * 1000;

export { logger };

function buildAllowedOrigins() {
  const env = process.env.ALLOWED_ORIGINS;
  if (!env) return ['http://localhost:5173'];
  return env
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

function toNumber(value) {
  if (value === undefined || value === null) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : 0;
  if (typeof value === 'bigint') {
    const asNumber = Number(value);
    return Number.isNaN(asNumber) ? 0 : asNumber;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? 0 : Math.trunc(parsed);
  }
  if (typeof value === 'object' && value !== null && typeof value.toString === 'function') {
    const parsed = Number(value.toString());
    return Number.isNaN(parsed) ? 0 : Math.trunc(parsed);
  }
  return 0;
}

function toProposalKey(value) {
  if (value === undefined || value === null) return null;
  try {
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'number') return Math.trunc(value).toString();
    return String(value);
  } catch {
    return String(value);
  }
}

function ensureProposalMeta(record, proposalKey) {
  if (!proposalKey) return null;
  if (!record.proposalsMeta || typeof record.proposalsMeta.set !== 'function') {
    record.proposalsMeta = new Map();
  }
  if (!record.proposalsMeta.has(proposalKey)) {
    record.proposalsMeta.set(proposalKey, {
      proposalId: proposalKey,
      title: '',
      description: '',
      proposer: '',
      endTime: 0,
      quorumReachedAt: 0,
      quorumNotified: false,
      votingClosedNotified: false,
      executed: false,
      passed: false
    });
  }
  return record.proposalsMeta.get(proposalKey);
}

function updateMetaFromDetails(meta, details) {
  if (!meta || !details) return;
  const getField = (key, index) => (details?.[key] !== undefined ? details[key] : details?.[index]);
  const endTime = getField('endTime', 3);
  const executed = getField('executed', 4);
  const passed = getField('passed', 5);
  const proposer = getField('proposer', 0);
  const title = getField('title', 6);
  const description = getField('description', 7);
  if (endTime !== undefined && endTime !== null) {
    const asNum = toNumber(endTime);
    if (asNum) meta.endTime = asNum;
  }
  if (executed !== undefined && executed !== null) {
    meta.executed = Boolean(executed);
  }
  if (passed !== undefined && passed !== null) {
    meta.passed = Boolean(passed);
  }
  if (proposer) {
    meta.proposer = String(proposer).toLowerCase();
  }
  if (title !== undefined && title !== null && title !== '') {
    meta.title = String(title);
  }
  if (description !== undefined && description !== null && description !== '') {
    meta.description = String(description);
  }
}

function updateMetaFromSnapshots(meta, snapshots) {
  if (!meta || !snapshots) return;
  const quorumReached = snapshots?.quorumReachedAt ?? snapshots?.[5];
  const asNum = toNumber(quorumReached);
  if (asNum) meta.quorumReachedAt = asNum;
}

function initializeDatabase({ dbPath, db }) {
  const useMemory = process.env.BACKEND_USE_MEMORY_DB === '1';
  let database;
  let owned = false;
  if (db) {
    database = db;
  } else if (useMemory) {
    database = createMemoryDatabase();
    owned = true;
  } else {
    if (!BetterSqlite) {
      throw new Error('better-sqlite3 bindings unavailable; set BACKEND_USE_MEMORY_DB=1 for an in-memory fallback');
    }
    database = new BetterSqlite(dbPath ?? new URL('../groups.db', import.meta.url).pathname);
    owned = true;
  }
  database.exec('CREATE TABLE IF NOT EXISTS groups (contract TEXT PRIMARY KEY, groupId TEXT, priest TEXT, homeLink TEXT)');
  try {
    database.exec('ALTER TABLE groups ADD COLUMN homeLink TEXT');
  } catch (err) {
    if (!String(err?.message || err).toLowerCase().includes('duplicate column')) {
      throw err;
    }
  }
  database.exec('CREATE TABLE IF NOT EXISTS signatures (sig TEXT PRIMARY KEY, usedAt INTEGER)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_signatures_used_at ON signatures (usedAt)');
  database.exec('CREATE TABLE IF NOT EXISTS pending_bindings (contract TEXT PRIMARY KEY, bindCode TEXT, createdAt INTEGER)');
  const insertGroup = database.prepare('INSERT OR REPLACE INTO groups (contract, groupId, priest, homeLink) VALUES (?, ?, ?, ?)');
  const insertBinding = database.prepare('INSERT OR REPLACE INTO pending_bindings (contract, bindCode, createdAt) VALUES (?, ?, ?)');
  const deleteBinding = database.prepare('DELETE FROM pending_bindings WHERE contract = ?');
  const selectBindings = database.prepare('SELECT contract, bindCode FROM pending_bindings');
  const persist = (contract, record) => {
    insertGroup.run(contract, record.telegramChatId || null, record.priest, record.templHomeLink || null);
  };
  const saveBinding = (contract, code) => {
    insertBinding.run(contract, code, Date.now());
  };
  const removeBinding = (contract) => {
    deleteBinding.run(contract);
  };
  const loadBindings = () => {
    try {
      return selectBindings.all();
    } catch {
      return [];
    }
  };
  const close = () => {
    if (!owned || !database?.close) return;
    try { database.close(); } catch {/* ignore close errors */}
  };
  return { database, persist, saveBinding, removeBinding, loadBindings, close };
}

async function maybeNotifyQuorum({ record, contractAddress, proposalId, meta, notifier, logger }) {
  if (!record?.telegramChatId || !notifier?.notifyProposalQuorumReached) return;
  const contract = record.contract;
  if (!contract || typeof contract.getProposalSnapshots !== 'function') return;
  try {
    const snapshots = await contract.getProposalSnapshots(proposalId);
    updateMetaFromSnapshots(meta, snapshots);
    if (meta.quorumReachedAt && !meta.quorumNotified) {
      await notifier.notifyProposalQuorumReached({
        chatId: record.telegramChatId,
        contractAddress,
        proposalId: proposalId?.toString?.() ?? String(proposalId),
        title: meta.title,
        description: meta.description,
        quorumReachedAt: meta.quorumReachedAt,
        homeLink: record.templHomeLink || ''
      });
      meta.quorumNotified = true;
    }
  } catch (err) {
    logger?.warn?.({ err: String(err?.message || err), contract: contractAddress }, 'Failed to evaluate quorum status');
  }
}

async function fetchBalances(record, logger) {
  const result = { treasuryBalance: null, memberPoolBalance: null };
  const contract = record?.contract;
  if (!contract) return result;
  try {
    if (typeof contract.treasuryBalance === 'function') {
      const value = await contract.treasuryBalance();
      result.treasuryBalance = value?.toString?.() ?? String(value);
    }
  } catch (err) {
    logger?.warn?.({ err: String(err?.message || err) }, 'Failed to read treasury balance');
  }
  try {
    if (typeof contract.memberPoolBalance === 'function') {
      const value = await contract.memberPoolBalance();
      result.memberPoolBalance = value?.toString?.() ?? String(value);
    }
  } catch (err) {
    logger?.warn?.({ err: String(err?.message || err) }, 'Failed to read member pool balance');
  }
  return result;
}

function createContractWatcher({ connectContract, templs, persist, notifier, logger }) {
  if (!connectContract) {
    return { watchContract: () => {} };
  }
  const listenerRegistry = new Map();
  const watchContract = (contractAddress, record) => {
    if (!contractAddress || !record) return;
    const key = String(contractAddress).toLowerCase();
    if (listenerRegistry.has(key)) {
      const existing = listenerRegistry.get(key);
      const priorMeta = existing?.record?.proposalsMeta;
      const previousRecord = existing?.record;
      existing.record = record;
      record.contract = existing.contract;
      record.contractAddress = key;
      if (priorMeta && (!record.proposalsMeta || typeof record.proposalsMeta.set !== 'function')) {
        record.proposalsMeta = priorMeta;
      }
      if (previousRecord && (record.templHomeLink == null || record.templHomeLink === '')) {
        record.templHomeLink = previousRecord.templHomeLink || '';
      }
      if (previousRecord && record.bindingCode == null) {
        record.bindingCode = previousRecord.bindingCode || null;
      }
      if (previousRecord && typeof previousRecord.lastDigestAt === 'number') {
        record.lastDigestAt = previousRecord.lastDigestAt;
      } else if (typeof record.lastDigestAt !== 'number') {
        record.lastDigestAt = Date.now();
      }
      return;
    }
    let contract;
    try {
      contract = connectContract(contractAddress);
    } catch (err) {
      logger?.warn?.({ err: String(err?.message || err), contract: contractAddress }, 'Failed to connect contract listeners');
      return;
    }
    if (!contract || typeof contract.on !== 'function') {
      return;
    }

    record.contract = contract;
    record.contractAddress = key;
    if (!record.proposalsMeta || typeof record.proposalsMeta.set !== 'function') {
      record.proposalsMeta = new Map();
    }
    if (typeof record.templHomeLink !== 'string') {
      record.templHomeLink = '';
    }

    if (typeof contract.templHomeLink === 'function') {
      contract.templHomeLink().then((link) => {
        const current = record.templHomeLink ?? '';
        if (typeof link === 'string' && link !== current) {
          record.templHomeLink = link;
          templs.set(key, record);
          persist?.(key, record);
        }
      }).catch((err) => {
        logger?.debug?.({ err: String(err?.message || err), contract: key }, 'Failed to read templ home link');
      });
    }

    const wrapListener = (label, fn) => (...args) => {
      try {
        const maybe = fn(...args);
        if (maybe && typeof maybe.then === 'function') {
          maybe.catch((err) => {
            logger?.warn?.({ err: String(err?.message || err), contract: key }, label);
          });
        }
      } catch (err) {
        logger?.warn?.({ err: String(err?.message || err), contract: key }, label);
      }
    };

    const handleAccessPurchased = wrapListener('Contract listener error', async (purchaser, totalAmount, burnedAmount, treasuryAmount, memberPoolAmount, protocolAmount, timestamp, blockNumber, purchaseId) => {
      if (!record.telegramChatId || !notifier?.notifyAccessPurchased) return;
      const balances = await fetchBalances(record, logger);
      await notifier.notifyAccessPurchased({
        chatId: record.telegramChatId,
        contractAddress: key,
        memberAddress: purchaser,
        purchaseId: purchaseId != null ? purchaseId.toString?.() ?? String(purchaseId) : null,
        timestamp: timestamp?.toString?.() ?? timestamp,
        treasuryBalance: balances.treasuryBalance,
        memberPoolBalance: balances.memberPoolBalance,
        homeLink: record.templHomeLink || ''
      });
    });

    const handleProposal = wrapListener('Contract listener error', async (proposalId, proposer, endTime, title, description) => {
      try {
        const proposalKey = toProposalKey(proposalId);
        const meta = ensureProposalMeta(record, proposalKey);
        if (meta) {
          meta.title = title ?? '';
          meta.description = description ?? '';
          meta.proposer = proposer ? String(proposer).toLowerCase() : meta.proposer;
          const parsedEnd = toNumber(endTime);
          if (parsedEnd) meta.endTime = parsedEnd;
          await maybeNotifyQuorum({ record, contractAddress: key, proposalId, meta, notifier, logger });
        }
      } catch {/* ignore cache errors */}
      if (!record.telegramChatId || !notifier?.notifyProposalCreated) return;
      await notifier.notifyProposalCreated({
        chatId: record.telegramChatId,
        contractAddress: key,
        proposer,
        proposalId: proposalId?.toString?.() ?? String(proposalId),
        endTime: endTime?.toString?.() ?? endTime,
        title: title ?? '',
        description: description ?? '',
        homeLink: record.templHomeLink || ''
      });
    });

    const handleVote = wrapListener('Contract listener error', async (proposalId, voter, support, timestamp) => {
      if (!record.telegramChatId || !notifier?.notifyVoteCast) return;
      const idKey = toProposalKey(proposalId);
      const meta = ensureProposalMeta(record, idKey);
      let proposalTitle = '';
      if (meta?.title) proposalTitle = meta.title;
      try {
        const contractInstance = record.contract;
        if (contractInstance && typeof contractInstance.getProposal === 'function') {
          const details = await contractInstance.getProposal(proposalId);
          updateMetaFromDetails(meta, details);
          if (!proposalTitle) proposalTitle = meta?.title ?? '';
        }
      } catch (err) {
        logger?.warn?.({ err: String(err?.message || err), contract: key }, 'Failed to load proposal metadata for vote notification');
      }
      await notifier.notifyVoteCast({
        chatId: record.telegramChatId,
        contractAddress: key,
        voter,
        proposalId: proposalId?.toString?.() ?? String(proposalId),
        support,
        title: proposalTitle,
        timestamp: timestamp?.toString?.() ?? timestamp,
        homeLink: record.templHomeLink || ''
      });
      if (meta) {
        await maybeNotifyQuorum({ record, contractAddress: key, proposalId, meta, notifier, logger });
      }
    });

    const handlePriestChanged = wrapListener('Contract listener error', async (oldPriest, newPriest) => {
      const oldKey = String(oldPriest || '').toLowerCase();
      const nextKey = String(newPriest || '').toLowerCase();
      record.priest = nextKey;
      templs.set(key, record);
      persist(key, record);
      logger?.info?.({ contract: key, oldPriest: oldKey, newPriest: nextKey }, 'Priest updated from contract event');

      if (!record.telegramChatId || !notifier?.notifyPriestChanged) return;
      await notifier.notifyPriestChanged({
        chatId: record.telegramChatId,
        contractAddress: key,
        oldPriest,
        newPriest,
        homeLink: record.templHomeLink || ''
      });
    });

    const handleProposalExecuted = wrapListener('Contract listener error', async (proposalId) => {
      const proposalKey = toProposalKey(proposalId);
      const meta = ensureProposalMeta(record, proposalKey);
      if (meta) {
        meta.executed = true;
        meta.passed = false;
      }
    });

    const handleTemplHomeLinkUpdated = wrapListener('Contract listener error', async (previousLink, newLink) => {
      const nextLink = newLink ?? '';
      record.templHomeLink = nextLink;
      templs.set(key, record);
      persist(key, record);
      if (record.telegramChatId && notifier?.notifyTemplHomeLinkUpdated) {
        await notifier.notifyTemplHomeLinkUpdated({
          chatId: record.telegramChatId,
          contractAddress: key,
          previousLink: previousLink ?? '',
          newLink: nextLink
        });
      }
    });

    contract.on('AccessPurchased', handleAccessPurchased);
    contract.on('ProposalCreated', handleProposal);
    contract.on('VoteCast', handleVote);
    contract.on('PriestChanged', handlePriestChanged);
    contract.on('ProposalExecuted', handleProposalExecuted);
    contract.on('TemplHomeLinkUpdated', handleTemplHomeLinkUpdated);

    listenerRegistry.set(key, {
      contract,
      record,
      handlers: {
        handleAccessPurchased,
        handleProposal,
        handleVote,
        handlePriestChanged,
        handleProposalExecuted,
        handleTemplHomeLinkUpdated
      }
    });
  };

  return { watchContract };
}

async function restoreGroupsFromPersistence({ database, templs, watchContract, logger, loadBindings }) {
  try {
    const rows = database.prepare('SELECT contract, groupId, priest, homeLink FROM groups').all();
    for (const row of rows) {
      const key = String(row?.contract || '').toLowerCase();
      if (!key) continue;
      const record = {
        telegramChatId: row?.groupId || null,
        priest: row?.priest ? String(row.priest).toLowerCase() : null,
        proposalsMeta: new Map(),
        lastDigestAt: Date.now(),
        contractAddress: key,
        templHomeLink: row?.homeLink || '',
        bindingCode: null
      };
      templs.set(key, record);
      if (watchContract) {
        watchContract(row.contract || key, record);
      }
    }
    if (typeof loadBindings === 'function') {
      const pending = loadBindings() || [];
      for (const row of pending) {
        const key = String(row?.contract || '').toLowerCase();
        if (!key) continue;
        if (!templs.has(key)) {
          templs.set(key, {
            telegramChatId: null,
            priest: null,
            proposalsMeta: new Map(),
            lastDigestAt: Date.now(),
            contractAddress: key,
            templHomeLink: '',
            bindingCode: String(row.bindCode || '') || null
          });
          if (watchContract) {
            watchContract(key, templs.get(key));
          }
        } else {
          const record = templs.get(key);
          record.bindingCode = row?.bindCode || null;
        }
      }
    }
  } catch (err) {
    logger?.warn?.({ err: String(err?.message || err) }, 'Failed to restore templs from persistence');
  }
}

function createBackgroundTasks({ templs, notifier, logger, persist, removeBinding }) {
  async function checkProposals() {
    const nowSeconds = Math.floor(Date.now() / 1000);
    for (const [contractAddress, record] of templs.entries()) {
      if (!record?.telegramChatId || !record?.contract || !record?.proposalsMeta) continue;
      if (typeof notifier?.notifyProposalVotingClosed !== 'function') continue;
      for (const [proposalKey, meta] of record.proposalsMeta.entries()) {
        if (!meta || meta.votingClosedNotified || meta.executed) continue;
        const endTime = Number(meta.endTime || 0);
        if (!endTime || nowSeconds < endTime) continue;
        try {
          if (typeof record.contract.getProposal === 'function') {
            const details = await record.contract.getProposal(proposalKey);
            updateMetaFromDetails(meta, details);
          }
          const canExecute = !meta.executed && Boolean(meta.passed);
          await notifier.notifyProposalVotingClosed({
            chatId: record.telegramChatId,
            contractAddress,
            proposalId: proposalKey,
            title: meta.title,
            description: meta.description,
            endedAt: endTime,
            canExecute,
            homeLink: record.templHomeLink || ''
          });
          meta.votingClosedNotified = true;
        } catch (err) {
          logger?.warn?.({ err: String(err?.message || err), contract: contractAddress, proposalId: proposalKey }, 'Failed to send voting-closed notification');
        }
      }
    }
  }

  async function sendDailyDigests() {
    const now = Date.now();
    for (const [contractAddress, record] of templs.entries()) {
      if (!record?.telegramChatId || !record?.contract) continue;
      if (typeof notifier?.notifyDailyDigest !== 'function') continue;
      const lastAt = record.lastDigestAt ?? 0;
      if (now - lastAt < DAILY_DIGEST_PERIOD_MS) continue;
      try {
        const balances = await fetchBalances(record, logger);
        await notifier.notifyDailyDigest({
          chatId: record.telegramChatId,
          contractAddress,
          treasuryBalance: balances.treasuryBalance,
          memberPoolBalance: balances.memberPoolBalance,
          homeLink: record.templHomeLink || ''
        });
        record.lastDigestAt = now;
      } catch (err) {
        logger?.warn?.({ err: String(err?.message || err), contract: contractAddress }, 'Failed to send daily digest');
        record.lastDigestAt = now;
      }
    }
  }

  let bindingOffset = 0;
  let bindingPollInFlight = false;

  async function pollBindings() {
    if (bindingPollInFlight) return;
    if (!notifier?.fetchUpdates) return;
    const hasPending = (() => {
      for (const [, record] of templs.entries()) {
        if (record?.bindingCode) return true;
      }
      return false;
    })();
    if (!hasPending) return;
    bindingPollInFlight = true;
    try {
      const { updates = [], nextOffset } = (await notifier.fetchUpdates({ offset: bindingOffset })) ?? {};
      if (typeof nextOffset === 'number' && nextOffset > bindingOffset) {
        bindingOffset = nextOffset;
      }
      for (const update of updates) {
        const updateId = update?.update_id;
        if (typeof updateId === 'number' && updateId + 1 > bindingOffset) {
          bindingOffset = updateId + 1;
        }
        const message = update?.message || update?.channel_post;
        if (!message) continue;
        const fromBot = Boolean(message.from?.is_bot);
        if (fromBot) continue;
        const chatId = message.chat?.id;
        if (chatId === undefined || chatId === null) continue;
        const text = typeof message.text === 'string' ? message.text.trim() : '';
        if (!text) continue;
        for (const [contractAddress, record] of templs.entries()) {
          const code = record?.bindingCode;
          if (!code) continue;
          if (text.includes(code)) {
            record.telegramChatId = String(chatId);
            record.bindingCode = null;
            templs.set(contractAddress, record);
            persist?.(contractAddress, record);
            removeBinding?.(contractAddress);
            if (notifier?.notifyBindingComplete) {
              await notifier.notifyBindingComplete({
                chatId: String(chatId),
                contractAddress,
                homeLink: record.templHomeLink || ''
              });
            }
          }
        }
      }
    } catch (err) {
      logger?.warn?.({ err: String(err?.message || err) }, 'Failed polling telegram updates');
    } finally {
      bindingPollInFlight = false;
    }
  }

  const proposalInterval = setInterval(() => {
    void checkProposals();
  }, PROPOSAL_CHECK_INTERVAL_MS);

  const digestInterval = setInterval(() => {
    void sendDailyDigests();
  }, DAILY_DIGEST_CHECK_INTERVAL_MS);

  const bindingInterval = setInterval(() => {
    void pollBindings();
  }, 5_000);

  void pollBindings();

  return {
    stop() {
      clearInterval(proposalInterval);
      clearInterval(digestInterval);
      clearInterval(bindingInterval);
    }
  };
}

export function createApp(opts) {
  const {
    hasPurchased,
    connectContract: providedConnectContract,
    dbPath,
    db,
    rateLimitStore,
    provider,
    telegram,
    enableBackgroundTasks = process.env.NODE_ENV !== 'test'
  } = opts || {};
  const notifier = telegram?.notifier ?? createTelegramNotifier({
    botToken: telegram?.botToken ?? process.env.TELEGRAM_BOT_TOKEN,
    linkBaseUrl: telegram?.linkBaseUrl ?? process.env.APP_BASE_URL,
    logger: telegram?.logger ?? logger
  });
  const connectContract = providedConnectContract ?? (provider ? (address) => new ethers.Contract(address, TEMPL_EVENT_ABI, provider) : null);
  const app = express();
  app.use(cors({ origin: buildAllowedOrigins() }));
  app.use(express.json());
  app.use(helmet());
  const store = rateLimitStore ?? new MemoryStore();
  if (process.env.NODE_ENV !== 'test') {
    const limiter = rateLimit({ windowMs: 60_000, max: 100, store });
    app.use(limiter);
  }

  const templs = new Map();
  app.locals.templs = templs;
  const { database, persist, saveBinding, removeBinding, loadBindings, close: closeDatabase } = initializeDatabase({ dbPath, db });

  const { watchContract } = createContractWatcher({ connectContract, templs, persist, notifier, logger });

  void restoreGroupsFromPersistence({ database, templs, watchContract, logger, loadBindings });

  let backgroundTasks = null;
  if (enableBackgroundTasks) {
    backgroundTasks = createBackgroundTasks({ templs, notifier, logger, persist, removeBinding });
  }

  const context = {
    hasPurchased,
    database,
    templs,
    persist,
    saveBinding,
    removeBinding,
    provider,
    watchContract,
    notifier
  };

  app.use(templsRouter(context));
  app.use(joinRouter(context));

  app.close = async () => {
    await store.shutdown?.();
    closeDatabase();
    backgroundTasks?.stop?.();
  };

  app.locals.backgroundTasks = backgroundTasks;

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  dotenv.config();
  const { RPC_URL } = process.env;
  if (!RPC_URL) {
    throw new Error('Missing RPC_URL environment variable');
  }
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const dbPathEnv = process.env.DB_PATH;
  const defaultDbPath = new URL('../groups.db', import.meta.url).pathname;
  const dbPath = dbPathEnv || defaultDbPath;
  if (dbPath && process.env.CLEAR_DB === '1') {
    try { fs.rmSync(dbPath, { force: true }); } catch (e) { logger.warn({ err: e?.message || e }); }
  }

  const hasPurchased = async (contractAddress, memberAddress) => {
    const contract = new ethers.Contract(
      contractAddress,
      ['function hasAccess(address) view returns (bool)'],
      provider
    );
    return contract.hasAccess(memberAddress);
  };

  const rateLimitStore = await createRateLimitStore();
  const notifier = createTelegramNotifier({
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    linkBaseUrl: process.env.APP_BASE_URL,
    logger
  });
  const app = createApp({ hasPurchased, dbPath, rateLimitStore, provider, telegram: { notifier } });
  const port = process.env.PORT || 3001;
  app.listen(port, () => {
    logger.info({ port }, 'TEMPL backend listening');
  });
}
