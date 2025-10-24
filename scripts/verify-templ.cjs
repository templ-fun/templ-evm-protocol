const hre = require("hardhat");
require("dotenv").config();

const FACTORY_EVENT_VARIANTS = [
  {
    id: 'current',
    abi: 'event TemplCreated(address indexed templ, address indexed creator, address indexed priest, address token, uint256 entryFee, uint256 burnBps, uint256 treasuryBps, uint256 memberPoolBps, uint256 quorumBps, uint256 executionDelaySeconds, address burnAddress, bool priestIsDictator, uint256 maxMembers, uint8[] curveStyles, uint32[] curveRateBps, uint32[] curveLengths, string name, string description, string logoLink, uint256 proposalFeeBps, uint256 referralShareBps)'
  }
].map((variant) => {
  const iface = new hre.ethers.Interface([variant.abi]);
  const fragment = iface.getEvent('TemplCreated');
  const topic = fragment.topicHash?.toLowerCase?.();
  if (!topic) {
    throw new Error('TemplCreated topic hash unavailable');
  }
  return {
    ...variant,
    iface,
    fragment,
    topic
  };
});

const TEMPL_CREATED_TOPICS = FACTORY_EVENT_VARIANTS.map((variant) => variant.topic);
const EVENT_VARIANT_BY_TOPIC = new Map(
  FACTORY_EVENT_VARIANTS.map((variant) => [variant.topic, variant])
);

function normalizeAddress(value, label) {
  if (!value || typeof value !== 'string') {
    throw new Error(`${label} must be provided`);
  }
  const trimmed = value.trim();
  if (!/^0x[a-fA-F0-9]{40}$/.test(trimmed)) {
    throw new Error(`${label} must be a valid 42-character hex address`);
  }
  return hre.ethers.getAddress(trimmed);
}

function toSerializable(value) {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (value && typeof value.toString === 'function' && typeof value !== 'string' && typeof value !== 'boolean') {
    return value.toString();
  }
  return value;
}

function toNumberLike(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  const asString = value?.toString?.();
  if (typeof asString === 'string' && asString !== '') {
    const parsed = Number(asString);
    if (Number.isFinite(parsed)) return parsed;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function mapNumberArray(values) {
  if (!values) return [];
  return Array.from(values, (value) => {
    const numeric = toNumberLike(value);
    if (numeric === undefined) {
      throw new Error('Unable to normalize numeric array value');
    }
    return numeric;
  });
}

function normalizeCurveValue(curve) {
  if (!curve) {
    return undefined;
  }
  if (curve.primary) {
    const style = toNumberLike(curve.primary.style ?? curve.primary[0]);
    const rateBps = toNumberLike(curve.primary.rateBps ?? curve.primary[1]);
    const length = toNumberLike(curve.primary.length ?? curve.primary[2] ?? 0);
    if (style === undefined || rateBps === undefined) return undefined;
    const extrasRaw = curve.additionalSegments ?? curve.extras ?? [];
    const additionalSegments = Array.isArray(extrasRaw)
      ? extrasRaw.map((segment) => {
          if (segment === undefined || segment === null) return undefined;
          if (Array.isArray(segment)) {
            const segStyle = toNumberLike(segment[0]);
            const segRate = toNumberLike(segment[1]);
            const segLength = toNumberLike(segment[2] ?? 0);
            if (segStyle === undefined || segRate === undefined) return undefined;
            return { style: segStyle, rateBps: segRate, length: segLength ?? 0 };
          }
          const segStyle = toNumberLike(segment.style);
          const segRate = toNumberLike(segment.rateBps);
          const segLength = toNumberLike(segment.length ?? 0);
          if (segStyle === undefined || segRate === undefined) return undefined;
          return { style: segStyle, rateBps: segRate, length: segLength ?? 0 };
        }).filter(Boolean)
      : [];
    return { primary: { style, rateBps, length: length ?? 0 }, additionalSegments };
  }
  if (Array.isArray(curve)) {
    if (curve.length === 0) return undefined;
    if (Array.isArray(curve[0])) {
      const [styleRaw, rateRaw, lengthRaw] = curve[0];
      const style = toNumberLike(styleRaw);
      const rateBps = toNumberLike(rateRaw);
      const length = toNumberLike(lengthRaw ?? 0);
      if (style === undefined || rateBps === undefined) return undefined;
      return { primary: { style, rateBps, length: length ?? 0 }, additionalSegments: [] };
    }
    if (curve.length >= 2) {
      const style = toNumberLike(curve[0]);
      const rateBps = toNumberLike(curve[1]);
      const length = toNumberLike(curve[2] ?? 0);
      if (style === undefined || rateBps === undefined) return undefined;
      return { primary: { style, rateBps, length: length ?? 0 }, additionalSegments: [] };
    }
  }
  if ('style' in curve && 'rateBps' in curve) {
    const style = toNumberLike(curve.style);
    const rateBps = toNumberLike(curve.rateBps);
    const length = toNumberLike(curve.length ?? 0);
    if (style === undefined || rateBps === undefined) return undefined;
    return { primary: { style, rateBps, length: length ?? 0 }, additionalSegments: [] };
  }
  return undefined;
}

function firstDefined(values, { allowEmpty = false } = {}) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    if (!allowEmpty && value === '') continue;
    return value;
  }
  return undefined;
}

function readCliOption(argv, flags) {
  for (let i = 2; i < argv.length; i += 1) {
    const current = argv[i];
    if (!flags.includes(current)) continue;
    const next = argv[i + 1];
    if (next && !next.startsWith('-')) {
      return next;
    }
  }
  return undefined;
}

function parseBlockNumber(value) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : undefined;
  if (typeof value === 'bigint') return Number(value < 0n ? 0n : value);
  const trimmed = String(value).trim();
  if (!trimmed) return undefined;
  if (!/^\d+$/.test(trimmed)) return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : undefined;
}

function resolveBpsLike({ bpsValues = [] }) {
  for (const candidate of bpsValues) {
    if (candidate === undefined || candidate === null || candidate === '') continue;
    const numeric = Number(candidate);
    if (Number.isFinite(numeric)) {
      return String(Math.round(numeric));
    }
  }
  return undefined;
}

function resolveBoolean(value) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const trimmed = String(value).trim().toLowerCase();
  if (!trimmed) return undefined;
  return trimmed === '1' || trimmed === 'true' || trimmed === 'yes';
}

function pickTemplAddress(argv) {
  const cli = readCliOption(argv, ['--templ', '--address']);
  if (cli) return cli;
  const envAddress = process.env.TEMPL_ADDRESS || process.env.CONTRACT_ADDRESS;
  if (envAddress) return envAddress;
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg && !arg.startsWith('-')) {
      return arg;
    }
  }
  return undefined;
}

async function safeCall(contract, method, transform = toSerializable) {
  if (!contract || typeof contract[method] !== 'function') return undefined;
  try {
    const result = await contract[method]();
    return transform ? transform(result) : result;
  } catch (err) {
    console.warn(`[verify-templ] Unable to read ${method}: ${err?.message || err}`);
    return undefined;
  }
}

async function fetchContractSnapshot(contract) {
  return {
    priest: await safeCall(contract, 'priest'),
    protocolFeeRecipient: await safeCall(contract, 'protocolFeeRecipient'),
    accessToken: await safeCall(contract, 'accessToken'),
    entryFee: await safeCall(contract, 'entryFee'),
    burnBps: await safeCall(contract, 'burnBps'),
    treasuryBps: await safeCall(contract, 'treasuryBps'),
    memberPoolBps: await safeCall(contract, 'memberPoolBps'),
    protocolBps: await safeCall(contract, 'protocolBps'),
    quorumBps: await safeCall(contract, 'quorumBps'),
    postQuorumVotingPeriod: await safeCall(contract, 'postQuorumVotingPeriod'),
    burnAddress: await safeCall(contract, 'burnAddress'),
    priestIsDictator: await safeCall(contract, 'priestIsDictator', (value) => Boolean(value)),
    maxMembers: await safeCall(contract, 'maxMembers'),
    templName: await safeCall(contract, 'templName'),
    templDescription: await safeCall(contract, 'templDescription'),
    templLogoLink: await safeCall(contract, 'templLogoLink'),
    proposalCreationFeeBps: await safeCall(contract, 'proposalCreationFeeBps'),
    referralShareBps: await safeCall(contract, 'referralShareBps'),
    // Module wiring (immutable in TEMPL constructor)
    membershipModule: await safeCall(contract, 'MEMBERSHIP_MODULE'),
    treasuryModule: await safeCall(contract, 'TREASURY_MODULE'),
    governanceModule: await safeCall(contract, 'GOVERNANCE_MODULE'),
    entryFeeCurve: await safeCall(contract, 'entryFeeCurve', normalizeCurveValue)
  };
}

async function fetchEventSnapshot({ provider, factoryAddress, templAddress, fromBlock }) {
  if (!factoryAddress) return null;
  let factory;
  try {
    factory = normalizeAddress(factoryAddress, 'FACTORY_ADDRESS');
  } catch (err) {
    console.warn(`[verify-templ] Ignoring factory override: ${err?.message || err}`);
    return null;
  }
  const templTopic = hre.ethers.zeroPadValue(templAddress, 32);
  const startBlock = parseBlockNumber(fromBlock)
    ?? parseBlockNumber(process.env.TEMPL_FACTORY_DEPLOYMENT_BLOCK)
    ?? parseBlockNumber(process.env.TRUSTED_FACTORY_DEPLOYMENT_BLOCK)
    ?? 0;
  const filter = {
    address: factory,
    topics: [TEMPL_CREATED_TOPICS, templTopic],
    fromBlock: startBlock
  };
  try {
    const logs = await provider.getLogs(filter);
    for (let i = logs.length - 1; i >= 0; i -= 1) {
      try {
        const log = logs[i];
        const topic = (log?.topics?.[0] || '').toLowerCase();
        const variant = EVENT_VARIANT_BY_TOPIC.get(topic);
        if (!variant) continue;
        const parsed = variant.iface.parseLog(log);
        const args = parsed?.args;
        if (!args) continue;
        const curveStyles = mapNumberArray(args.curveStyles ?? []);
        const curveRatesRaw = mapNumberArray(args.curveRateBps ?? []);
        const curveLengthsRaw = mapNumberArray(args.curveLengths ?? []);
        if (curveStyles.length === 0) {
          throw new Error('Factory logs did not include curveStyles; expected current TemplCreated signature');
        }
        let curveRates = curveRatesRaw;
        let curveLengths = curveLengthsRaw;
        if (curveRates.length < curveStyles.length) {
          const padded = new Array(curveStyles.length).fill(0);
          for (let i = 0; i < curveRates.length; i++) padded[i] = curveRates[i];
          curveRates = padded;
        }
        if (curveLengths.length < curveStyles.length) {
          const padded = new Array(curveStyles.length).fill(0);
          for (let i = 0; i < curveLengths.length; i++) padded[i] = curveLengths[i];
          curveLengths = padded;
        }

        return {
          priest: args.priest,
          accessToken: args.token,
          entryFee: toSerializable(args.entryFee),
          burnBps: toSerializable(args.burnBps),
          treasuryBps: toSerializable(args.treasuryBps),
          memberPoolBps: toSerializable(args.memberPoolBps),
          quorumBps: toSerializable(args.quorumBps),
          postQuorumVotingPeriod: toSerializable(args.executionDelaySeconds),
          burnAddress: args.burnAddress,
          priestIsDictator: Boolean(args.priestIsDictator),
          maxMembers: toSerializable(args.maxMembers),
          templName: args.name ?? '',
          templDescription: args.description ?? '',
          templLogoLink: args.logoLink ?? '',
          proposalFeeBps: toSerializable(args.proposalFeeBps ?? args.proposalFee),
          referralShareBps: toSerializable(args.referralShareBps),
          curveStyles,
          curveRates,
          curveLengths
        };
      } catch (err) {
        console.warn('[verify-templ] Failed to parse factory log:', err?.message || err);
      }
    }
  } catch (err) {
    console.warn('[verify-templ] Unable to load factory logs:', err?.message || err);
  }
  return null;
}

function resolveField({ label, contractValue, eventValue, overrideValue, fallbackValue, normalizer, allowEmpty = false }) {
  const raw = firstDefined(
    [contractValue, eventValue, overrideValue, fallbackValue],
    { allowEmpty }
  );
  if (raw === undefined) {
    throw new Error(`Missing constructor argument: ${label}`);
  }
  return normalizer ? normalizer(raw) : raw;
}

async function main() {
  const templArg = pickTemplAddress(process.argv);
  if (!templArg) {
    throw new Error('Templ address is required. Use --templ 0x... or set TEMPL_ADDRESS');
  }
  const templAddress = normalizeAddress(templArg, 'TEMPL_ADDRESS');

  const provider = hre.ethers.provider;
  const code = await provider.getCode(templAddress);
  if (!code || code === '0x') {
    throw new Error(`No contract deployed at ${templAddress}`);
  }

  const contract = await hre.ethers.getContractAt('TEMPL', templAddress);
  const contractSnapshot = await fetchContractSnapshot(contract);

  const factoryOverride = readCliOption(process.argv, ['--factory', '--templ-factory']);
  const fromBlockOverride = readCliOption(process.argv, ['--from-block']);
  const eventSnapshot = await fetchEventSnapshot({
    provider,
    factoryAddress: firstDefined([factoryOverride, process.env.FACTORY_ADDRESS]),
    templAddress,
    fromBlock: fromBlockOverride
  });

  const cliOverrides = {
    priest: readCliOption(process.argv, ['--priest']),
    accessToken: readCliOption(process.argv, ['--token', '--access-token']),
    entryFee: readCliOption(process.argv, ['--entry-fee']),
    burnBps: readCliOption(process.argv, ['--burn-bps']),
    treasuryBps: readCliOption(process.argv, ['--treasury-bps']),
    memberBps: readCliOption(process.argv, ['--member-bps']),
    quorumBps: readCliOption(process.argv, ['--quorum-bps']),
    postQuorum: readCliOption(process.argv, ['--post-quorum-voting-period', '--post-quorum-seconds', '--post-quorum']),
    burnAddress: readCliOption(process.argv, ['--burn-address']),
    priestIsDictator: readCliOption(process.argv, ['--dictator', '--priest-is-dictator']),
    maxMembers: readCliOption(process.argv, ['--max-members']),
    templName: readCliOption(process.argv, ['--templ-name', '--name']),
    templDescription: readCliOption(process.argv, ['--templ-description', '--description']),
    templLogoLink: readCliOption(process.argv, ['--templ-logo', '--logo-link']),
    proposalFeeBps: readCliOption(process.argv, ['--proposal-fee-bps']),
    referralShareBps: readCliOption(process.argv, ['--referral-share-bps', '--referral-bps']),
    membershipModule: readCliOption(process.argv, ['--membership-module']),
    treasuryModule: readCliOption(process.argv, ['--treasury-module']),
    governanceModule: readCliOption(process.argv, ['--governance-module'])
  };

  const protocolRecipientOverride = firstDefined([
    readCliOption(process.argv, ['--protocol-recipient', '--protocol-fee-recipient']),
    process.env.PROTOCOL_FEE_RECIPIENT
  ]);

  const protocolPercentOverride = resolveBpsLike({ bpsValues: [readCliOption(process.argv, ['--protocol-bps']), process.env.PROTOCOL_BPS] });

  const envOverrides = {
    priest: firstDefined([cliOverrides.priest, process.env.PRIEST_ADDRESS]),
    accessToken: firstDefined([cliOverrides.accessToken, process.env.TOKEN_ADDRESS]),
    entryFee: firstDefined([cliOverrides.entryFee, process.env.ENTRY_FEE]),
    burnBps: resolveBpsLike({ bpsValues: [cliOverrides.burnBps, process.env.BURN_BPS] }),
    treasuryBps: resolveBpsLike({ bpsValues: [cliOverrides.treasuryBps, process.env.TREASURY_BPS] }),
    memberPoolBps: resolveBpsLike({ bpsValues: [cliOverrides.memberBps, process.env.MEMBER_POOL_BPS] }),
    quorumBps: resolveBpsLike({ bpsValues: [cliOverrides.quorumBps, process.env.QUORUM_BPS] }),
    postQuorumVotingPeriod: firstDefined([cliOverrides.postQuorum, process.env.POST_QUORUM_VOTING_PERIOD_SECONDS]),
    burnAddress: firstDefined([cliOverrides.burnAddress, process.env.BURN_ADDRESS]),
    priestIsDictator: firstDefined([
      resolveBoolean(cliOverrides.priestIsDictator),
      resolveBoolean(process.env.PRIEST_IS_DICTATOR)
    ]),
    maxMembers: firstDefined([cliOverrides.maxMembers, process.env.MAX_MEMBERS]),
    templName: firstDefined([cliOverrides.templName, process.env.TEMPL_NAME]),
    templDescription: firstDefined([cliOverrides.templDescription, process.env.TEMPL_DESCRIPTION]),
    templLogoLink: firstDefined([cliOverrides.templLogoLink, process.env.TEMPL_LOGO_LINK]),
    proposalFeeBps: resolveBpsLike({ bpsValues: [cliOverrides.proposalFeeBps, process.env.PROPOSAL_FEE_BPS] }),
    referralShareBps: resolveBpsLike({ bpsValues: [cliOverrides.referralShareBps, process.env.REFERRAL_SHARE_BPS] }),
    membershipModule: firstDefined([cliOverrides.membershipModule, process.env.MEMBERSHIP_MODULE_ADDRESS]),
    treasuryModule: firstDefined([cliOverrides.treasuryModule, process.env.TREASURY_MODULE_ADDRESS]),
    governanceModule: firstDefined([cliOverrides.governanceModule, process.env.GOVERNANCE_MODULE_ADDRESS])
  };

  const constructorArgs = {
    priest: resolveField({
      label: 'priest',
      contractValue: contractSnapshot.priest,
      eventValue: eventSnapshot?.priest,
      overrideValue: envOverrides.priest,
      normalizer: (value) => normalizeAddress(value, 'priest')
    }),
    protocolFeeRecipient: resolveField({
      label: 'protocolFeeRecipient',
      contractValue: contractSnapshot.protocolFeeRecipient,
      eventValue: undefined,
      overrideValue: protocolRecipientOverride,
      normalizer: (value) => normalizeAddress(value, 'protocolFeeRecipient')
    }),
    accessToken: resolveField({
      label: 'accessToken',
      contractValue: contractSnapshot.accessToken,
      eventValue: eventSnapshot?.accessToken,
      overrideValue: envOverrides.accessToken,
      normalizer: (value) => normalizeAddress(value, 'accessToken')
    }),
    entryFee: resolveField({
      label: 'entryFee',
      contractValue: contractSnapshot.entryFee,
      eventValue: eventSnapshot?.entryFee,
      overrideValue: envOverrides.entryFee,
      normalizer: (value) => toSerializable(value)
    }),
    burnBps: resolveField({
      label: 'burnBps',
      contractValue: contractSnapshot.burnBps,
      eventValue: eventSnapshot?.burnBps,
      overrideValue: envOverrides.burnBps,
      normalizer: (value) => toSerializable(value)
    }),
    treasuryBps: resolveField({
      label: 'treasuryBps',
      contractValue: contractSnapshot.treasuryBps,
      eventValue: eventSnapshot?.treasuryBps,
      overrideValue: envOverrides.treasuryBps,
      normalizer: (value) => toSerializable(value)
    }),
    memberPoolBps: resolveField({
      label: 'memberPoolBps',
      contractValue: contractSnapshot.memberPoolBps,
      eventValue: eventSnapshot?.memberPoolBps,
      overrideValue: envOverrides.memberPoolBps,
      normalizer: (value) => toSerializable(value)
    }),
    protocolBps: resolveField({
      label: 'protocolBps',
      contractValue: contractSnapshot.protocolBps,
      eventValue: undefined,
      overrideValue: protocolPercentOverride,
      normalizer: (value) => toSerializable(value)
    }),
    quorumBps: resolveField({
      label: 'quorumBps',
      contractValue: contractSnapshot.quorumBps,
      eventValue: eventSnapshot?.quorumBps,
      overrideValue: envOverrides.quorumBps,
      normalizer: (value) => toSerializable(value)
    }),
    postQuorumVotingPeriod: resolveField({
      label: 'postQuorumVotingPeriod',
      contractValue: contractSnapshot.postQuorumVotingPeriod,
      eventValue: eventSnapshot?.postQuorumVotingPeriod,
      overrideValue: envOverrides.postQuorumVotingPeriod,
      normalizer: (value) => toSerializable(value)
    }),
    burnAddress: resolveField({
      label: 'burnAddress',
      contractValue: contractSnapshot.burnAddress,
      eventValue: eventSnapshot?.burnAddress,
      overrideValue: envOverrides.burnAddress,
      normalizer: (value) => normalizeAddress(value, 'burnAddress')
    }),
    priestIsDictator: resolveField({
      label: 'priestIsDictator',
      contractValue: contractSnapshot.priestIsDictator,
      eventValue: eventSnapshot?.priestIsDictator,
      overrideValue: envOverrides.priestIsDictator,
      normalizer: (value) => Boolean(value)
    }),
    maxMembers: resolveField({
      label: 'maxMembers',
      contractValue: contractSnapshot.maxMembers,
      eventValue: eventSnapshot?.maxMembers,
      overrideValue: envOverrides.maxMembers,
      normalizer: (value) => toSerializable(value)
    }),
    templName: resolveField({
      label: 'templName',
      contractValue: contractSnapshot.templName,
      eventValue: eventSnapshot?.templName,
      overrideValue: envOverrides.templName,
      fallbackValue: 'Templ',
      normalizer: (value) => String(value),
      allowEmpty: false
    }),
    templDescription: resolveField({
      label: 'templDescription',
      contractValue: contractSnapshot.templDescription,
      eventValue: eventSnapshot?.templDescription,
      overrideValue: envOverrides.templDescription,
      fallbackValue: '',
      normalizer: (value) => String(value),
      allowEmpty: true
    }),
    templLogoLink: resolveField({
      label: 'templLogoLink',
      contractValue: contractSnapshot.templLogoLink,
      eventValue: eventSnapshot?.templLogoLink,
      overrideValue: envOverrides.templLogoLink,
      fallbackValue: '',
      normalizer: (value) => String(value),
      allowEmpty: true
    }),
    proposalFeeBps: resolveField({
      label: 'proposalFeeBps',
      contractValue: contractSnapshot.proposalCreationFeeBps,
      eventValue: eventSnapshot?.proposalFeeBps,
      overrideValue: envOverrides.proposalFeeBps,
      fallbackValue: 0,
      normalizer: (value) => {
        const numeric = toNumberLike(value);
        if (numeric === undefined) throw new Error('proposalFeeBps must be numeric');
        return numeric;
      }
    }),
    referralShareBps: resolveField({
      label: 'referralShareBps',
      contractValue: contractSnapshot.referralShareBps,
      eventValue: eventSnapshot?.referralShareBps,
      overrideValue: envOverrides.referralShareBps,
      fallbackValue: 0,
      normalizer: (value) => {
        const numeric = toNumberLike(value);
        if (numeric === undefined) throw new Error('referralShareBps must be numeric');
        return numeric;
      }
    }),
    // Module addresses
    membershipModule: resolveField({
      label: 'membershipModule',
      contractValue: contractSnapshot.membershipModule,
      eventValue: undefined,
      overrideValue: envOverrides.membershipModule,
      normalizer: (value) => normalizeAddress(value, 'membershipModule')
    }),
    treasuryModule: resolveField({
      label: 'treasuryModule',
      contractValue: contractSnapshot.treasuryModule,
      eventValue: undefined,
      overrideValue: envOverrides.treasuryModule,
      normalizer: (value) => normalizeAddress(value, 'treasuryModule')
    }),
    governanceModule: resolveField({
      label: 'governanceModule',
      contractValue: contractSnapshot.governanceModule,
      eventValue: undefined,
      overrideValue: envOverrides.governanceModule,
      normalizer: (value) => normalizeAddress(value, 'governanceModule')
    })
  };

  let normalizedCurve = normalizeCurveValue(contractSnapshot.entryFeeCurve);
  if (!normalizedCurve && eventSnapshot) {
    const styles = eventSnapshot.curveStyles || [];
    const rates = eventSnapshot.curveRates || [];
    const lengths = eventSnapshot.curveLengths || [];
    if (styles.length === 0) throw new Error('Factory logs missing curve arrays');
    const segments = styles.map((style, index) => ({
      style,
      rateBps: rates[index] ?? 0,
      length: lengths[index] ?? 0
    }));
    const [primary, ...rest] = segments;
    normalizedCurve = { primary, additionalSegments: rest };
  }
  if (!normalizedCurve) {
    throw new Error('Unable to determine curve configuration; provide deployment details or update verify script overrides.');
  }
  const curveArgumentPrimary = [
    normalizedCurve.primary.style,
    normalizedCurve.primary.rateBps,
    normalizedCurve.primary.length ?? 0
  ];
  const curveArgumentExtras = (normalizedCurve.additionalSegments || []).map((segment) => [
    segment.style,
    segment.rateBps,
    segment.length ?? 0
  ]);
  const curveArgument = [curveArgumentPrimary, curveArgumentExtras];

  console.log('Verifying templ with constructor arguments:');
  console.table({
    ...constructorArgs,
    curvePrimary: JSON.stringify(curveArgumentPrimary),
    curveSegments: JSON.stringify(curveArgumentExtras)
  });
  console.log('Curve argument:', curveArgument);

  const constructorArguments = [
    constructorArgs.priest,
    constructorArgs.protocolFeeRecipient,
    constructorArgs.accessToken,
    constructorArgs.entryFee,
    constructorArgs.burnBps,
    constructorArgs.treasuryBps,
    constructorArgs.memberPoolBps,
    constructorArgs.protocolBps,
    constructorArgs.quorumBps,
    constructorArgs.postQuorumVotingPeriod,
    constructorArgs.burnAddress,
    constructorArgs.priestIsDictator,
    constructorArgs.maxMembers,
    constructorArgs.templName,
    constructorArgs.templDescription,
    constructorArgs.templLogoLink,
    constructorArgs.proposalFeeBps,
    constructorArgs.referralShareBps,
    constructorArgs.membershipModule,
    constructorArgs.treasuryModule,
    constructorArgs.governanceModule,
    curveArgument
  ];

  try {
    // Verify modules (no constructor args)
    console.log('Verifying modules...');
    try {
      await hre.run('verify:verify', {
        address: constructorArgs.membershipModule,
        contract: 'contracts/TemplMembership.sol:TemplMembershipModule'
      });
      console.log(`Verified Membership module at ${constructorArgs.membershipModule}`);
    } catch (err) {
      const message = err?.message || String(err);
      if (/already verified/i.test(message)) {
        console.log(`Membership module ${constructorArgs.membershipModule} is already verified.`);
      } else {
        throw err;
      }
    }
    try {
      await hre.run('verify:verify', {
        address: constructorArgs.treasuryModule,
        contract: 'contracts/TemplTreasury.sol:TemplTreasuryModule'
      });
      console.log(`Verified Treasury module at ${constructorArgs.treasuryModule}`);
    } catch (err) {
      const message = err?.message || String(err);
      if (/already verified/i.test(message)) {
        console.log(`Treasury module ${constructorArgs.treasuryModule} is already verified.`);
      } else {
        throw err;
      }
    }
    try {
      await hre.run('verify:verify', {
        address: constructorArgs.governanceModule,
        contract: 'contracts/TemplGovernance.sol:TemplGovernanceModule'
      });
      console.log(`Verified Governance module at ${constructorArgs.governanceModule}`);
    } catch (err) {
      const message = err?.message || String(err);
      if (/already verified/i.test(message)) {
        console.log(`Governance module ${constructorArgs.governanceModule} is already verified.`);
      } else {
        throw err;
      }
    }

    await hre.run('verify:verify', {
      address: templAddress,
      contract: 'contracts/TEMPL.sol:TEMPL',
      constructorArguments
    });
    console.log(`Verification submitted for ${templAddress}`);
  } catch (err) {
    const message = err?.message || String(err);
    if (/already verified/i.test(message)) {
      console.log(`Contract ${templAddress} is already verified.`);
    } else {
      throw err;
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Verification failed:', error);
    process.exit(1);
  });
