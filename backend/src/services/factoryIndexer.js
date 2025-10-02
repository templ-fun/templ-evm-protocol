import { ethers } from 'ethers';

const FACTORY_EVENT_ABI = [
  'event TemplCreated(address indexed templ, address indexed creator, address indexed priest, address token, uint256 entryFee, uint256 burnPercent, uint256 treasuryPercent, uint256 memberPoolPercent, uint256 quorumPercent, uint256 executionDelaySeconds, address burnAddress, bool priestIsDictator, uint256 maxMembers, uint8 curvePrimaryStyle, uint32 curvePrimaryRateBps, uint8 curveSecondaryStyle, uint32 curveSecondaryRateBps, uint16 curvePivotPercentOfMax, string homeLink)'
];

const FACTORY_INTERFACE = new ethers.Interface(FACTORY_EVENT_ABI);
const TEMPL_CREATED_EVENT = FACTORY_INTERFACE.getEvent('TemplCreated');
const TEMPL_CREATED_TOPIC = /** @type {string} */ (TEMPL_CREATED_EVENT?.topicHash ?? '');

if (!TEMPL_CREATED_TOPIC) {
  throw new Error('TemplCreated topic hash unavailable');
}
const DEFAULT_LOG_WINDOW = 50_000;

function parseBlockNumber(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value < 0 ? 0 : Math.floor(value);
  }
  if (typeof value === 'bigint') {
    if (value < 0n) return 0;
    const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
    const safeValue = value > maxSafe ? maxSafe : value;
    return Number(safeValue);
  }
  const trimmed = String(value).trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) return null;
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed)) return null;
  return parsed < 0 ? 0 : parsed;
}

function matchesFilter(filter, log) {
  if (!filter) return true;
  if (typeof filter === 'string') {
    return filter === log;
  }
  if (filter.address) {
    const addr = Array.isArray(filter.address) ? filter.address : [filter.address];
    const lowerAddresses = addr.filter(Boolean).map((value) => String(value).toLowerCase());
    if (!lowerAddresses.includes(String(log.address || '').toLowerCase())) {
      return false;
    }
  }
  if (filter.topics) {
    const topics = Array.isArray(filter.topics) ? filter.topics : [filter.topics];
    for (let i = 0; i < topics.length; i += 1) {
      const expected = topics[i];
      if (!expected) continue;
      if (Array.isArray(expected)) {
        const variants = expected.filter(Boolean).map((topic) => String(topic).toLowerCase());
        const actual = String(log.topics?.[i] || '').toLowerCase();
        if (!variants.includes(actual)) {
          return false;
        }
      } else {
        const actual = String(log.topics?.[i] || '').toLowerCase();
        if (actual !== String(expected).toLowerCase()) {
          return false;
        }
      }
    }
  }
  return true;
}

export function createFactoryIndexer(options = {}) {
  const {
    provider,
    templs,
    logger,
    onTemplDiscovered,
    fromBlock,
    chunkSize
  } = options;

  const factoryAddress = process.env.TRUSTED_FACTORY_ADDRESS?.trim();
  if (!provider || !factoryAddress || typeof onTemplDiscovered !== 'function') {
    return {
      async start() {},
      async stop() {}
    };
  }

  if (typeof provider.on !== 'function' || typeof provider.off !== 'function') {
    logger?.warn?.('Factory indexer disabled: provider does not support event subscriptions');
    return {
      async start() {},
      async stop() {}
    };
  }

  const normalizedFactory = factoryAddress.toLowerCase();
  const subscriptionFilter = { address: factoryAddress, topics: [TEMPL_CREATED_TOPIC] };
  let running = false;
  let historicalSyncInFlight = null;

  const seenTempls = new Set();

  const markTemplSeen = (address) => {
    const key = String(address || '').toLowerCase();
    if (key) {
      seenTempls.add(key);
    }
  };

  const shouldProcessTempl = (address) => {
    const key = String(address || '').toLowerCase();
    if (!key) return false;
    if (seenTempls.has(key)) return false;
    if (templs?.has?.(key)) return false;
    return true;
  };

  const processLog = async (log) => {
    if (!log) return;
    if (String(log.address || '').toLowerCase() !== normalizedFactory) return;
    if (!Array.isArray(log.topics) || (log.topics[0] || '').toLowerCase() !== String(TEMPL_CREATED_TOPIC).toLowerCase()) {
      return;
    }
    let parsed;
    try {
      parsed = FACTORY_INTERFACE.parseLog(log);
    } catch (err) {
      logger?.warn?.({ err: String(err?.message || err) }, 'Factory indexer failed to parse log');
      return;
    }
    const templAddress = parsed?.args?.templ;
    if (!shouldProcessTempl(templAddress)) {
      markTemplSeen(templAddress);
      return;
    }
    try {
      await onTemplDiscovered({
        templAddress,
        priestAddress: parsed?.args?.priest,
        homeLink: parsed?.args?.homeLink ?? '',
        curve: {
          primaryStyle: Number(parsed?.args?.curvePrimaryStyle ?? 0),
          primaryRateBps: BigInt(parsed?.args?.curvePrimaryRateBps ?? 0),
          secondaryStyle: Number(parsed?.args?.curveSecondaryStyle ?? 0),
          secondaryRateBps: BigInt(parsed?.args?.curveSecondaryRateBps ?? 0),
          pivotPercentOfMax: Number(parsed?.args?.curvePivotPercentOfMax ?? 0)
        },
        event: parsed,
        log
      });
      markTemplSeen(templAddress);
    } catch (err) {
      logger?.warn?.({ err: String(err?.message || err), contract: templAddress }, 'Factory indexer failed processing templ');
    }
  };

  const syncHistorical = async () => {
    if (historicalSyncInFlight) {
      return historicalSyncInFlight;
    }
    historicalSyncInFlight = (async () => {
      let start = parseBlockNumber(fromBlock);
      if (start === null || start === undefined) {
        const envStart = parseBlockNumber(process.env.TRUSTED_FACTORY_DEPLOYMENT_BLOCK);
        start = envStart ?? 0;
      }
      let latest;
      try {
        const blockNumber = await provider.getBlockNumber();
        latest = Number(blockNumber);
      } catch (err) {
        logger?.warn?.({ err: String(err?.message || err) }, 'Factory indexer unable to determine latest block');
        return;
      }
      if (!Number.isFinite(latest) || latest < start) {
        latest = start;
      }
      let window = Number.isFinite(chunkSize) && chunkSize > 0 ? Math.floor(chunkSize) : DEFAULT_LOG_WINDOW;
      if (window < 1) window = 1;
      let cursor = start;
      while (cursor <= latest) {
        const end = Math.min(cursor + window - 1, latest);
        try {
          const logs = await provider.getLogs({
            address: factoryAddress,
            topics: [TEMPL_CREATED_TOPIC],
            fromBlock: cursor,
            toBlock: end
          });
          for (const log of logs) {
            await processLog(log);
          }
          cursor = end + 1;
        } catch (err) {
          logger?.warn?.({ err: String(err?.message || err), fromBlock: cursor, toBlock: end }, 'Factory indexer log scan failed');
          if (window <= 1_000) {
            break;
          }
          window = Math.max(1, Math.floor(window / 2));
        }
      }
    })();
    try {
      await historicalSyncInFlight;
    } finally {
      historicalSyncInFlight = null;
    }
  };

  const handleProviderEvent = (log) => {
    if (!matchesFilter({ address: factoryAddress, topics: [TEMPL_CREATED_TOPIC] }, log)) {
      return;
    }
    void processLog(log);
  };

  return {
    async start() {
      if (running) return;
      running = true;
      await syncHistorical();
      provider.on(subscriptionFilter, handleProviderEvent);
    },
    async stop() {
      if (!running) return;
      running = false;
      provider.off(subscriptionFilter, handleProviderEvent);
    }
  };
}
