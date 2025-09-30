const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const DEFAULT_BURN_PERCENT = 30;
const DEFAULT_TREASURY_PERCENT = 30;
const DEFAULT_MEMBER_POOL_PERCENT = 30;
const USE_DEFAULT_PERCENT = -1;

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
  templHomeLink
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
  if (templHomeLink) {
    payload.templHomeLink = templHomeLink;
  }

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
  const rawProtocolPercent = process.env.PROTOCOL_PERCENT ?? process.env.PROTOCOL_BP ?? '10';
  let protocolPercentPercent = Number(rawProtocolPercent);
  const QUORUM_PERCENT = process.env.QUORUM_PERCENT !== undefined ? Number(process.env.QUORUM_PERCENT) : undefined;
  const EXECUTION_DELAY_SECONDS = process.env.EXECUTION_DELAY_SECONDS !== undefined ? Number(process.env.EXECUTION_DELAY_SECONDS) : undefined;
  const BURN_ADDRESS = (process.env.BURN_ADDRESS || '').trim();
  const MAX_MEMBERS = process.env.MAX_MEMBERS !== undefined ? Number(process.env.MAX_MEMBERS) : 0;
  const HOME_LINK = process.env.TEMPL_HOME_LINK || "";
  const BACKEND_URL = (process.env.BACKEND_URL || process.env.TEMPL_BACKEND_URL || '').trim();
  const TELEGRAM_CHAT_ID = (process.env.TELEGRAM_CHAT_ID || process.env.CHAT_ID || '').trim();
  const PRIEST_IS_DICTATOR = /^(?:1|true)$/i.test((process.env.PRIEST_IS_DICTATOR || '').trim());

  if (!TOKEN_ADDRESS) {
    throw new Error("TOKEN_ADDRESS not set in environment");
  }
  if (!PROTOCOL_FEE_RECIPIENT) {
    throw new Error("PROTOCOL_FEE_RECIPIENT not set in environment");
  }
  if (!ENTRY_FEE) {
    throw new Error("ENTRY_FEE not set in environment");
  }
  if (!FACTORY_ADDRESS_ENV) {
    if (!Number.isFinite(protocolPercentPercent)) {
      throw new Error('PROTOCOL_PERCENT must be a valid number');
    }
    if (protocolPercentPercent < 0 || protocolPercentPercent > 100) {
      throw new Error('PROTOCOL_PERCENT must be between 0 and 100');
    }
  }

  let protocolPercentSource = 'env';
  if (FACTORY_ADDRESS_ENV) {
    try {
      const existingFactory = await hre.ethers.getContractAt('TemplFactory', FACTORY_ADDRESS_ENV);
      const onChainPercentBps = Number(await existingFactory.protocolPercent());
      if (!Number.isFinite(onChainPercentBps)) {
        throw new Error('Factory protocol percent is not a finite number');
      }
      const onChainPercent = onChainPercentBps / 100;
      if (Number.isFinite(protocolPercentPercent) && protocolPercentPercent !== onChainPercent) {
        console.warn(
          `[warn] Ignoring PROTOCOL_PERCENT=${protocolPercentPercent} from environment; factory ${FACTORY_ADDRESS_ENV} enforces ${onChainPercent}.`
        );
      }
      protocolPercentPercent = onChainPercent;
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

  const protocolPercentBps = Math.round(protocolPercentPercent * 100);
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

  const burnAmount = (entryFee * BigInt(burnPercent.resolvedPercent)) / 100n;
  const treasuryAmount = (entryFee * BigInt(treasuryPercent.resolvedPercent)) / 100n;
  const memberPoolAmount = (entryFee * BigInt(memberPoolPercent.resolvedPercent)) / 100n;
  const protocolAmount = (entryFee * BigInt(protocolPercentPercent)) / 100n;
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
  console.log(
    `Protocol Percent (${protocolPercentSource === 'factory' ? 'factory' : 'env'}):`,
    protocolPercentPercent
  );
  
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
    homeLink: HOME_LINK
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
          templHomeLink: HOME_LINK
        });
        if (registration) {
          if (registration.bindingCode) {
            console.log('Backend binding code:', registration.bindingCode);
          }
          if (registration.telegramChatId) {
            console.log('Backend stored chat id:', registration.telegramChatId);
          }
          if (registration.templHomeLink) {
            console.log('Backend templ home link:', registration.templHomeLink);
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
    protocolPercent: protocolPercentBps,
    quorumPercent: QUORUM_PERCENT ?? 33,
    executionDelaySeconds: EXECUTION_DELAY_SECONDS ?? 7 * 24 * 60 * 60,
    burnAddress: effectiveBurnAddress,
    priestIsDictator: PRIEST_IS_DICTATOR,
    tokenAddress: TOKEN_ADDRESS,
    entryFee: ENTRY_FEE,
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
  console.log("- One purchase per wallet");
  console.log("- Vote gaming prevention");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ DEPLOYMENT FAILED:", error);
    process.exit(1);
  });
