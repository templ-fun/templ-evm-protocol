// @ts-check
import templFactoryArtifact from '../contracts/TemplFactory.json';
import templArtifact from '../contracts/TEMPL.json';

const ERC20_METADATA_ABI = [
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)'
];

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
 *   burnedRaw: bigint,
 *   burnedFormatted: string,
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

  const seen = new Map();
  for (const evt of events) {
    try {
      const templAddress = String(evt?.args?.templ ?? evt?.args?.[0] ?? '').toLowerCase();
      if (!templAddress || seen.has(templAddress)) continue;
      const tokenAddress = String(evt?.args?.token ?? evt?.args?.[3] ?? '').toLowerCase();
      const priest = String(evt?.args?.priest ?? evt?.args?.[2] ?? '').toLowerCase();
      seen.set(templAddress, { tokenAddress, priest });
    } catch {
      /* ignore malformed log */
    }
  }

  const entries = Array.from(seen.entries());
  if (entries.length === 0) return [];

  return Promise.all(entries.map(async ([templAddress, meta]) => {
    let burned = 0n;
    let tokenAddress = meta.tokenAddress;
    let templHomeLink = '';
    let tokenSymbol = '';
    let tokenDecimals = 18;

    try {
      const templ = new ethers.Contract(templAddress, templArtifact.abi, provider);
      const [burnedValue, accessToken, link] = await Promise.all([
        templ.totalBurned().catch(() => 0n),
        templ.accessToken().catch(() => tokenAddress),
        templ.templHomeLink().catch(() => '')
      ]);
      burned = typeof burnedValue === 'bigint' ? burnedValue : BigInt(burnedValue || 0);
      if (typeof accessToken === 'string' && accessToken) {
        tokenAddress = accessToken.toLowerCase();
      }
      if (typeof link === 'string') {
        templHomeLink = link;
      }
    } catch (err) {
      console.warn('[templ] Failed to load templ details', templAddress, err);
    }

    if (tokenAddress) {
      try {
        const token = new ethers.Contract(tokenAddress, ERC20_METADATA_ABI, provider);
        const [symbolValue, decimalsValue] = await Promise.all([
          token.symbol().catch(() => ''),
          token.decimals().catch(() => 18)
        ]);
        if (typeof symbolValue === 'string' && symbolValue.trim().length) {
          tokenSymbol = symbolValue.trim();
        }
        const parsedDecimals = Number(decimalsValue);
        if (Number.isFinite(parsedDecimals) && parsedDecimals >= 0 && parsedDecimals <= 36) {
          tokenDecimals = parsedDecimals;
        }
      } catch (err) {
        console.warn('[templ] Failed to read token metadata', tokenAddress, err);
      }
    }

    let burnedFormatted = '';
    try {
      burnedFormatted = ethers.formatUnits(burned, tokenDecimals);
    } catch {
      burnedFormatted = burned.toString();
    }

    const homeLink = templHomeLink && templHomeLink.trim().length ? templHomeLink.trim() : undefined;
    return {
      contract: templAddress,
      priest: meta.priest,
      tokenAddress,
      tokenSymbol: tokenSymbol || 'ERC20',
      tokenDecimals,
      burnedRaw: burned,
      burnedFormatted,
      templHomeLink: homeLink || '',
      links: {
        overview: `/templs/${templAddress}`,
        homeLink
      }
    };
  }));
}
