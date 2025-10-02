const hre = require("hardhat");
require("dotenv").config();

const factoryArtifact = require("../artifacts/contracts/TemplFactory.sol/TemplFactory.json");

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

function resolvePercentLike({ bpsValues = [], percentValues = [] }) {
  for (const candidate of bpsValues) {
    if (candidate === undefined || candidate === null || candidate === '') continue;
    const numeric = Number(candidate);
    if (Number.isFinite(numeric)) {
      return String(Math.round(numeric));
    }
  }
  for (const candidate of percentValues) {
    if (candidate === undefined || candidate === null || candidate === '') continue;
    const numeric = Number(candidate);
    if (Number.isFinite(numeric)) {
      return String(Math.round(numeric * 100));
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
    burnPercent: await safeCall(contract, 'burnPercent'),
    treasuryPercent: await safeCall(contract, 'treasuryPercent'),
    memberPoolPercent: await safeCall(contract, 'memberPoolPercent'),
    protocolPercent: await safeCall(contract, 'protocolPercent'),
    quorumPercent: await safeCall(contract, 'quorumPercent'),
    executionDelayAfterQuorum: await safeCall(contract, 'executionDelayAfterQuorum'),
    burnAddress: await safeCall(contract, 'burnAddress'),
    priestIsDictator: await safeCall(contract, 'priestIsDictator', (value) => Boolean(value)),
    maxMembers: await safeCall(contract, 'MAX_MEMBERS'),
    templHomeLink: await safeCall(contract, 'templHomeLink')
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
  const topic0 = hre.ethers.id('TemplCreated(address,address,address,address,uint256,uint256,uint256,uint256,uint256,uint256,address,bool,uint256,string)');
  const templTopic = hre.ethers.zeroPadValue(templAddress, 32);
  const iface = new hre.ethers.Interface(factoryArtifact.abi);
  const startBlock = parseBlockNumber(fromBlock)
    ?? parseBlockNumber(process.env.TEMPL_FACTORY_DEPLOYMENT_BLOCK)
    ?? parseBlockNumber(process.env.TRUSTED_FACTORY_DEPLOYMENT_BLOCK)
    ?? 0;
  const filter = {
    address: factory,
    topics: [topic0, templTopic],
    fromBlock: startBlock
  };
  try {
    const logs = await provider.getLogs(filter);
    for (let i = logs.length - 1; i >= 0; i -= 1) {
      try {
        const parsed = iface.parseLog(logs[i]);
        const args = parsed?.args;
        if (!args) continue;
        return {
          priest: args.priest,
          accessToken: args.token,
          entryFee: toSerializable(args.entryFee),
          burnPercent: toSerializable(args.burnPercent),
          treasuryPercent: toSerializable(args.treasuryPercent),
          memberPoolPercent: toSerializable(args.memberPoolPercent),
          quorumPercent: toSerializable(args.quorumPercent),
          executionDelayAfterQuorum: toSerializable(args.executionDelaySeconds),
          burnAddress: args.burnAddress,
          priestIsDictator: Boolean(args.priestIsDictator),
          maxMembers: toSerializable(args.maxMembers),
          templHomeLink: args.homeLink ?? ''
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
    factoryAddress: firstDefined(
      [factoryOverride, process.env.FACTORY_ADDRESS, process.env.TEMPL_FACTORY_ADDRESS, process.env.TRUSTED_FACTORY_ADDRESS]
    ),
    templAddress,
    fromBlock: fromBlockOverride
  });

  const cliOverrides = {
    priest: readCliOption(process.argv, ['--priest']),
    accessToken: readCliOption(process.argv, ['--token', '--access-token']),
    entryFee: readCliOption(process.argv, ['--entry-fee']),
    burnBps: readCliOption(process.argv, ['--burn-bps', '--burn-percent-bps']),
    burnPercent: readCliOption(process.argv, ['--burn-percent']),
    treasuryBps: readCliOption(process.argv, ['--treasury-bps', '--treasury-percent-bps']),
    treasuryPercent: readCliOption(process.argv, ['--treasury-percent']),
    memberBps: readCliOption(process.argv, ['--member-bps', '--member-percent-bps']),
    memberPercent: readCliOption(process.argv, ['--member-percent']),
    quorumBps: readCliOption(process.argv, ['--quorum-bps']),
    quorumPercent: readCliOption(process.argv, ['--quorum-percent']),
    executionDelay: readCliOption(process.argv, ['--execution-delay', '--execution-delay-seconds']),
    burnAddress: readCliOption(process.argv, ['--burn-address']),
    priestIsDictator: readCliOption(process.argv, ['--dictator', '--priest-is-dictator']),
    maxMembers: readCliOption(process.argv, ['--max-members']),
    templHomeLink: readCliOption(process.argv, ['--home-link'])
  };

  const protocolRecipientOverride = firstDefined([
    readCliOption(process.argv, ['--protocol-recipient', '--protocol-fee-recipient']),
    process.env.PROTOCOL_FEE_RECIPIENT,
    process.env.TEMPL_FACTORY_PROTOCOL_RECIPIENT,
    process.env.PROTOCOL_RECIPIENT
  ]);

  const protocolPercentOverride = resolvePercentLike({
    bpsValues: [
      readCliOption(process.argv, ['--protocol-bps', '--protocol-percent-bps']),
      process.env.PROTOCOL_BP,
      process.env.PROTOCOL_PERCENT_BPS,
      process.env.TEMPL_FACTORY_PROTOCOL_PERCENT
    ],
    percentValues: [
      readCliOption(process.argv, ['--protocol-percent']),
      process.env.PROTOCOL_PERCENT
    ]
  });

  const envOverrides = {
    priest: firstDefined([cliOverrides.priest, process.env.PRIEST_ADDRESS]),
    accessToken: firstDefined([cliOverrides.accessToken, process.env.TOKEN_ADDRESS]),
    entryFee: firstDefined([cliOverrides.entryFee, process.env.ENTRY_FEE]),
    burnPercent: resolvePercentLike({
      bpsValues: [cliOverrides.burnBps, process.env.BURN_BP],
      percentValues: [cliOverrides.burnPercent, process.env.BURN_PERCENT]
    }),
    treasuryPercent: resolvePercentLike({
      bpsValues: [cliOverrides.treasuryBps, process.env.TREASURY_BP],
      percentValues: [cliOverrides.treasuryPercent, process.env.TREASURY_PERCENT]
    }),
    memberPoolPercent: resolvePercentLike({
      bpsValues: [cliOverrides.memberBps, process.env.MEMBER_POOL_BP],
      percentValues: [cliOverrides.memberPercent, process.env.MEMBER_POOL_PERCENT]
    }),
    quorumPercent: resolvePercentLike({
      bpsValues: [cliOverrides.quorumBps],
      percentValues: [cliOverrides.quorumPercent, process.env.QUORUM_PERCENT]
    }),
    executionDelayAfterQuorum: firstDefined([cliOverrides.executionDelay, process.env.EXECUTION_DELAY_SECONDS]),
    burnAddress: firstDefined([cliOverrides.burnAddress, process.env.BURN_ADDRESS]),
    priestIsDictator: firstDefined([
      resolveBoolean(cliOverrides.priestIsDictator),
      resolveBoolean(process.env.PRIEST_IS_DICTATOR)
    ]),
    maxMembers: firstDefined([cliOverrides.maxMembers, process.env.MAX_MEMBERS]),
    templHomeLink: firstDefined([
      cliOverrides.templHomeLink,
      process.env.TEMPL_HOME_LINK,
      process.env.HOME_LINK
    ], { allowEmpty: true })
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
    burnPercent: resolveField({
      label: 'burnPercent',
      contractValue: contractSnapshot.burnPercent,
      eventValue: eventSnapshot?.burnPercent,
      overrideValue: envOverrides.burnPercent,
      normalizer: (value) => toSerializable(value)
    }),
    treasuryPercent: resolveField({
      label: 'treasuryPercent',
      contractValue: contractSnapshot.treasuryPercent,
      eventValue: eventSnapshot?.treasuryPercent,
      overrideValue: envOverrides.treasuryPercent,
      normalizer: (value) => toSerializable(value)
    }),
    memberPoolPercent: resolveField({
      label: 'memberPoolPercent',
      contractValue: contractSnapshot.memberPoolPercent,
      eventValue: eventSnapshot?.memberPoolPercent,
      overrideValue: envOverrides.memberPoolPercent,
      normalizer: (value) => toSerializable(value)
    }),
    protocolPercent: resolveField({
      label: 'protocolPercent',
      contractValue: contractSnapshot.protocolPercent,
      eventValue: undefined,
      overrideValue: protocolPercentOverride,
      normalizer: (value) => toSerializable(value)
    }),
    quorumPercent: resolveField({
      label: 'quorumPercent',
      contractValue: contractSnapshot.quorumPercent,
      eventValue: eventSnapshot?.quorumPercent,
      overrideValue: envOverrides.quorumPercent,
      normalizer: (value) => toSerializable(value)
    }),
    executionDelayAfterQuorum: resolveField({
      label: 'executionDelayAfterQuorum',
      contractValue: contractSnapshot.executionDelayAfterQuorum,
      eventValue: eventSnapshot?.executionDelayAfterQuorum,
      overrideValue: envOverrides.executionDelayAfterQuorum,
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
    templHomeLink: resolveField({
      label: 'templHomeLink',
      contractValue: contractSnapshot.templHomeLink,
      eventValue: eventSnapshot?.templHomeLink,
      overrideValue: envOverrides.templHomeLink,
      fallbackValue: '',
      normalizer: (value) => String(value),
      allowEmpty: true
    })
  };

  console.log('Verifying templ with constructor arguments:');
  console.table(constructorArgs);

  const constructorArguments = [
    constructorArgs.priest,
    constructorArgs.protocolFeeRecipient,
    constructorArgs.accessToken,
    constructorArgs.entryFee,
    constructorArgs.burnPercent,
    constructorArgs.treasuryPercent,
    constructorArgs.memberPoolPercent,
    constructorArgs.protocolPercent,
    constructorArgs.quorumPercent,
    constructorArgs.executionDelayAfterQuorum,
    constructorArgs.burnAddress,
    constructorArgs.priestIsDictator,
    constructorArgs.maxMembers,
    constructorArgs.templHomeLink
  ];

  try {
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
