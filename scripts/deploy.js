const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const DEFAULT_BURN_PERCENT = 30;
const DEFAULT_TREASURY_PERCENT = 30;
const DEFAULT_MEMBER_POOL_PERCENT = 30;
const USE_DEFAULT_PERCENT = -1;
const CURVE_STYLE_INDEX = {
  static: 0,
  linear: 1,
  exponential: 2
};

function parseFiniteNumber(input, label) {
  if (input === undefined || input === null) {
    throw new Error(`${label} must be provided`);
  }
  const trimmed = String(input).trim();
  if (trimmed === '') {
    throw new Error(`${label} must not be empty`);
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a finite number`);
  }
  return parsed;
}

function parseBoolean(value) {
  if (value === undefined || value === null) return false;
  const trimmed = String(value).trim();
  if (trimmed === '') return false;
  return /^(?:1|true|yes)$/i.test(trimmed);
}

function resolvePercentToBps({ label, percentSource, bpsSource, defaultBps = 0 }) {
  const percentCandidate = percentSource ?? '';
  if (percentCandidate !== undefined && percentCandidate !== null && String(percentCandidate).trim() !== '') {
    const asNumber = parseFiniteNumber(percentCandidate, label);
    if (asNumber < 0 || asNumber > 100) {
      throw new Error(`${label} percent must be between 0 and 100`);
    }
    return Math.round(asNumber * 100);
  }

  const bpsCandidate = bpsSource ?? '';
  if (bpsCandidate !== undefined && bpsCandidate !== null && String(bpsCandidate).trim() !== '') {
    const asNumber = parseFiniteNumber(bpsCandidate, `${label} (bps)`);
    if (asNumber < 0 || asNumber > 10_000) {
      throw new Error(`${label} basis points must be between 0 and 10,000`);
    }
    return Math.round(asNumber);
  }

  if (defaultBps < 0 || defaultBps > 10_000) {
    throw new Error(`${label} default basis points must be between 0 and 10,000`);
  }
  return defaultBps;
}

function resolveCurveConfigFromEnv() {
  const styleInput = (process.env.CURVE_PRIMARY_STYLE || process.env.CURVE_STYLE || '').trim().toLowerCase();
  const rateInputRaw = process.env.CURVE_PRIMARY_RATE_BPS ?? process.env.CURVE_RATE_BPS;
  const providedFlag = parseBoolean(process.env.CURVE_PROVIDED);

  const hasStyleOverride = styleInput !== '';
  const hasRateOverride = rateInputRaw !== undefined && String(rateInputRaw).trim() !== '';
  const shouldProvideCurve = providedFlag || hasStyleOverride || hasRateOverride;

  if (!shouldProvideCurve) {
    return {
      curveProvided: false,
      curve: {
        primary: { style: CURVE_STYLE_INDEX.static, rateBps: 0, length: 0 },
        additionalSegments: []
      },
      description: 'factory default'
    };
  }

  if (!hasStyleOverride && providedFlag) {
    throw new Error('CURVE_PROVIDED is set but CURVE_PRIMARY_STYLE is missing');
  }

  const styleKey = hasStyleOverride ? styleInput : 'exponential';
  const resolvedStyle = CURVE_STYLE_INDEX[styleKey];
  if (resolvedStyle === undefined) {
    throw new Error(`Unsupported CURVE_PRIMARY_STYLE "${styleInput}". Use static, linear, or exponential.`);
  }

  let resolvedRate;
  if (hasRateOverride) {
    const parsedRate = Number(String(rateInputRaw).trim());
    if (!Number.isFinite(parsedRate)) {
      throw new Error('CURVE_PRIMARY_RATE_BPS must be a finite number');
    }
    if (parsedRate < 0 || parsedRate > 1_000_000) {
      throw new Error('CURVE_PRIMARY_RATE_BPS must be between 0 and 1_000_000');
    }
    resolvedRate = Math.round(parsedRate);
  } else if (resolvedStyle === CURVE_STYLE_INDEX.static) {
    resolvedRate = 0;
  } else if (resolvedStyle === CURVE_STYLE_INDEX.linear) {
    resolvedRate = 500;
  } else {
    resolvedRate = 11_000;
  }

  if (resolvedStyle === CURVE_STYLE_INDEX.static && resolvedRate !== 0) {
    throw new Error('Static curve must use CURVE_PRIMARY_RATE_BPS=0');
  }
  if (resolvedStyle === CURVE_STYLE_INDEX.exponential && resolvedRate === 0) {
    throw new Error('Exponential curve requires CURVE_PRIMARY_RATE_BPS > 0');
  }

  return {
    curveProvided: true,
    curve: {
      primary: {
        style: resolvedStyle,
        rateBps: resolvedRate,
        length: 0
      },
      additionalSegments: []
    },
    description: `${styleKey} @ ${resolvedRate} bps`
  };
}

function resolveProtocolPercentFromEnv() {
  const percentInput = (process.env.PROTOCOL_PERCENT ?? '').trim();
  const bpsInput = (process.env.PROTOCOL_BP ?? '').trim();

  if (percentInput) {
    const parsedPercent = Number(percentInput);
    if (!Number.isFinite(parsedPercent)) {
      throw new Error('PROTOCOL_PERCENT must be a valid number');
    }
    if (parsedPercent < 0 || parsedPercent > 100) {
      throw new Error('PROTOCOL_PERCENT must be between 0 and 100');
    }
    return {
      percent: parsedPercent,
      bps: Math.round(parsedPercent * 100),
      source: 'percent'
    };
  }

  if (bpsInput) {
    const parsedBps = Number(bpsInput);
    if (!Number.isFinite(parsedBps)) {
      throw new Error('PROTOCOL_BP must be a valid number');
    }
    if (parsedBps < 0 || parsedBps > 10_000) {
      throw new Error('PROTOCOL_BP must be between 0 and 10_000');
    }
    const roundedBps = Math.round(parsedBps);
    return {
      percent: roundedBps / 100,
      bps: roundedBps,
      source: 'bps'
    };
  }

  return {
    percent: 10,
    bps: 1_000,
    source: 'default'
  };
}

function readSplitPercent(label, percentEnv, bpsEnv, defaultPercent) {
  const trimmedPercent = percentEnv?.trim?.();
  if (trimmedPercent && trimmedPercent !== '') {
    const parsed = Number(trimmedPercent);
    if (!Number.isFinite(parsed)) {
      throw new Error(`${label} must be a valid number`);
    }
    if (parsed === USE_DEFAULT_PERCENT) {
      return {
        configValue: USE_DEFAULT_PERCENT,
        resolvedPercent: defaultPercent,
        resolvedBps: defaultPercent * 100,
        usedDefault: true
      };
    }
    if (parsed < 0 || parsed > 100) {
      throw new Error(`${label} must be between 0 and 100`);
    }
    return {
      configValue: Math.round(parsed * 100),
      resolvedPercent: parsed,
      resolvedBps: Math.round(parsed * 100),
      usedDefault: false
    };
  }

  const trimmedBps = bpsEnv?.trim?.();
  if (trimmedBps && trimmedBps !== '') {
    const parsedBps = Number(trimmedBps);
    if (!Number.isFinite(parsedBps)) {
      throw new Error(`${label} (basis points) must be a valid number`);
    }
    if (parsedBps === USE_DEFAULT_PERCENT) {
      return {
        configValue: USE_DEFAULT_PERCENT,
        resolvedPercent: defaultPercent,
        resolvedBps: defaultPercent * 100,
        usedDefault: true
      };
    }
    if (parsedBps < 0 || parsedBps > 10_000) {
      throw new Error(`${label} basis points must be between 0 and 10_000`);
    }
    return {
      configValue: parsedBps,
      resolvedPercent: parsedBps / 100,
      resolvedBps: parsedBps,
      usedDefault: false
    };
  }

  return {
    configValue: defaultPercent * 100,
    resolvedPercent: defaultPercent,
    resolvedBps: defaultPercent * 100,
    usedDefault: true
  };
}

async function waitForContractCode(address, provider, attempts = 20, delayMs = 3000) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const code = await provider.getCode(address);
    if (code && code !== '0x') {
      return;
    }
    if (attempt === 0) {
      console.log(`Waiting for on-chain code at ${address} ...`);
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(`Timed out waiting for contract code at ${address}`);
}

async function registerTemplWithBackend({
  backendUrl,
  templAddress,
  signer,
  priestAddress,
  chainId,
  telegramChatId,
  templName,
  templDescription,
  templLogoLink,
  proposalFeeBps,
  referralShareBps
}) {
  if (!backendUrl) return null;
  const baseUrl = backendUrl.replace(/\/$/, '');
  const { buildCreateTypedData } = await import('../shared/signing.js');
  const typed = buildCreateTypedData({ chainId, contractAddress: templAddress.toLowerCase() });
  const signature = await signer.signTypedData(typed.domain, typed.types, typed.message);
  const payload = {
    contractAddress: templAddress,
    priestAddress,
    signature,
    chainId,
    nonce: typed.message.nonce,
    issuedAt: typed.message.issuedAt,
    expiry: typed.message.expiry
  };
  if (telegramChatId) {
    payload.telegramChatId = telegramChatId;
  }
  payload.templName = templName;
  payload.templDescription = templDescription;
  payload.templLogoLink = templLogoLink;
  payload.proposalFeeBps = proposalFeeBps;
  payload.referralShareBps = referralShareBps;

  const response = await fetch(`${baseUrl}/templs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Backend registration failed (${response.status} ${response.statusText}): ${text}`.trim());
  }
  return response.json();
}

async function main() {
  const signers = await hre.ethers.getSigners();
  const deployer = signers[0];
  if (!deployer) {
    throw new Error(
      "No Hardhat signer available. Set PRIVATE_KEY in your environment or configure accounts for this network."
    );
  }
  const PRIEST_ADDRESS = process.env.PRIEST_ADDRESS || deployer.address;
  const PROTOCOL_FEE_RECIPIENT = process.env.PROTOCOL_FEE_RECIPIENT;
  const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS;
  const ENTRY_FEE = process.env.ENTRY_FEE;
  const FACTORY_ADDRESS_ENV = process.env.FACTORY_ADDRESS;
  const burnPercent = readSplitPercent('BURN_PERCENT', process.env.BURN_PERCENT, process.env.BURN_BP, DEFAULT_BURN_PERCENT);
  const treasuryPercent = readSplitPercent('TREASURY_PERCENT', process.env.TREASURY_PERCENT, process.env.TREASURY_BP, DEFAULT_TREASURY_PERCENT);
  const memberPoolPercent = readSplitPercent('MEMBER_POOL_PERCENT', process.env.MEMBER_POOL_PERCENT, process.env.MEMBER_POOL_BP, DEFAULT_MEMBER_POOL_PERCENT);
  const protocolPercentEnv = resolveProtocolPercentFromEnv();
  let protocolPercentPercent = protocolPercentEnv.percent;
  let protocolPercentBps = protocolPercentEnv.bps;
  let protocolPercentSource = protocolPercentEnv.source;
  const QUORUM_PERCENT = process.env.QUORUM_PERCENT !== undefined ? Number(process.env.QUORUM_PERCENT) : undefined;
  const EXECUTION_DELAY_SECONDS = process.env.EXECUTION_DELAY_SECONDS !== undefined ? Number(process.env.EXECUTION_DELAY_SECONDS) : undefined;
  const BURN_ADDRESS = (process.env.BURN_ADDRESS || '').trim();
  const MAX_MEMBERS = process.env.MAX_MEMBERS !== undefined ? Number(process.env.MAX_MEMBERS) : 0;
  const NAME = (process.env.TEMPL_NAME ?? 'Templ').trim() || 'Templ';
  const DESCRIPTION = (process.env.TEMPL_DESCRIPTION ?? '').trim();
  const LOGO_LINK = (process.env.TEMPL_LOGO_LINK ?? process.env.TEMPL_LOGO_URL ?? '').trim();
  const PROPOSAL_FEE_BPS = resolvePercentToBps({
    label: 'PROPOSAL_FEE',
    percentSource: process.env.PROPOSAL_FEE_PERCENT ?? process.env.PROPOSAL_FEE_PCT,
    bpsSource: process.env.PROPOSAL_FEE_BPS,
    defaultBps: 0
  });
  const REFERRAL_SHARE_BPS = resolvePercentToBps({
    label: 'REFERRAL_SHARE',
    percentSource: process.env.REFERRAL_SHARE_PERCENT ?? process.env.REFERRAL_PERCENT,
    bpsSource: process.env.REFERRAL_SHARE_BPS ?? process.env.REFERRAL_BPS,
    defaultBps: 0
  });
  const BACKEND_URL = (process.env.BACKEND_URL || process.env.TEMPL_BACKEND_URL || '').trim();
  const TELEGRAM_CHAT_ID = (process.env.TELEGRAM_CHAT_ID || process.env.CHAT_ID || '').trim();
  const PRIEST_IS_DICTATOR = /^(?:1|true)$/i.test((process.env.PRIEST_IS_DICTATOR || '').trim());
  const curveConfigEnv = resolveCurveConfigFromEnv();

  if (!TOKEN_ADDRESS) {
    throw new Error("TOKEN_ADDRESS not set in environment");
  }
  console.warn(
    '[warn] Confirm TOKEN_ADDRESS is a standard ERC-20 without transfer taxes or hooks; templ fee splits assume exact transfer amounts.'
  );
  if (!PROTOCOL_FEE_RECIPIENT) {
    throw new Error("PROTOCOL_FEE_RECIPIENT not set in environment");
  }
  if (!ENTRY_FEE) {
    throw new Error("ENTRY_FEE not set in environment");
  }
  if (FACTORY_ADDRESS_ENV) {
    try {
      const existingFactory = await hre.ethers.getContractAt('TemplFactory', FACTORY_ADDRESS_ENV);
      const onChainPercentBps = Number(await existingFactory.protocolPercent());
      if (!Number.isFinite(onChainPercentBps)) {
        throw new Error('Factory protocol percent is not a finite number');
      }
      const onChainPercent = onChainPercentBps / 100;
      if (protocolPercentSource !== 'factory' && protocolPercentPercent !== onChainPercent) {
        console.warn(
          `[warn] Ignoring PROTOCOL_${protocolPercentSource === 'bps' ? 'BP' : 'PERCENT'}=${protocolPercentSource === 'bps' ? protocolPercentBps : protocolPercentPercent} from environment; factory ${FACTORY_ADDRESS_ENV} enforces ${onChainPercent}.`
        );
      }
      protocolPercentPercent = onChainPercent;
      protocolPercentBps = onChainPercentBps;
      protocolPercentSource = 'factory';
    } catch (err) {
      throw new Error(`Failed to read protocol percent from factory ${FACTORY_ADDRESS_ENV}: ${err?.message || err}`);
    }
  }

  if (!Number.isFinite(protocolPercentPercent)) {
    throw new Error('Resolved protocol percent is not a valid number');
  }
  if (protocolPercentPercent < 0 || protocolPercentPercent > 100) {
    throw new Error('Resolved protocol percent must be between 0 and 100');
  }

  const totalSplit = burnPercent.resolvedPercent + treasuryPercent.resolvedPercent + memberPoolPercent.resolvedPercent + protocolPercentPercent;
  if (totalSplit !== 100) {
    throw new Error(`Fee split must sum to 100 percent; received ${totalSplit}`);
  }
  if (QUORUM_PERCENT !== undefined && (!Number.isFinite(QUORUM_PERCENT) || QUORUM_PERCENT < 0 || QUORUM_PERCENT > 100)) {
    throw new Error('QUORUM_PERCENT must be between 0 and 100');
  }
  if (EXECUTION_DELAY_SECONDS !== undefined && (!Number.isFinite(EXECUTION_DELAY_SECONDS) || EXECUTION_DELAY_SECONDS <= 0)) {
    throw new Error('EXECUTION_DELAY_SECONDS must be a positive number of seconds');
  }
  if (BURN_ADDRESS && !hre.ethers.isAddress(BURN_ADDRESS)) {
    throw new Error('BURN_ADDRESS must be a valid address');
  }
  const DEFAULT_BURN_ADDRESS = '0x000000000000000000000000000000000000dead';
  const effectiveBurnAddress = BURN_ADDRESS || DEFAULT_BURN_ADDRESS;

  const quorumPercentBps = QUORUM_PERCENT !== undefined ? Math.round(QUORUM_PERCENT * 100) : 0;

  const entryFee = BigInt(ENTRY_FEE);
  if (entryFee < 10n) {
    throw new Error("ENTRY_FEE must be at least 10 wei for proper distribution");
  }
  if (entryFee % 10n !== 0n) {
    throw new Error("ENTRY_FEE must be divisible by 10 to satisfy contract constraints");
  }

  console.log("========================================");
  console.log("Deploying TemplFactory + TEMPL");
  console.log("========================================");
  console.log("Priest Address:", PRIEST_ADDRESS);
  console.log("Protocol Fee Recipient:", PROTOCOL_FEE_RECIPIENT);
  console.log("Token Address:", TOKEN_ADDRESS);
  console.log("Factory Address (env):", FACTORY_ADDRESS_ENV || '<will deploy>');

  const describeSplit = (info) => {
    if (info.configValue === USE_DEFAULT_PERCENT) {
      return `${info.resolvedPercent} (default via -1)`;
    }
    if (info.usedDefault) {
      return `${info.resolvedPercent} (default)`;
    }
    return String(info.resolvedPercent);
  };

  console.log(
    "Fee Split (%): burn=%s treasury=%s memberPool=%s protocol=%d",
    describeSplit(burnPercent),
    describeSplit(treasuryPercent),
    describeSplit(memberPoolPercent),
    protocolPercentPercent
  );

  const burnAmount = (entryFee * BigInt(Math.round(burnPercent.resolvedPercent * 100))) / 10_000n;
  const treasuryAmount = (entryFee * BigInt(Math.round(treasuryPercent.resolvedPercent * 100))) / 10_000n;
  const memberPoolAmount = (entryFee * BigInt(Math.round(memberPoolPercent.resolvedPercent * 100))) / 10_000n;
  const protocolAmount = (entryFee * BigInt(protocolPercentBps)) / 10_000n;
  console.log("\nEntry Fee:", entryFee.toString());
  console.log("Fee Split:");
  console.log(`  - ${burnPercent.resolvedPercent}% Burn:`, burnAmount.toString());
  console.log(`  - ${treasuryPercent.resolvedPercent}% DAO Treasury:`, treasuryAmount.toString());
  console.log(`  - ${memberPoolPercent.resolvedPercent}% Member Pool:`, memberPoolAmount.toString());
  console.log(`  - ${protocolPercentPercent}% Protocol Fee:`, protocolAmount.toString());
  
  console.log("\nDeploying from:", deployer.address);
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Deployer balance:", hre.ethers.formatEther(balance), "ETH");
  
  const network = await hre.ethers.provider.getNetwork();
  const chainIdNumber = Number(network.chainId);
  console.log("Network Chain ID:", network.chainId.toString());
  console.log("Quorum Percent:", QUORUM_PERCENT ?? 33);
  console.log("Execution Delay (seconds):", EXECUTION_DELAY_SECONDS ?? 7 * 24 * 60 * 60);
  console.log("Burn Address:", effectiveBurnAddress);
  console.log("Priest Dictatorship:", PRIEST_IS_DICTATOR ? 'enabled' : 'disabled');
  console.log('Curve configuration:', curveConfigEnv.description);
  console.log(`Protocol Percent (${protocolPercentSource}):`, protocolPercentPercent);
  console.log('Protocol Percent (bps):', protocolPercentBps);
  console.log('\nMetadata:');
  console.log('- Name:', NAME);
  console.log('- Description:', DESCRIPTION || '<empty>');
  console.log('- Logo Link:', LOGO_LINK || '<empty>');
  console.log('- Proposal Fee (bps):', PROPOSAL_FEE_BPS);
  console.log('- Referral Share (bps):', REFERRAL_SHARE_BPS);
  
  if (network.chainId === 8453n) {
    console.log("\n⚠️  Deploying to BASE MAINNET");
    console.log("Please confirm all settings are correct...");
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  
  let factoryAddress = FACTORY_ADDRESS_ENV;
  if (!factoryAddress) {
    console.log("\nDeploying TemplFactory...");
    const Factory = await hre.ethers.getContractFactory("TemplFactory");
    const factory = await Factory.deploy(PROTOCOL_FEE_RECIPIENT, protocolPercentBps);
    await factory.waitForDeployment();
    factoryAddress = await factory.getAddress();
    console.log("Factory deployed at:", factoryAddress);
    if (network.chainId !== 31337n) {
      console.log("Waiting for confirmations...");
      await factory.deploymentTransaction().wait(2);
    }
  }

  console.log("\nCreating TEMPL via factory...");
  const factoryContract = await hre.ethers.getContractAt("TemplFactory", factoryAddress);
  if (!Number.isFinite(MAX_MEMBERS) || MAX_MEMBERS < 0) {
    throw new Error('MAX_MEMBERS must be a non-negative number');
  }

  const templConfig = {
    priest: PRIEST_ADDRESS,
    token: TOKEN_ADDRESS,
    entryFee: ENTRY_FEE,
    burnPercent: burnPercent.configValue,
    treasuryPercent: treasuryPercent.configValue,
    memberPoolPercent: memberPoolPercent.configValue,
    quorumPercent: quorumPercentBps,
    executionDelaySeconds: EXECUTION_DELAY_SECONDS ?? 0,
    burnAddress: BURN_ADDRESS || hre.ethers.ZeroAddress,
    priestIsDictator: PRIEST_IS_DICTATOR,
    maxMembers: MAX_MEMBERS,
    curveProvided: curveConfigEnv.curveProvided,
    curve: curveConfigEnv.curve,
    name: NAME,
    description: DESCRIPTION,
    logoLink: LOGO_LINK,
    proposalFeeBps: PROPOSAL_FEE_BPS,
    referralShareBps: REFERRAL_SHARE_BPS
  };
  const expectedTempl = await factoryContract.createTemplWithConfig.staticCall(templConfig);
  const createTx = await factoryContract.createTemplWithConfig(templConfig);
  console.log("Factory tx hash:", createTx.hash);
  const receipt = await createTx.wait();

  let contractAddress = expectedTempl;
  try {
    for (const log of receipt?.logs ?? []) {
      if ((log.address || '').toLowerCase() !== factoryAddress.toLowerCase()) {
        continue;
      }
      const parsed = factoryContract.interface.parseLog(log);
      if (parsed?.name === 'TemplCreated' && parsed.args?.templ) {
        contractAddress = parsed.args.templ;
        break;
      }
    }
  } catch (err) {
    console.warn('Warning: could not parse factory logs for templ address:', err);
  }

  await waitForContractCode(contractAddress, hre.ethers.provider);
  const contract = await hre.ethers.getContractAt("TEMPL", contractAddress);
  
  console.log("✅ Contract deployed to:", contractAddress);
  if (!FACTORY_ADDRESS_ENV) {
    console.log("TemplFactory Transaction hash:", createTx.hash);
  }

  if (BACKEND_URL) {
    const signerAddress = deployer.address.toLowerCase();
    if (signerAddress !== PRIEST_ADDRESS.toLowerCase()) {
      console.warn(
        'Skipping backend registration: deployer signer does not match priest address. Use scripts/register-templ.js with the priest key.'
      );
    } else {
      try {
        console.log(`\nRegistering templ with backend at ${BACKEND_URL} ...`);
        const registration = await registerTemplWithBackend({
          backendUrl: BACKEND_URL,
          templAddress: contractAddress,
          signer: deployer,
          priestAddress: PRIEST_ADDRESS,
          chainId: chainIdNumber,
          telegramChatId: TELEGRAM_CHAT_ID || undefined,
          templName: NAME,
          templDescription: DESCRIPTION,
          templLogoLink: LOGO_LINK,
          proposalFeeBps: PROPOSAL_FEE_BPS,
          referralShareBps: REFERRAL_SHARE_BPS
        });
        if (registration) {
          if (registration.bindingCode) {
            console.log('Backend binding code:', registration.bindingCode);
          }
          if (registration.telegramChatId) {
            console.log('Backend stored chat id:', registration.telegramChatId);
          }
          if (registration.templName || registration.templDescription || registration.templLogoLink) {
            console.log('Backend metadata:', {
              name: registration.templName,
              description: registration.templDescription,
              logoLink: registration.templLogoLink,
              proposalFeeBps: registration.proposalFeeBps,
              referralShareBps: registration.referralShareBps
            });
          }
        }
      } catch (err) {
        console.error('Backend registration failed:', err?.message || err);
      }
    }
  }
  
  const config = await contract.getConfig();
  const treasuryInfo = await contract.getTreasuryInfo();

  const treasuryAvailable = treasuryInfo?.treasury ?? treasuryInfo?.[0];
  const memberPoolBalance = treasuryInfo?.memberPool ?? treasuryInfo?.[1];
  const protocolRecipient = treasuryInfo?.protocolAddress ?? treasuryInfo?.[2];
  
  console.log("\n📋 Contract Configuration:");
  console.log("- Token:", config[0]);
  console.log("- Entry Fee:", config[1].toString());
  console.log("- Paused:", config[2]);
  console.log("- Total Purchases:", config[3].toString());
  console.log("- Treasury Balance:", config[4].toString());
  console.log("- Member Pool Balance:", config[5].toString());
  
  console.log("\n💰 Treasury Information:");
  if (treasuryAvailable !== undefined) {
    console.log("- Treasury Balance:", treasuryAvailable.toString());
  }
  if (memberPoolBalance !== undefined) {
    console.log("- Member Pool Balance:", memberPoolBalance.toString());
  }
  if (protocolRecipient) {
    console.log("- Protocol Fee Recipient:", protocolRecipient);
  }
  
  // Save deployment info
  const deploymentInfo = {
    contractVersion: "1.0.0",
    network: network.chainId === 8453n ? "base" : "local",
    chainId: Number(network.chainId),
    contractAddress: contractAddress,
    priestAddress: PRIEST_ADDRESS,
    protocolFeeRecipient: PROTOCOL_FEE_RECIPIENT,
    factoryAddress,
    burnPercent: burnPercent.resolvedPercent,
    treasuryPercent: treasuryPercent.resolvedPercent,
    memberPoolPercent: memberPoolPercent.resolvedPercent,
    protocolPercentBps,
    protocolPercentPercent,
    quorumPercent: QUORUM_PERCENT ?? 33,
    executionDelaySeconds: EXECUTION_DELAY_SECONDS ?? 7 * 24 * 60 * 60,
    burnAddress: effectiveBurnAddress,
    priestIsDictator: PRIEST_IS_DICTATOR,
    tokenAddress: TOKEN_ADDRESS,
    entryFee: ENTRY_FEE,
    templName: NAME,
    templDescription: DESCRIPTION,
    templLogoLink: LOGO_LINK,
    proposalFeeBps: PROPOSAL_FEE_BPS,
    referralShareBps: REFERRAL_SHARE_BPS,
    curveProvided: curveConfigEnv.curveProvided,
    curve: curveConfigEnv.curve,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    abi: JSON.parse(contract.interface.formatJson()),
    factoryTransactionHash: createTx.hash
  };
  
  const deploymentPath = path.join(__dirname, "../deployments");
  if (!fs.existsSync(deploymentPath)) {
    fs.mkdirSync(deploymentPath, { recursive: true });
  }
  
  const filename = `deployment-${network.chainId}-${Date.now()}.json`;
  fs.writeFileSync(
    path.join(deploymentPath, filename),
    JSON.stringify(deploymentInfo, null, 2)
  );
  
  console.log("\n📁 Deployment info saved to deployments/" + filename);
  
  if (network.chainId === 8453n) {
    console.log("\nVerification note:");
    console.log("TemplFactory deployed => use factory logs to verify downstream TEMPL instances on Basescan.");
    console.log("You can verify the factory itself with:");
    console.log(`npx hardhat verify --network base ${factoryAddress} ${PROTOCOL_FEE_RECIPIENT} ${protocolPercentBps}`);
  }
  
  console.log("\n========================================");
  console.log("🎉 DEPLOYMENT COMPLETE!");
  console.log("========================================");
  console.log("\nContract Address:", contractAddress);
  console.log("\n🗳️ DAO Governance:");
  console.log("- Treasury controlled by member voting");
  console.log("- Proposals require >50% yes votes to pass");
  console.log("- Voting period: 7-30 days");
  console.log("- One member = one vote (proposer auto‑YES; votes changeable until deadline)");
  console.log("\n🔒 Security Features:");
  console.log("- No backdoor functions");
  console.log("- All tokens only movable via DAO votes");
  console.log("- One join per wallet");
  console.log("- Vote gaming prevention");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ DEPLOYMENT FAILED:", error);
    process.exit(1);
  });
