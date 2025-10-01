// @ts-check
import templFactoryArtifact from '../contracts/TemplFactory.json';
import templArtifact from '../contracts/TEMPL.json';
import { sanitizeLink, sanitizeLinkMap } from '../../../shared/linkSanitizer.js';

const ERC20_METADATA_ABI = [
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)'
];

/**
 * @typedef {{
 *   tokenAddress?: string,
 *   priest?: string,
 *   entryFee?: bigint | string,
 *   entryFeeRaw?: string,
 *   tokenSymbol?: string,
 *   templHomeLink?: string,
 *   protocolPercent?: number,
 *   joinPaused?: boolean
 * }} TemplMeta
 */

/**
 * @typedef {Object} TemplStats
 * @property {string} contract
 * @property {string} priest
 * @property {string} tokenAddress
 * @property {string} tokenSymbol
 * @property {number} tokenDecimals
 * @property {string} entryFeeRaw
 * @property {string} entryFeeFormatted
 * @property {string} treasuryBalanceRaw
 * @property {string} treasuryBalanceFormatted
 * @property {string} memberPoolBalanceRaw
 * @property {string} memberPoolBalanceFormatted
 * @property {string} burnedRaw
 * @property {string} burnedFormatted
 * @property {number} memberCount
 * @property {string} totalJoins
 * @property {boolean} joinPaused
 * @property {string} totalTreasuryReceived
 * @property {string} totalProtocolFees
 * @property {string} templHomeLink
 * @property {{ overview: string, homeLink?: string }} links
 * @property {number} protocolPercent
 * @property {number} burnPercent
 * @property {number} treasuryPercent
 * @property {number} memberPoolPercent
 */

const toBigInt = (value, fallback = 0n) => {
  try {
    if (typeof value === 'bigint') return value;
    if (value === undefined || value === null || value === '') return fallback;
    return BigInt(value);
  } catch {
    return fallback;
  }
};

const toPercent = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return parsed / 100;
};

function formatValue(ethers, value, decimals) {
  try {
    return ethers.formatUnits(value, decimals);
  } catch {
    return value.toString();
  }
}

async function fetchTokenMetadata({ ethers, provider, tokenAddress }) {
  if (!tokenAddress) {
    return { symbol: '', decimals: 18 };
  }
  try {
    const token = new ethers.Contract(tokenAddress, ERC20_METADATA_ABI, provider);
    const [symbolValue, decimalsValue] = await Promise.all([
      token.symbol().catch(() => ''),
      token.decimals().catch(() => 18)
    ]);
    let symbol = '';
    if (typeof symbolValue === 'string' && symbolValue.trim().length) {
      symbol = symbolValue.trim();
    }
    let decimals = 18;
    const parsedDecimals = Number(decimalsValue);
    if (Number.isFinite(parsedDecimals) && parsedDecimals >= 0 && parsedDecimals <= 36) {
      decimals = parsedDecimals;
    }
    return { symbol, decimals };
  } catch (err) {
    console.warn('[templ] Failed to read token metadata', tokenAddress, err);
    return { symbol: '', decimals: 18 };
  }
}

/**
 * @param {object} params
 * @param {typeof import('ethers')} params.ethers
 * @param {import('ethers').Provider | import('ethers').Signer} params.provider
 * @param {string} params.templAddress
 * @param {TemplMeta} [params.meta]
 * @returns {Promise<TemplStats>}
 */
export async function fetchTemplStats({
  ethers,
  provider,
  templAddress,
  meta
}) {
  if (!ethers || !provider || !templAddress) {
    throw new Error('fetchTemplStats requires templ address and provider');
  }
  let normalizedAddress;
  try {
    normalizedAddress = ethers.getAddress?.(templAddress) ?? templAddress;
  } catch {
    normalizedAddress = templAddress;
  }
  const templ = new ethers.Contract(normalizedAddress, templArtifact.abi, provider);
  const metaInfo = /** @type {TemplMeta} */ (meta || {});

  let config;
  let treasuryInfo;
  let homeLink = '';
  let memberCount = 0n;
  let priestAddress = metaInfo.priest || '';
  let totalJoinsValue = null;
  let joinPaused = metaInfo.joinPaused !== undefined && metaInfo.joinPaused !== null
    ? Boolean(metaInfo.joinPaused)
    : false;

  try {
    [config, treasuryInfo, homeLink, memberCount, priestAddress, totalJoinsValue] = await Promise.all([
      templ.getConfig().catch(() => null),
      templ.getTreasuryInfo().catch(() => null),
      templ.templHomeLink().catch(() => ''),
      templ.getMemberCount?.().catch(() => 0n),
      templ.priest?.().catch(() => metaInfo.priest || ''),
      templ.totalJoins?.().catch(() => null)
    ]);
  } catch (err) {
    console.warn('[templ] Failed to load templ summary', templAddress, err);
  }

  let tokenAddress = metaInfo.tokenAddress || '';
  let entryFeeRaw = metaInfo.entryFee !== undefined ? toBigInt(metaInfo.entryFee) : toBigInt(metaInfo.entryFeeRaw);
  let totalJoins = 0n;
  if (totalJoinsValue !== undefined && totalJoinsValue !== null) {
    totalJoins = toBigInt(totalJoinsValue, 0n);
  }
  let treasuryAvailable = 0n;
  let memberPoolBalance = 0n;
  let totalTreasuryReceived = 0n;
  let totalProtocolFees = 0n;
  let totalBurned = 0n;
  let burnPercentBps = 0;
  let treasuryPercentBps = 0;
  let memberPoolPercentBps = 0;
  let protocolPercentBps = metaInfo?.protocolPercent !== undefined && metaInfo.protocolPercent !== null
    ? Number(metaInfo.protocolPercent)
    : 0;

  if (config) {
    const [cfgToken, fee, joinState, joinsValue, treasuryBal, poolBal, burnPct, treasuryPct, memberPct, protocolPct] = config;
    if (typeof cfgToken === 'string' && cfgToken) {
      tokenAddress = cfgToken.toLowerCase();
    }
    joinPaused = Boolean(joinState);
    if (burnPct !== undefined && burnPct !== null) {
      const parsed = Number(burnPct);
      if (Number.isFinite(parsed)) burnPercentBps = parsed;
    }
    if (treasuryPct !== undefined && treasuryPct !== null) {
      const parsed = Number(treasuryPct);
      if (Number.isFinite(parsed)) treasuryPercentBps = parsed;
    }
    if (memberPct !== undefined && memberPct !== null) {
      const parsed = Number(memberPct);
      if (Number.isFinite(parsed)) memberPoolPercentBps = parsed;
    }
    if (protocolPct !== undefined && protocolPct !== null) {
      const parsed = Number(protocolPct);
      if (Number.isFinite(parsed)) protocolPercentBps = parsed;
    }
    if (fee !== undefined && fee !== null) {
      entryFeeRaw = typeof fee === 'bigint' ? fee : BigInt(fee);
    }
    if (joinsValue !== undefined && joinsValue !== null) {
      totalJoins = typeof joinsValue === 'bigint' ? joinsValue : BigInt(joinsValue);
    }
    if (treasuryBal !== undefined && treasuryBal !== null) {
      treasuryAvailable = typeof treasuryBal === 'bigint' ? treasuryBal : BigInt(treasuryBal);
    }
    if (poolBal !== undefined && poolBal !== null) {
      memberPoolBalance = typeof poolBal === 'bigint' ? poolBal : BigInt(poolBal);
    }
  }

  if (treasuryInfo) {
    const treasuryBal = treasuryInfo?.treasury ?? treasuryInfo?.[0];
    const memberPoolBal = treasuryInfo?.memberPool ?? treasuryInfo?.[1];
    if (treasuryBal !== undefined && treasuryBal !== null) {
      treasuryAvailable = typeof treasuryBal === 'bigint' ? treasuryBal : BigInt(treasuryBal);
    }
    if (memberPoolBal !== undefined && memberPoolBal !== null) {
      memberPoolBalance = typeof memberPoolBal === 'bigint' ? memberPoolBal : BigInt(memberPoolBal);
    }
  }

  if (!tokenAddress && metaInfo.tokenAddress) {
    tokenAddress = metaInfo.tokenAddress;
  }

  let joinsFromEvents = 0n;
  if (templ.filters?.MemberJoined && typeof templ.queryFilter === 'function') {
    try {
      const events = await templ.queryFilter(templ.filters.MemberJoined(), 0, 'latest');
      joinsFromEvents = BigInt(events.length);
      for (const evt of events) {
        const args = typeof evt === 'object' && evt !== null && 'args' in evt
          ? /** @type {Record<string | number, any>} */ (evt.args)
          : {};
        totalBurned += toBigInt(args?.burnedAmount, 0n);
        totalTreasuryReceived += toBigInt(args?.treasuryAmount, 0n);
        totalProtocolFees += toBigInt(args?.protocolAmount, 0n);
      }
      if (totalJoins === 0n && joinsFromEvents > 0n) {
        totalJoins = joinsFromEvents;
      }
    } catch (err) {
      console.warn('[templ] Failed to aggregate MemberJoined events', templAddress, err);
    }
  }

  const { symbol: tokenSymbol, decimals: tokenDecimals } = await fetchTokenMetadata({ ethers, provider, tokenAddress });

  const entryFeeFormatted = formatValue(ethers, entryFeeRaw, tokenDecimals);
  const treasuryBalanceFormatted = formatValue(ethers, treasuryAvailable, tokenDecimals);
  const memberPoolBalanceFormatted = formatValue(ethers, memberPoolBalance, tokenDecimals);
  const burnedFormatted = formatValue(ethers, totalBurned, tokenDecimals);

  const normalizedHomeLink = homeLink && homeLink.trim().length ? homeLink.trim() : '';
  const rawHomeLink = normalizedHomeLink || metaInfo.templHomeLink || '';
  const sanitizedHomeLink = sanitizeLink(rawHomeLink);
  const links = { overview: `/templs/${normalizedAddress.toLowerCase()}` };
  Object.assign(links, sanitizeLinkMap(metaInfo.links || {}));
  if (sanitizedHomeLink.href) {
    links.homeLink = sanitizedHomeLink.href;
  } else {
    delete links.homeLink;
  }

  return {
    contract: normalizedAddress.toLowerCase(),
    priest: priestAddress ? priestAddress.toLowerCase() : metaInfo.priest || '',
    tokenAddress: tokenAddress || '',
    tokenSymbol: tokenSymbol || metaInfo.tokenSymbol || 'ERC20',
    tokenDecimals,
    entryFeeRaw: entryFeeRaw.toString(),
    entryFeeFormatted,
    treasuryBalanceRaw: treasuryAvailable.toString(),
    treasuryBalanceFormatted,
    memberPoolBalanceRaw: memberPoolBalance.toString(),
    memberPoolBalanceFormatted,
    burnedRaw: totalBurned.toString(),
    burnedFormatted,
    memberCount: Number(memberCount),
    totalJoins: totalJoins.toString(),
    joinPaused,
    totalTreasuryReceived: totalTreasuryReceived.toString(),
    totalProtocolFees: totalProtocolFees.toString(),
    templHomeLink: sanitizedHomeLink.text || '',
    protocolPercent: toPercent(protocolPercentBps),
    burnPercent: toPercent(burnPercentBps),
    treasuryPercent: toPercent(treasuryPercentBps),
    memberPoolPercent: toPercent(memberPoolPercentBps),
    links
  };
}

/**
 * Load templ summaries from the factory and contracts.
 * @param {object} params
 * @param {typeof import('ethers')} params.ethers
 * @param {import('ethers').Provider | import('ethers').Signer | null | undefined} params.provider
 * @param {string | null | undefined} params.factoryAddress
 * @param {number | null | undefined} [params.fromBlock]
 * @param {number | null | undefined} [params.chunkSize]
 * @returns {Promise<Array<{
 *   contract: string,
 *   priest: string,
 *   tokenAddress: string,
 *   tokenSymbol: string,
 *   tokenDecimals: number,
 *   burnedRaw: string,
 *   burnedFormatted: string,
 *   treasuryBalanceRaw: string,
 *   treasuryBalanceFormatted: string,
 *   memberPoolBalanceRaw: string,
 *   memberPoolBalanceFormatted: string,
 *   memberCount: number,
 *   totalJoins: string,
 *   templHomeLink: string,
 *   links: {
 *     overview: string,
 *     homeLink?: string
 *   }
 * }>>}
 */
export async function loadFactoryTempls({
  ethers,
  provider,
  factoryAddress,
  fromBlock,
  chunkSize = 20_000
}) {
  if (!ethers || !provider || !factoryAddress) return [];
  const address = factoryAddress.trim();
  if (!address) return [];

  /** @type {import('ethers').Contract} */
  const factory = new ethers.Contract(address, templFactoryArtifact.abi, provider);
  const eventFilter = factory.filters?.TemplCreated ? factory.filters.TemplCreated() : null;

  const normalisedFromBlock = Number.isFinite(fromBlock) && fromBlock >= 0 ? Math.floor(fromBlock) : 0;
  let latestBlock = normalisedFromBlock;
  /** @type {import('ethers').Provider | null} */
  let blockProvider = null;
  if (provider && typeof provider === 'object' && 'getBlockNumber' in provider && typeof provider.getBlockNumber === 'function') {
    blockProvider = /** @type {import('ethers').Provider} */ (provider);
  } else if (provider && typeof provider === 'object' && 'provider' in provider && provider.provider && typeof provider.provider.getBlockNumber === 'function') {
    blockProvider = provider.provider;
  }

  if (blockProvider) {
    try {
      latestBlock = Number(await blockProvider.getBlockNumber());
    } catch (err) {
      console.warn('[templ] Failed to read latest block number, falling back to fromBlock', err);
    }
  }
  if (!Number.isFinite(latestBlock) || latestBlock < normalisedFromBlock) {
    latestBlock = normalisedFromBlock;
  }

  /** @type {Array<any>} */
  const events = [];
  let window = Number.isFinite(chunkSize) && chunkSize > 0 ? Math.floor(chunkSize) : 20_000;
  if (window < 1) window = 1;
  let start = normalisedFromBlock;

  while (start <= latestBlock) {
    const end = Math.min(start + window - 1, latestBlock);
    try {
      const chunk = eventFilter
        ? await factory.queryFilter(eventFilter, start, end)
        : await factory.queryFilter('TemplCreated', start, end);
      events.push(...chunk);
      start = end + 1;
    } catch (err) {
      if (window <= 1_000) {
        console.warn('[templ] Failed to query factory templs after chunk retries', err);
        return [];
      }
      window = Math.max(1_000, Math.floor(window / 2));
      continue;
    }
  }

  /** @type {Map<string, { tokenAddress: string, priest: string, entryFee: bigint }>} */
  const seen = new Map();
  for (const evt of events) {
    try {
      const templAddress = String(evt?.args?.templ ?? evt?.args?.[0] ?? '').toLowerCase();
      if (!templAddress || seen.has(templAddress)) continue;
      const tokenAddress = String(evt?.args?.token ?? evt?.args?.[3] ?? '').toLowerCase();
      const priest = String(evt?.args?.priest ?? evt?.args?.[2] ?? '').toLowerCase();
      let entryFeeValue = 0n;
      try {
        const raw = evt?.args?.entryFee ?? evt?.args?.[4] ?? 0n;
        entryFeeValue = typeof raw === 'bigint' ? raw : BigInt(raw || 0);
      } catch {
        entryFeeValue = 0n;
      }
      seen.set(templAddress, { tokenAddress, priest, entryFee: entryFeeValue });
    } catch {
      /* ignore malformed log */
    }
  }

  const entries = Array.from(seen.entries());
  if (entries.length === 0) return [];

  return Promise.all(entries.map(async ([templAddress, meta]) => {
    return fetchTemplStats({
      ethers,
      provider,
      templAddress,
      meta
    });
  }));
}
