// @ts-check
import templFactoryArtifact from '../contracts/TemplFactory.json';
import templArtifact from '../contracts/TEMPL.json';

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
 *   templHomeLink?: string
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
 * @property {string} totalPurchases
 * @property {string} totalTreasuryReceived
 * @property {string} totalProtocolFees
 * @property {string} templHomeLink
 * @property {{ overview: string, homeLink?: string }} links
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
  let totalBurned = 0n;

  try {
    [config, treasuryInfo, homeLink, memberCount, priestAddress, totalBurned] = await Promise.all([
      templ.getConfig().catch(() => null),
      templ.getTreasuryInfo().catch(() => null),
      templ.templHomeLink().catch(() => ''),
      templ.getMemberCount?.().catch(() => 0n),
      templ.priest?.().catch(() => metaInfo.priest || ''),
      templ.totalBurned().catch(() => 0n)
    ]);
  } catch (err) {
    console.warn('[templ] Failed to load templ summary', templAddress, err);
  }

  let tokenAddress = metaInfo.tokenAddress || '';
  let entryFeeRaw = metaInfo.entryFee !== undefined ? toBigInt(metaInfo.entryFee) : toBigInt(metaInfo.entryFeeRaw);
  let totalPurchases = 0n;
  let treasuryAvailable = 0n;
  let memberPoolBalance = 0n;
  let totalTreasuryReceived = 0n;
  let totalProtocolFees = 0n;

  if (config) {
    const [cfgToken, fee, , purchases, treasuryBal, poolBal] = config;
    if (typeof cfgToken === 'string' && cfgToken) {
      tokenAddress = cfgToken.toLowerCase();
    }
    if (fee !== undefined && fee !== null) {
      entryFeeRaw = typeof fee === 'bigint' ? fee : BigInt(fee);
    }
    if (purchases !== undefined && purchases !== null) {
      totalPurchases = typeof purchases === 'bigint' ? purchases : BigInt(purchases);
    }
    if (treasuryBal !== undefined && treasuryBal !== null) {
      treasuryAvailable = typeof treasuryBal === 'bigint' ? treasuryBal : BigInt(treasuryBal);
    }
    if (poolBal !== undefined && poolBal !== null) {
      memberPoolBalance = typeof poolBal === 'bigint' ? poolBal : BigInt(poolBal);
    }
  }

  if (treasuryInfo) {
    const [treasuryBal, memberPoolBal, totalReceived, burnedValue, protocolFees] = treasuryInfo;
    if (treasuryBal !== undefined && treasuryBal !== null) {
      treasuryAvailable = typeof treasuryBal === 'bigint' ? treasuryBal : BigInt(treasuryBal);
    }
    if (memberPoolBal !== undefined && memberPoolBal !== null) {
      memberPoolBalance = typeof memberPoolBal === 'bigint' ? memberPoolBal : BigInt(memberPoolBal);
    }
    if (totalReceived !== undefined && totalReceived !== null) {
      totalTreasuryReceived = typeof totalReceived === 'bigint' ? totalReceived : BigInt(totalReceived);
    }
    if (burnedValue !== undefined && burnedValue !== null) {
      totalBurned = typeof burnedValue === 'bigint' ? burnedValue : BigInt(burnedValue);
    }
    if (protocolFees !== undefined && protocolFees !== null) {
      totalProtocolFees = typeof protocolFees === 'bigint' ? protocolFees : BigInt(protocolFees);
    }
  }

  if (!tokenAddress && metaInfo.tokenAddress) {
    tokenAddress = metaInfo.tokenAddress;
  }

  const { symbol: tokenSymbol, decimals: tokenDecimals } = await fetchTokenMetadata({ ethers, provider, tokenAddress });

  const entryFeeFormatted = formatValue(ethers, entryFeeRaw, tokenDecimals);
  const treasuryBalanceFormatted = formatValue(ethers, treasuryAvailable, tokenDecimals);
  const memberPoolBalanceFormatted = formatValue(ethers, memberPoolBalance, tokenDecimals);
  const burnedFormatted = formatValue(ethers, totalBurned, tokenDecimals);

  const normalizedHomeLink = homeLink && homeLink.trim().length ? homeLink.trim() : '';

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
    totalPurchases: totalPurchases.toString(),
    totalTreasuryReceived: totalTreasuryReceived.toString(),
    totalProtocolFees: totalProtocolFees.toString(),
    templHomeLink: normalizedHomeLink || metaInfo.templHomeLink || '',
    links: {
      overview: `/templs/${normalizedAddress.toLowerCase()}`,
      homeLink: normalizedHomeLink || undefined
    }
  };
}

/**
 * Load templ summaries from the factory and contracts.
 * @param {object} params
 * @param {typeof import('ethers')} params.ethers
 * @param {import('ethers').Provider | import('ethers').Signer | null | undefined} params.provider
 * @param {string | null | undefined} params.factoryAddress
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
 *   totalPurchases: string,
 *   templHomeLink: string,
 *   links: {
 *     overview: string,
 *     homeLink?: string
 *   }
 * }>>}
 */
export async function loadFactoryTempls({ ethers, provider, factoryAddress }) {
  if (!ethers || !provider || !factoryAddress) return [];
  const address = factoryAddress.trim();
  if (!address) return [];

  /** @type {import('ethers').Contract} */
  const factory = new ethers.Contract(address, templFactoryArtifact.abi, provider);
  /** @type {Array<any>} */
  let events = [];
  try {
    if (factory.filters?.TemplCreated) {
      const filter = factory.filters.TemplCreated();
      events = await factory.queryFilter(filter);
    } else {
      events = await factory.queryFilter('TemplCreated');
    }
  } catch (err) {
    console.warn('[templ] Failed to query factory templs', err);
    return [];
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
