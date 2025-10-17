// @ts-check
import { setDefaultResultOrder } from 'dns';
import express from 'express';
import dotenv from 'dotenv';
import { ethers } from 'ethers';
import helmet from 'helmet';
import rateLimit, { MemoryStore } from 'express-rate-limit';
import { createRateLimitStore } from './config.js';
import cors from 'cors';
import { randomUUID } from 'crypto';

try {
  // Force IPv4 lookups first; XMTP endpoints only publish A records.
  setDefaultResultOrder('ipv4first');
} catch {
  /* ignore environments that do not support tweaking DNS result order */
}

import templsRouter from './routes/templs.js';
import joinRouter from './routes/join.js';
import miniappRouter from './routes/miniapp.js';

import { logger } from './logger.js';
import { createTelegramNotifier } from './telegram.js';
import { createSignatureStore } from './middleware/validate.js';
import { ensureTemplFromFactory } from './services/contractValidation.js';
import { createFactoryIndexer } from './services/factoryIndexer.js';
import { registerTempl } from './services/registerTempl.js';

import { createPersistence } from './persistence/index.js';

/**
 * @typedef {{
 *   bind(...values: Array<string | number | null | undefined>): D1Statement;
 *   first<T = any>(): Promise<T | null>;
 *   run(): Promise<{ success?: boolean | undefined, meta?: { changes?: number | null | undefined } | undefined }>;
 *   all<T = any>(): Promise<{ results: Array<T> }>;
 * }} D1Statement
 */

/**
 * @typedef {{
 *   prepare(statement: string): D1Statement;
 *   exec(statement: string): Promise<unknown>;
 * }} D1Database
 */

const TEMPL_EVENT_ABI = [
  'event MemberJoined(address indexed payer,address indexed member,uint256 totalAmount,uint256 burnedAmount,uint256 treasuryAmount,uint256 memberPoolAmount,uint256 protocolAmount,uint256 timestamp,uint256 blockNumber,uint256 joinId)',
  'event ProposalCreated(uint256 indexed proposalId,address indexed proposer,uint256 endTime,string title,string description)',
  'event VoteCast(uint256 indexed proposalId,address indexed voter,bool support,uint256 timestamp)',
  'event PriestChanged(address indexed oldPriest,address indexed newPriest)',
  'event ProposalExecuted(uint256 indexed proposalId,bool success,bytes returnData)',
  'event TemplHomeLinkUpdated(string previousLink,string newLink)',
  'event MemberRewardsClaimed(address indexed member,uint256 amount,uint256 timestamp)',
  'event ExternalRewardClaimed(address indexed token,address indexed member,uint256 amount)',
  'event JoinPauseUpdated(bool joinPaused)',
  'event ConfigUpdated(address indexed token,uint256 entryFee,uint256 burnPercent,uint256 treasuryPercent,uint256 memberPoolPercent,uint256 protocolPercent)',
  'event TreasuryAction(uint256 indexed proposalId,address indexed token,address indexed recipient,uint256 amount,string description)',
  'event TreasuryDisbanded(uint256 indexed proposalId,address indexed token,uint256 amount,uint256 perMember,uint256 remainder)',
  'event DictatorshipModeChanged(bool enabled)',
  'event MaxMembersUpdated(uint256 maxMembers)',
  'function priest() view returns (address)',
  'function getActiveProposals() view returns (uint256[])',
  'function treasuryBalance() view returns (uint256)',
  'function memberPoolBalance() view returns (uint256)',
  'function templHomeLink() view returns (string)',
  'function getProposal(uint256 proposalId) view returns (address proposer,uint256 yesVotes,uint256 noVotes,uint256 endTime,bool executed,bool passed,string title,string description)',
  'function getProposalSnapshots(uint256 proposalId) view returns (uint256,uint256,uint256,uint256,uint256,uint256)'
];

const PROPOSAL_CHECK_INTERVAL_MS = 60_000;
const DAILY_DIGEST_CHECK_INTERVAL_MS = 60_000;
const DAILY_DIGEST_PERIOD_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LEADER_TTL_MS = 60_000;

export { logger };

function buildAllowedOrigins() {
  const env = process.env.ALLOWED_ORIGINS;
  if (!env) return ['http://localhost:5173'];
  return env
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}

function resolveTrustProxySetting() {
  const raw = process.env.TRUST_PROXY;
  if (raw === undefined) {
    return process.env.NODE_ENV === 'production' ? 'loopback' : false;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return process.env.NODE_ENV === 'production' ? 'loopback' : false;
  }
  const lower = trimmed.toLowerCase();
  if (lower === 'false' || lower === '0') {
    return false;
  }
  if (lower === 'true') {
    return true;
  }
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) {
    return numeric;
  }
  return trimmed;
}

function mapMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') return undefined;
  try {
    if (typeof metadata.getMap === 'function') {
      return metadata.getMap();
    }
  } catch {
    /* ignore */
  }
  try {
    if (metadata instanceof Map) {
      return Object.fromEntries(metadata.entries());
    }
  } catch {
    /* ignore */
  }
  try {
    if (metadata.internalRepr instanceof Map) {
      return Object.fromEntries(metadata.internalRepr.entries());
    }
  } catch {
    /* ignore */
  }
  const plain = {};
  let hasValue = false;
  for (const key of Object.keys(metadata)) {
    const value = metadata[key];
    if (typeof value === 'function') continue;
    plain[key] = value;
    hasValue = true;
  }
  return hasValue ? plain : undefined;
}

function describeError(err) {
  if (!err || typeof err !== 'object') {
    return { message: String(err) };
  }
  const plain = {};
  const copy = (key) => {
    if (err[key] !== undefined) {
      plain[key] = err[key];
    }
  };
  copy('name');
  copy('message');
  copy('code');
  copy('status');
  copy('details');
  if (err.stack) {
    plain.stack = err.stack;
  }
  if (err.cause && err.cause !== err) {
    plain.cause = describeError(err.cause);
  }
  const metadata = mapMetadata(err.metadata);
  if (metadata) {
    plain.metadata = metadata;
  }
  const debugInformation = err.debugInformation;
  if (debugInformation && typeof debugInformation === 'object') {
    const debug = {};
    const capture = (label, fn) => {
      if (typeof fn !== 'function') return;
      try {
        const value = fn.call(debugInformation);
        if (value) {
          debug[label] = value;
        }
      } catch (e) {
        debug[`${label}Error`] = e?.message || String(e);
      }
    };
    capture('apiStats', debugInformation.apiAggregateStatistics);
    capture('identityStats', debugInformation.identityAggregateStatistics);
    capture('streamStats', debugInformation.streamAggregateStatistics);
    if (Object.keys(debug).length > 0) {
      plain.debug = debug;
    }
  }
  const extraKeys = Object.getOwnPropertyNames(err).filter(
    (key) => !['name', 'message', 'code', 'status', 'details', 'stack', 'metadata', 'debugInformation', 'cause'].includes(key)
  );
  for (const key of extraKeys) {
    const value = err[key];
    if (value === undefined || typeof value === 'function') continue;
    if (plain[key] === undefined) {
      plain[key] = value;
    }
  }
  return plain;
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

/**
 * @param {{
 *   persistence?: {
 *     persistBinding?: Function,
 *     listBindings?: Function,
 *     findBinding?: Function,
 *     signatureStore?: { consume?: Function, prune?: Function },
 *     dispose?: Function
 *   } | null,
 *   retentionMs?: number
 * }} [opts]
 */
/**
 * @param {{
 *   persistence?: import('./persistence/index.js').PersistenceAdapter,
 *   retentionMs?: number,
 *   sqlitePath?: string
 * }} [opts]
 * @returns {Promise<import('./persistence/index.js').PersistenceAdapter>}
 */
async function initializePersistence(opts = {}) {
  const { persistence, retentionMs, sqlitePath } = opts;
  if (persistence) {
    return persistence;
  }
  return createPersistence({ retentionMs, sqlitePath });
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

  const toStringSafe = (value) => {
    if (value === null || value === undefined) return null;
    try {
      return value?.toString?.() ?? String(value);
    } catch {
      return String(value);
    }
  };

  try {
    if (typeof contract.getTreasuryInfo === 'function') {
      const info = await contract.getTreasuryInfo();
      const treasuryValue = info?.treasury ?? info?.[0];
      const memberValue = info?.memberPool ?? info?.[1];
      if (treasuryValue !== undefined && treasuryValue !== null) {
        result.treasuryBalance = toStringSafe(treasuryValue);
      }
      if (memberValue !== undefined && memberValue !== null) {
        result.memberPoolBalance = toStringSafe(memberValue);
      }
    }
  } catch (err) {
    logger?.warn?.({ err: String(err?.message || err) }, 'Failed to read treasury info');
  }

  if (result.treasuryBalance === null) {
    try {
      if (typeof contract.treasuryBalance === 'function') {
        const value = await contract.treasuryBalance();
        result.treasuryBalance = toStringSafe(value);
      }
    } catch (err) {
      logger?.warn?.({ err: String(err?.message || err) }, 'Failed to read treasury balance');
    }
  }

  if (result.memberPoolBalance === null) {
    try {
      if (typeof contract.memberPoolBalance === 'function') {
        const value = await contract.memberPoolBalance();
        result.memberPoolBalance = toStringSafe(value);
      }
    } catch (err) {
      logger?.warn?.({ err: String(err?.message || err) }, 'Failed to read member pool balance');
    }
  }

  return result;
}

function createContractWatcher({ connectContract, templs, persist, notifier, logger }) {
  if (!connectContract) {
    return {
      watchContract: () => {},
      pauseWatching: () => {},
      resumeWatching: async () => {}
    };
  }
  const listenerRegistry = new Map();
  const trackedRecords = new Map();

  const backfillActiveProposals = async ({ contract, record, contractAddress }) => {
    if (!record) return;
    if (!record.proposalsMeta || typeof record.proposalsMeta.set !== 'function') {
      record.proposalsMeta = new Map();
    }
    if (!contract || typeof contract.getActiveProposals !== 'function') return;
    let activeIds;
    try {
      activeIds = await contract.getActiveProposals();
    } catch (err) {
      logger?.warn?.({ err: String(err?.message || err), contract: contractAddress }, 'Failed to load active proposals during backfill');
      return;
    }
    const nowSeconds = Math.floor(Date.now() / 1000);
    const activeKeys = new Set();
    for (const proposalId of Array.isArray(activeIds) ? activeIds : []) {
      const proposalKey = toProposalKey(proposalId);
      if (!proposalKey) continue;
      activeKeys.add(proposalKey);
      const meta = ensureProposalMeta(record, proposalKey);
      if (!meta) continue;
      meta.quorumReachedAt = 0;
      meta.quorumNotified = false;
      meta.votingClosedNotified = false;
      meta.executed = false;
      meta.passed = false;
      if (typeof contract.getProposal === 'function') {
        try {
          const details = await contract.getProposal(proposalId);
          updateMetaFromDetails(meta, details);
        } catch (err) {
          logger?.warn?.({ err: String(err?.message || err), contract: contractAddress, proposalId: proposalKey }, 'Failed to load proposal details during backfill');
        }
      }
      if (typeof contract.getProposalSnapshots === 'function') {
        try {
          const snapshots = await contract.getProposalSnapshots(proposalId);
          updateMetaFromSnapshots(meta, snapshots);
        } catch (err) {
          logger?.warn?.({ err: String(err?.message || err), contract: contractAddress, proposalId: proposalKey }, 'Failed to load proposal snapshots during backfill');
        }
      }
      if (meta.quorumReachedAt) {
        meta.quorumNotified = true;
      }
      if (meta.executed || (meta.endTime && nowSeconds >= meta.endTime)) {
        meta.votingClosedNotified = true;
      }
    }
    for (const [proposalKey, meta] of record.proposalsMeta.entries()) {
      if (!activeKeys.has(proposalKey) && meta) {
        if (!meta.votingClosedNotified) {
          meta.votingClosedNotified = true;
        }
        if (meta.quorumReachedAt && !meta.quorumNotified) {
          meta.quorumNotified = true;
        }
      }
    }
  };

  const detachListeners = (key) => {
    const existing = listenerRegistry.get(key);
    if (!existing) return;
    const { contract, handlers } = existing;
    try { contract.off('MemberJoined', handlers.handleMemberJoined); } catch (err) { void err; }
    try { contract.off('ProposalCreated', handlers.handleProposal); } catch (err) { void err; }
    try { contract.off('VoteCast', handlers.handleVote); } catch (err) { void err; }
    try { contract.off('PriestChanged', handlers.handlePriestChanged); } catch (err) { void err; }
    try { contract.off('ProposalExecuted', handlers.handleProposalExecuted); } catch (err) { void err; }
    try { contract.off('TemplHomeLinkUpdated', handlers.handleTemplHomeLinkUpdated); } catch (err) { void err; }
    try { contract.off('MemberRewardsClaimed', handlers.handleMemberRewardsClaimed); } catch (err) { void err; }
    try { contract.off('ExternalRewardClaimed', handlers.handleExternalRewardClaimed); } catch (err) { void err; }
    try { contract.off('JoinPauseUpdated', handlers.handleJoinPauseUpdated); } catch (err) { void err; }
    try { contract.off('ConfigUpdated', handlers.handleConfigUpdated); } catch (err) { void err; }
    try { contract.off('TreasuryAction', handlers.handleTreasuryAction); } catch (err) { void err; }
    try { contract.off('TreasuryDisbanded', handlers.handleTreasuryDisbanded); } catch (err) { void err; }
    try { contract.off('DictatorshipModeChanged', handlers.handleDictatorshipModeChanged); } catch (err) { void err; }
    try { contract.off('MaxMembersUpdated', handlers.handleMaxMembersUpdated); } catch (err) { void err; }
    listenerRegistry.delete(key);
  };

  const attachListeners = async (contractAddress, record) => {
    if (!contractAddress || !record) return;
    const key = String(contractAddress).toLowerCase();
    const previous = listenerRegistry.get(key);
    const priorMeta = previous?.record?.proposalsMeta;
    const previousRecord = previous?.record;
    detachListeners(key);

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
    if (priorMeta && (!record.proposalsMeta || typeof record.proposalsMeta.set !== 'function')) {
      record.proposalsMeta = priorMeta;
    } else if (!record.proposalsMeta || typeof record.proposalsMeta.set !== 'function') {
      record.proposalsMeta = new Map();
    }
    if (previousRecord && (record.templHomeLink == null || record.templHomeLink === '')) {
      record.templHomeLink = previousRecord.templHomeLink || '';
    }
    if (previousRecord && record.bindingCode == null) {
      record.bindingCode = previousRecord.bindingCode || null;
    }
    if (previousRecord && typeof previousRecord.lastDigestAt === 'number') {
      record.lastDigestAt = previousRecord.lastDigestAt;
    } else if (
      typeof record.lastDigestAt !== 'number' ||
      !Number.isFinite(record.lastDigestAt) ||
      record.lastDigestAt < 0
    ) {
      record.lastDigestAt = 0;
    }
    if (typeof record.templHomeLink !== 'string') {
      record.templHomeLink = '';
    }

    if (typeof contract.templHomeLink === 'function') {
      contract
        .templHomeLink()
        .then(async (link) => {
          const current = record.templHomeLink ?? '';
          if (typeof link === 'string' && link !== current) {
            record.templHomeLink = link;
            templs.set(key, record);
            await persist?.(key, record);
          }
        })
        .catch((err) => {
          logger?.debug?.({ err: String(err?.message || err), contract: key }, 'Failed to read templ home link');
        });
    }

    if (!record.priest && typeof contract.priest === 'function') {
      contract
        .priest()
        .then(async (addr) => {
          const nextPriest = addr ? String(addr).toLowerCase() : null;
          if (nextPriest && record.priest !== nextPriest) {
            record.priest = nextPriest;
            templs.set(key, record);
            await persist?.(key, record);
          }
        })
        .catch((err) => {
          logger?.debug?.({ err: String(err?.message || err), contract: key }, 'Failed to read templ priest');
        });
    }

    const wrapListener = (label, fn) => async (...args) => {
      try {
        await fn(...args);
      } catch (err) {
        logger?.warn?.({ err: String(err?.message || err), contract: key }, label);
      }
    };

    const handleMemberJoined = wrapListener('Contract listener error', async (payer, member, totalAmount, burnedAmount, treasuryAmount, memberPoolAmount, protocolAmount, timestamp, blockNumber, joinId) => {
      if (!record.telegramChatId || !notifier?.notifyMemberJoined) return;
      const balances = await fetchBalances(record, logger);
      await notifier.notifyMemberJoined({
        chatId: record.telegramChatId,
        contractAddress: key,
        payerAddress: payer,
        memberAddress: member,
        joinId: joinId != null ? joinId.toString?.() ?? String(joinId) : null,
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
      await persist(key, record);
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

    const handleProposalExecuted = wrapListener('Contract listener error', async (proposalId, success, returnData) => {
      const proposalKey = toProposalKey(proposalId);
      const meta = ensureProposalMeta(record, proposalKey);
      if (meta) {
        meta.executed = true;
        meta.passed = Boolean(success);
      }
      if (record.telegramChatId && notifier?.notifyProposalExecuted) {
        await notifier.notifyProposalExecuted({
          chatId: record.telegramChatId,
          contractAddress: key,
          proposalId: proposalId?.toString?.() ?? String(proposalId),
          success: Boolean(success),
          returnData: returnData?.toString?.() ?? returnData,
          title: meta?.title ?? '',
          description: meta?.description ?? '',
          homeLink: record.templHomeLink || ''
        });
      }
    });

    const handleTemplHomeLinkUpdated = wrapListener('Contract listener error', async (previousLink, newLink) => {
      const nextLink = newLink ?? '';
      record.templHomeLink = nextLink;
      templs.set(key, record);
      await persist(key, record);
      if (record.telegramChatId && notifier?.notifyTemplHomeLinkUpdated) {
        await notifier.notifyTemplHomeLinkUpdated({
          chatId: record.telegramChatId,
          contractAddress: key,
          previousLink: previousLink ?? '',
          newLink: nextLink
        });
      }
    });

    const handleMemberRewardsClaimed = wrapListener('Contract listener error', async (member, amount, timestamp) => {
      if (!record.telegramChatId || !notifier?.notifyMemberRewardsClaimed) return;
      await notifier.notifyMemberRewardsClaimed({
        chatId: record.telegramChatId,
        contractAddress: key,
        member,
        amount: amount?.toString?.() ?? amount,
        timestamp: timestamp?.toString?.() ?? timestamp,
        homeLink: record.templHomeLink || ''
      });
    });

    const handleExternalRewardClaimed = wrapListener('Contract listener error', async (token, member, amount) => {
      if (!record.telegramChatId || !notifier?.notifyExternalRewardClaimed) return;
      await notifier.notifyExternalRewardClaimed({
        chatId: record.telegramChatId,
        contractAddress: key,
        token,
        member,
        amount: amount?.toString?.() ?? amount,
        homeLink: record.templHomeLink || ''
      });
    });

    const handleJoinPauseUpdated = wrapListener('Contract listener error', async (joinPaused) => {
      record.joinPaused = Boolean(joinPaused);
      templs.set(key, record);
      await persist?.(key, record);
      if (!record.telegramChatId || !notifier?.notifyJoinPauseUpdated) return;
      await notifier.notifyJoinPauseUpdated({
        chatId: record.telegramChatId,
        contractAddress: key,
        paused: Boolean(joinPaused),
        homeLink: record.templHomeLink || ''
      });
    });

    const handleConfigUpdated = wrapListener('Contract listener error', async (
      token,
      entryFee,
      burnPercentValue,
      treasuryPercentValue,
      memberPoolPercentValue,
      protocolPercentValue
    ) => {
      record.config = {
        token: token ?? record.config?.token ?? '',
        entryFee: entryFee?.toString?.() ?? entryFee,
        burnPercent: burnPercentValue,
        treasuryPercent: treasuryPercentValue,
        memberPoolPercent: memberPoolPercentValue,
        protocolPercent: protocolPercentValue
      };
      templs.set(key, record);
      await persist?.(key, record);
      if (!record.telegramChatId || !notifier?.notifyConfigUpdated) return;
      await notifier.notifyConfigUpdated({
        chatId: record.telegramChatId,
        contractAddress: key,
        token,
        entryFee: entryFee?.toString?.() ?? entryFee,
        burnPercent: burnPercentValue,
        treasuryPercent: treasuryPercentValue,
        memberPoolPercent: memberPoolPercentValue,
        protocolPercent: protocolPercentValue,
        homeLink: record.templHomeLink || ''
      });
    });

    const handleTreasuryAction = wrapListener('Contract listener error', async (proposalId, token, recipient, amount, description) => {
      if (!record.telegramChatId || !notifier?.notifyTreasuryAction) return;
      await notifier.notifyTreasuryAction({
        chatId: record.telegramChatId,
        contractAddress: key,
        proposalId: proposalId?.toString?.() ?? proposalId,
        token,
        recipient,
        amount: amount?.toString?.() ?? amount,
        description,
        homeLink: record.templHomeLink || ''
      });
    });

    const handleTreasuryDisbanded = wrapListener(
      'Contract listener error',
      async (proposalId, token, amount, perMember, remainder) => {
        if (!record.telegramChatId || !notifier?.notifyTreasuryDisbanded) return;
        await notifier.notifyTreasuryDisbanded({
          chatId: record.telegramChatId,
          contractAddress: key,
          proposalId: proposalId?.toString?.() ?? proposalId,
          token,
          amount: amount?.toString?.() ?? amount,
          perMember: perMember?.toString?.() ?? perMember,
          remainder: remainder?.toString?.() ?? remainder,
          homeLink: record.templHomeLink || ''
        });
      }
    );

    const handleDictatorshipModeChanged = wrapListener('Contract listener error', async (enabled) => {
      record.dictatorshipEnabled = Boolean(enabled);
      templs.set(key, record);
      await persist?.(key, record);
      if (!record.telegramChatId || !notifier?.notifyDictatorshipModeChanged) return;
      await notifier.notifyDictatorshipModeChanged({
        chatId: record.telegramChatId,
        contractAddress: key,
        enabled: Boolean(enabled),
        homeLink: record.templHomeLink || ''
      });
    });

    const handleMaxMembersUpdated = wrapListener('Contract listener error', async (maxMembers) => {
      record.maxMembers = maxMembers?.toString?.() ?? maxMembers;
      templs.set(key, record);
      await persist?.(key, record);
      if (!record.telegramChatId || !notifier?.notifyMaxMembersUpdated) return;
      await notifier.notifyMaxMembersUpdated({
        chatId: record.telegramChatId,
        contractAddress: key,
        maxMembers: record.maxMembers,
        homeLink: record.templHomeLink || ''
      });
    });

    contract.on('MemberJoined', handleMemberJoined);
    contract.on('ProposalCreated', handleProposal);
    contract.on('VoteCast', handleVote);
    contract.on('PriestChanged', handlePriestChanged);
    contract.on('ProposalExecuted', handleProposalExecuted);
    contract.on('TemplHomeLinkUpdated', handleTemplHomeLinkUpdated);
    contract.on('MemberRewardsClaimed', handleMemberRewardsClaimed);
    contract.on('ExternalRewardClaimed', handleExternalRewardClaimed);
    contract.on('JoinPauseUpdated', handleJoinPauseUpdated);
    contract.on('ConfigUpdated', handleConfigUpdated);
    contract.on('TreasuryAction', handleTreasuryAction);
    contract.on('TreasuryDisbanded', handleTreasuryDisbanded);
    contract.on('DictatorshipModeChanged', handleDictatorshipModeChanged);
    contract.on('MaxMembersUpdated', handleMaxMembersUpdated);

    // Opportunistically refresh priest/home link from chain so cached metadata is accurate on boot
    try {
      if (typeof contract.templHomeLink === 'function') {
        const link = await contract.templHomeLink();
        if (typeof link === 'string' && link !== (record.templHomeLink || '')) {
          record.templHomeLink = link;
        }
      }
      if (typeof contract.priest === 'function') {
        const onchainPriest = await contract.priest();
        if (onchainPriest) {
          const nextPriest = String(onchainPriest).toLowerCase();
          if (nextPriest && nextPriest !== (record.priest || '')) {
            record.priest = nextPriest;
          }
        }
      }
      templs.set(key, record);
      await persist(key, record);
    } catch (err) {
      logger?.warn?.({ err: String(err?.message || err), contract: key }, 'Failed to refresh priest/home link on attach');
    }

    listenerRegistry.set(key, {
      contract,
      record,
      handlers: {
        handleMemberJoined,
        handleProposal,
        handleVote,
        handlePriestChanged,
        handleProposalExecuted,
        handleTemplHomeLinkUpdated,
        handleMemberRewardsClaimed,
        handleExternalRewardClaimed,
        handleJoinPauseUpdated,
        handleConfigUpdated,
        handleTreasuryAction,
        handleTreasuryDisbanded,
        handleDictatorshipModeChanged,
        handleMaxMembersUpdated
      }
    });
    await backfillActiveProposals({ contract, record, contractAddress: key });
  };

  let watchingEnabled = true;

  const watchContract = async (contractAddress, record) => {
    if (!contractAddress || !record) return;
    const key = String(contractAddress).toLowerCase();
    trackedRecords.set(key, record);
    if (!watchingEnabled) {
      return;
    }
    await attachListeners(contractAddress, record);
  };

  const pauseWatching = () => {
    if (!watchingEnabled) return;
    watchingEnabled = false;
    for (const key of Array.from(listenerRegistry.keys())) {
      detachListeners(key);
    }
  };

  const resumeWatching = async () => {
    if (watchingEnabled) return;
    watchingEnabled = true;
    const entries = Array.from(trackedRecords.entries());
    await Promise.allSettled(entries.map(([key, record]) => attachListeners(record?.contractAddress ?? key, record)));
  };

  return { watchContract, pauseWatching, resumeWatching };
}

async function restoreGroupsFromPersistence({ listBindings, templs, watchContract, logger, provider, trustedFactoryAddress }) {
  try {
    const rows = typeof listBindings === 'function' ? await listBindings() : [];
    const pending = [];
    for (const row of rows) {
      const key = String(row?.contract || '').toLowerCase();
      if (!key) continue;
      if (trustedFactoryAddress && provider) {
        try {
          await ensureTemplFromFactory({ provider, contractAddress: key, factoryAddress: trustedFactoryAddress });
        } catch (err) {
          logger?.warn?.({ err: String(err?.message || err), contract: key }, 'Skipping templ restored from persistence due to factory mismatch');
          continue;
        }
      } else if (trustedFactoryAddress && !provider) {
        logger?.warn?.({ contract: key }, 'Skipping templ restore: trusted factory configured but no provider available');
        continue;
      }
      const record = {
        telegramChatId: row?.telegramChatId ? String(row.telegramChatId) : null,
        priest: row?.priest ? String(row.priest).toLowerCase() : null,
        proposalsMeta: new Map(),
        lastDigestAt: 0,
        contractAddress: key,
        templHomeLink: '',
        bindingCode: row?.bindingCode ? String(row.bindingCode) : null,
        groupId: row?.groupId ? String(row.groupId) : null,
        group: null,
        creatorInboxId: null
      };
      templs.set(key, record);
      if (watchContract) {
        try {
          const maybe = watchContract(row.contract || key, record);
          if (maybe && typeof maybe.then === 'function') {
            pending.push(maybe);
          }
        } catch (err) {
          logger?.warn?.({ err: String(err?.message || err), contract: key }, 'Failed to watch contract during restore');
        }
      }
    }
    if (pending.length) {
      await Promise.allSettled(pending);
    }
  } catch (err) {
    logger?.warn?.({ err: String(err?.message || err) }, 'Failed to restore templs from persistence');
  }
}

function createBackgroundTasks({ templs, notifier, logger, persist }) {
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
            await persist?.(contractAddress, record);
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

export async function createApp(opts) {
  const {
    hasJoined,
    connectContract: providedConnectContract,
    rateLimitStore,
    provider,
    telegram,
    enableBackgroundTasks = process.env.NODE_ENV !== 'test',
    signatureStore: providedSignatureStore,
    persistence,
    signatureRetentionMs,
    verifyMiniAppAppKey
  } = opts || {};

  const notifier = telegram?.notifier ?? createTelegramNotifier({
    botToken: telegram?.botToken ?? process.env.TELEGRAM_BOT_TOKEN,
    linkBaseUrl: telegram?.linkBaseUrl ?? process.env.APP_BASE_URL,
    logger: telegram?.logger ?? logger
  });
  const connectContract = providedConnectContract ?? (provider ? (address) => new ethers.Contract(address, TEMPL_EVENT_ABI, provider) : null);
  const instanceId = (() => {
    try {
      if (typeof randomUUID === 'function') {
        return randomUUID();
      }
    } catch (err) {
      void err;
    }
    try {
      if (globalThis?.crypto?.randomUUID) {
        return globalThis.crypto.randomUUID();
      }
    } catch (err) {
      void err;
    }
    return `templ-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
  })();
  const app = express();
  const trustProxySetting = resolveTrustProxySetting();
  if (trustProxySetting !== false) {
    app.set('trust proxy', trustProxySetting);
  }
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

  const sqlitePath = process.env.SQLITE_DB_PATH?.trim() || null;
  /** @type {import('./persistence/index.js').PersistenceAdapter} */
  const persistenceAdapter = await initializePersistence({ persistence, retentionMs: signatureRetentionMs, sqlitePath });
  const persist = persistenceAdapter?.persistBinding
    ? async (contract, record) => persistenceAdapter.persistBinding(contract, record)
    : async () => {};
  const listBindings = persistenceAdapter?.listBindings
    ? async () => persistenceAdapter.listBindings()
    : async () => [];
  const findBinding = persistenceAdapter?.findBinding
    ? async (contract) => persistenceAdapter.findBinding(contract)
    : async () => null;
  const saveMiniAppNotification = persistenceAdapter?.saveMiniAppNotification
    ? async (record) => persistenceAdapter.saveMiniAppNotification(record)
    : async () => {};
  const deleteMiniAppNotification = persistenceAdapter?.deleteMiniAppNotification
    ? async (token) => persistenceAdapter.deleteMiniAppNotification(token)
    : async () => {};
  const deleteMiniAppNotificationsForFid = persistenceAdapter?.deleteMiniAppNotificationsForFid
    ? async (fid) => persistenceAdapter.deleteMiniAppNotificationsForFid(fid)
    : async () => {};

  let signatureStore = providedSignatureStore ?? persistenceAdapter?.signatureStore ?? null;
  if (!signatureStore) {
    signatureStore = createSignatureStore();
  }
  await signatureStore?.prune?.();

  const trustedFactoryAddress = process.env.TRUSTED_FACTORY_ADDRESS?.trim() || null;

  const contractWatcher = createContractWatcher({ connectContract, templs, persist, notifier, logger });
  contractWatcher.pauseWatching();
  const watchContract = contractWatcher.watchContract;
  app.locals.backgroundTasks = null;

  let cachedChainId = null;
  const getChainId = async () => {
    if (cachedChainId !== null) {
      return cachedChainId;
    }
    if (!provider) {
      cachedChainId = undefined;
      return cachedChainId;
    }
    try {
      const network = await provider.getNetwork();
      cachedChainId = Number(network?.chainId);
      if (!Number.isFinite(cachedChainId)) {
        cachedChainId = undefined;
      }
    } catch {
      cachedChainId = undefined;
    }
    return cachedChainId;
  };

  const factoryIndexer = createFactoryIndexer({
    provider,
    templs,
    logger,
    fromBlock: process.env.TRUSTED_FACTORY_DEPLOYMENT_BLOCK,
    onTemplDiscovered: async ({ templAddress, priestAddress, homeLink }) => {
      if (!templAddress || !priestAddress) return;
      const chainId = await getChainId();
      try {
        await registerTempl(
          {
            contractAddress: templAddress,
            priestAddress,
            templHomeLink: typeof homeLink === 'string' ? homeLink : '',
            chainId
          },
          {
            provider,
            logger,
            templs,
            persist,
            watchContract,
            findBinding,
            skipFactoryValidation: true
          }
        );
      } catch (err) {
        logger?.warn?.({ err: String(err?.message || err), contract: templAddress }, 'Factory auto-registration failed');
      }
    }
  });

  const restorationPromise = restoreGroupsFromPersistence({
    listBindings,
    templs,
    watchContract,
    logger,
    provider,
    trustedFactoryAddress
  });
  let restorationCompleted = false;
  restorationPromise
    .then(() => {
      restorationCompleted = true;
    })
    .catch(() => {
      restorationCompleted = true;
    });

  const waitForRestoration = async (req, res, next) => {
    if (restorationCompleted) {
      return next();
    }
    try {
      await restorationPromise;
      restorationCompleted = true;
      return next();
    } catch (err) {
      logger?.warn?.({ err: String(err?.message || err) }, 'Templ cache not ready for request');
      return res.status(503).json({ error: 'Service warming up, retry shortly' });
    }
  };

  const leadershipSupported = typeof persistenceAdapter?.acquireLeadership === 'function';
  let isLeader = false;
  let leaderServicesActive = false;
  let backgroundTasks = null;
  let leadershipTimer = null;
  const leaderTtlRaw = Number(process.env.LEADER_TTL_MS ?? DEFAULT_LEADER_TTL_MS);
  const leaderTtlMs = Number.isFinite(leaderTtlRaw) && leaderTtlRaw >= 15_000 ? leaderTtlRaw : DEFAULT_LEADER_TTL_MS;
  const leaderRefreshMs = Math.max(5_000, Math.floor(leaderTtlMs / 2));
  const leadershipReady = (() => {
    let resolved = false;
    let resolveFn;
    const promise = new Promise((res) => {
      resolveFn = res;
    });
    return {
      promise,
      resolve() {
        if (resolved) return;
        resolved = true;
        resolveFn();
      }
    };
  })();

  const startLeaderServices = async () => {
    if (leaderServicesActive) return;
    leaderServicesActive = true;
    try {
      await restorationPromise;
    } catch {
      /* ignore */
    }
    await contractWatcher.resumeWatching();
    if (factoryIndexer?.start) {
      try {
        await factoryIndexer.start();
      } catch (err) {
        logger?.warn?.({ err: String(err?.message || err) }, 'Failed to start factory indexer');
      }
    }
    if (enableBackgroundTasks && !backgroundTasks) {
      backgroundTasks = createBackgroundTasks({ templs, notifier, logger, persist });
      app.locals.backgroundTasks = backgroundTasks;
    }
    leadershipReady.resolve();
  };

  const stopLeaderServices = () => {
    if (!leaderServicesActive) return;
    leaderServicesActive = false;
    if (factoryIndexer?.stop) {
      factoryIndexer.stop().catch((err) => {
        logger?.warn?.({ err: String(err?.message || err) }, 'Failed to stop factory indexer');
      });
    }
    contractWatcher.pauseWatching();
    if (backgroundTasks) {
      backgroundTasks.stop();
      backgroundTasks = null;
      app.locals.backgroundTasks = null;
    }
  };

  const runLeadershipCycle = async () => {
    if (!leadershipSupported) {
      if (!isLeader) {
        isLeader = true;
        logger?.info?.({ instanceId }, 'Leadership defaulted (single instance)');
        await startLeaderServices();
      }
      return;
    }

    if (isLeader) {
      try {
        const refreshed = await persistenceAdapter.refreshLeadership?.(instanceId, leaderTtlMs);
        if (refreshed) {
          return;
        }
        logger?.info?.({ instanceId }, 'Leadership lost');
      } catch (err) {
        logger?.warn?.({ err: String(err?.message || err), instanceId }, 'Failed to refresh leadership; relinquishing');
      }
      isLeader = false;
      stopLeaderServices();
      return;
    }

    try {
      const acquired = await persistenceAdapter.acquireLeadership?.(instanceId, leaderTtlMs);
      if (acquired) {
        isLeader = true;
        logger?.info?.({ instanceId }, 'Leadership acquired');
        await startLeaderServices();
      }
    } catch (err) {
      logger?.warn?.({ err: String(err?.message || err), instanceId }, 'Failed to acquire leadership');
    }
  };

  restorationPromise
    .then(async () => {
      if (!leadershipSupported) {
        await runLeadershipCycle();
        return;
      }
      await runLeadershipCycle();
      leadershipTimer = setInterval(() => {
        void runLeadershipCycle().catch((err) => {
          logger?.warn?.({ err: String(err?.message || err), instanceId }, 'Leadership cycle error');
        });
      }, leaderRefreshMs);
    })
    .catch((err) => {
      logger?.warn?.({ err: String(err?.message || err) }, 'Failed to restore templ bindings');
    });

  const context = {
    hasJoined,
    templs,
    persist,
    provider,
    watchContract,
    notifier,
    signatureStore,
    findBinding,
    listBindings,
    saveMiniAppNotification,
    deleteMiniAppNotification,
    deleteMiniAppNotificationsForFid,
    verifyMiniAppAppKey,
    xmtp: null,
    lastJoin: { at: 0, payload: null },
    ensureGroup: async () => null
  };

  // XMTP setup - add to context if enabled
  let xmtp = null;
  let lastJoin = { at: 0, payload: null };

  if (process.env.XMTP_ENABLED === '1') {
    try {
      // Dynamically import XMTP modules only when enabled
      const { createXmtpWithRotation, waitForXmtpClientReady } = await import('./xmtp/index.js');

      // Generate or load a persistent bot private key tied to this server instance
      let botPrivateKey = process.env.BOT_PRIVATE_KEY;
      try {
        const db = persistenceAdapter?.db;
        if (db && typeof db.exec === 'function') {
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
            try {
              db.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)').run('bot_private_key', botPrivateKey);
              logger.info('Generated and persisted new invite-bot key');
            } catch { /* ignore */ }
          }
        }
      } catch (e) {
        // Fall back to env-only key if DB init fails
        if (!botPrivateKey) throw e;
      }

      const wallet = new ethers.Wallet(botPrivateKey, provider);
      const envMax = Number(process.env.XMTP_MAX_ATTEMPTS);
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
          logger.info({ instanceId, inboxId: xmtp.inboxId }, 'XMTP client ready');
          break;
        } catch (e) {
          logger.warn({ attempt: i, err: describeError(e) }, 'XMTP boot not ready; retrying');
          if (i === bootTries) throw e;
          await new Promise((r) => setTimeout(r, 1000));
        }
      }

      // Add XMTP context
      context.xmtp = xmtp;
      context.lastJoin = lastJoin;

      // Add XMTP helper function to context
      context.ensureGroup = async (record) => {
        if (!record) return null;
        if (record.group) return record.group;
        if (record.groupId && xmtp?.conversations?.getConversationById) {
          try {
            const maybe = await xmtp.conversations.getConversationById(record.groupId);
            if (maybe) {
              record.group = maybe;
              return maybe;
            }
          } catch (err) {
            logger.warn({ err: err?.message || err, groupId: record.groupId }, 'Failed to hydrate group conversation');
          }
        }
        if (!record.groupId && xmtp?.conversations?.newGroup && process.env.XMTP_ENABLED !== '0') {
          try {
            const initialMembers = [];
            if (record.creatorInboxId) {
              initialMembers.push(record.creatorInboxId);
            }
            const group = await xmtp.conversations.newGroup(initialMembers, {
              name: `templ:${record.contractAddress?.slice?.(0, 10) ?? 'templ'}`,
              description: record.templHomeLink ? `templ.fun • ${record.templHomeLink}` : 'templ.fun group'
            });
            if (group?.id) {
              record.groupId = String(group.id);
              record.group = group;
              templs.set(record.contractAddress || record.contract || '', record);
              await persist(record.contractAddress || record.contract || '', record);
              logger.info({ contract: record.contractAddress, groupId: record.groupId }, 'Created XMTP group for templ');
              return group;
            }
          } catch (err) {
            logger.warn({ err: err?.message || err, contract: record.contractAddress }, 'Failed to create XMTP group');
          }
        }
        return record.group || null;
      };

    } catch (err) {
      logger.error({ err: describeError(err), instanceId }, 'Failed to initialize XMTP client');
      // Continue without XMTP if initialization fails
    }
  }

  app.use(miniappRouter(context));
  app.use(waitForRestoration);
  app.use(templsRouter(context));
  app.use(joinRouter(context));

  app.close = async () => {
    try {
      await restorationPromise;
    } catch {
      /* ignore */
    }
    if (leadershipTimer) {
      clearInterval(leadershipTimer);
      leadershipTimer = null;
    }
    if (leadershipSupported) {
      try {
        await persistenceAdapter.releaseLeadership?.(instanceId);
      } catch (err) {
        logger?.debug?.({ err: String(err?.message || err), instanceId }, 'Failed to release leadership on shutdown');
      }
    }
    stopLeaderServices();
    await store.shutdown?.();
    await persistenceAdapter?.dispose?.();
  };

  if (!enableBackgroundTasks) {
    app.locals.backgroundTasks = null;
  }
  app.locals.restorationPromise = restorationPromise;
  app.locals.leadershipReady = leadershipReady.promise;

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  dotenv.config();
  const { RPC_URL, RPC_CHAIN_ID } = process.env;
  if (!RPC_URL) {
    throw new Error('Missing RPC_URL environment variable');
  }
  let provider;
  if (RPC_CHAIN_ID) {
    const parsedChainId = Number(RPC_CHAIN_ID);
    if (!Number.isFinite(parsedChainId) || parsedChainId <= 0) {
      throw new Error(`Invalid RPC_CHAIN_ID "${RPC_CHAIN_ID}"`);
    }
    provider = new ethers.JsonRpcProvider(RPC_URL, { chainId: parsedChainId, name: `chain-${parsedChainId}` });
  } else {
    provider = new ethers.JsonRpcProvider(RPC_URL);
  }

  const hasJoined = async (contractAddress, memberAddress) => {
    const contract = new ethers.Contract(
      contractAddress,
      ['function isMember(address) view returns (bool)'],
      provider
    );
    return contract.isMember(memberAddress);
  };

  const rateLimitStore = await createRateLimitStore();
  const notifier = createTelegramNotifier({
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    linkBaseUrl: process.env.APP_BASE_URL,
    logger
  });
  const app = await createApp({ hasJoined, rateLimitStore, provider, telegram: { notifier } });
  const port = process.env.PORT || 3001;
  app.listen(port, () => {
    logger.info({ port }, 'TEMPL backend listening');
  });
}

export default {};
