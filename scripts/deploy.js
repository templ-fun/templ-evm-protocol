const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const DEFAULT_BURN_PERCENT = 30;
const DEFAULT_TREASURY_PERCENT = 30;
const DEFAULT_MEMBER_POOL_PERCENT = 30;
const USE_DEFAULT_PERCENT = -1;

function readSplitPercent(label, primaryEnv, fallbackEnv, defaultValue) {
  const raw = primaryEnv ?? fallbackEnv;
  if (raw === undefined || raw.trim() === '') {
    return { configValue: defaultValue, resolvedPercent: defaultValue, usedDefault: true };
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a valid number`);
  }

  if (parsed === USE_DEFAULT_PERCENT) {
    return { configValue: USE_DEFAULT_PERCENT, resolvedPercent: defaultValue, usedDefault: true };
  }

  if (parsed < 0) {
    throw new Error(`${label} cannot be negative (use -1 to fall back to the factory default)`);
  }

  return { configValue: parsed, resolvedPercent: parsed, usedDefault: false };
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const PRIEST_ADDRESS = process.env.PRIEST_ADDRESS || deployer.address;
  const PROTOCOL_FEE_RECIPIENT = process.env.PROTOCOL_FEE_RECIPIENT;
  const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS;
  const ENTRY_FEE = process.env.ENTRY_FEE;
  const FACTORY_ADDRESS_ENV = process.env.FACTORY_ADDRESS;
  const burnPercent = readSplitPercent('BURN_PERCENT', process.env.BURN_PERCENT, process.env.BURN_BP, DEFAULT_BURN_PERCENT);
  const treasuryPercent = readSplitPercent('TREASURY_PERCENT', process.env.TREASURY_PERCENT, process.env.TREASURY_BP, DEFAULT_TREASURY_PERCENT);
  const memberPoolPercent = readSplitPercent('MEMBER_POOL_PERCENT', process.env.MEMBER_POOL_PERCENT, process.env.MEMBER_POOL_BP, DEFAULT_MEMBER_POOL_PERCENT);
  const rawProtocolPercent = process.env.PROTOCOL_PERCENT ?? process.env.PROTOCOL_BP ?? '10';
  const PROTOCOL_PERCENT = Number(rawProtocolPercent);
  const QUORUM_PERCENT = process.env.QUORUM_PERCENT !== undefined ? Number(process.env.QUORUM_PERCENT) : undefined;
  const EXECUTION_DELAY_SECONDS = process.env.EXECUTION_DELAY_SECONDS !== undefined ? Number(process.env.EXECUTION_DELAY_SECONDS) : undefined;
  const BURN_ADDRESS = (process.env.BURN_ADDRESS || '').trim();
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
  if (!Number.isFinite(PROTOCOL_PERCENT)) {
    throw new Error('PROTOCOL_PERCENT must be a valid number');
  }
  if (PROTOCOL_PERCENT < 0 || PROTOCOL_PERCENT > 100) {
    throw new Error('PROTOCOL_PERCENT must be between 0 and 100');
  }

  const totalSplit = burnPercent.resolvedPercent + treasuryPercent.resolvedPercent + memberPoolPercent.resolvedPercent + PROTOCOL_PERCENT;
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
    PROTOCOL_PERCENT
  );

  const burnAmount = (entryFee * BigInt(burnPercent.resolvedPercent)) / 100n;
  const treasuryAmount = (entryFee * BigInt(treasuryPercent.resolvedPercent)) / 100n;
  const memberPoolAmount = (entryFee * BigInt(memberPoolPercent.resolvedPercent)) / 100n;
  const protocolAmount = (entryFee * BigInt(PROTOCOL_PERCENT)) / 100n;
  console.log("\nEntry Fee:", entryFee.toString());
  console.log("Fee Split:");
  console.log(`  - ${burnPercent.resolvedPercent}% Burn:`, burnAmount.toString());
  console.log(`  - ${treasuryPercent.resolvedPercent}% DAO Treasury:`, treasuryAmount.toString());
  console.log(`  - ${memberPoolPercent.resolvedPercent}% Member Pool:`, memberPoolAmount.toString());
  console.log(`  - ${PROTOCOL_PERCENT}% Protocol Fee:`, protocolAmount.toString());
  
  console.log("\nDeploying from:", deployer.address);
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Deployer balance:", hre.ethers.formatEther(balance), "ETH");
  
  const network = await hre.ethers.provider.getNetwork();
  console.log("Network Chain ID:", network.chainId.toString());
  console.log("Quorum Percent:", QUORUM_PERCENT ?? 33);
  console.log("Execution Delay (seconds):", EXECUTION_DELAY_SECONDS ?? 7 * 24 * 60 * 60);
  console.log("Burn Address:", effectiveBurnAddress);
  console.log("Priest Dictatorship:", PRIEST_IS_DICTATOR ? 'enabled' : 'disabled');
  
  if (network.chainId === 8453n) {
    console.log("\n⚠️  Deploying to BASE MAINNET");
    console.log("Please confirm all settings are correct...");
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  
  let factoryAddress = FACTORY_ADDRESS_ENV;
  if (!factoryAddress) {
    console.log("\nDeploying TemplFactory...");
    const Factory = await hre.ethers.getContractFactory("TemplFactory");
    const factory = await Factory.deploy(PROTOCOL_FEE_RECIPIENT, PROTOCOL_PERCENT);
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
  const templConfig = {
    priest: PRIEST_ADDRESS,
    token: TOKEN_ADDRESS,
    entryFee: ENTRY_FEE,
    burnPercent: burnPercent.configValue,
    treasuryPercent: treasuryPercent.configValue,
    memberPoolPercent: memberPoolPercent.configValue,
    priestIsDictator: PRIEST_IS_DICTATOR
  };
  if (QUORUM_PERCENT !== undefined) templConfig.quorumPercent = QUORUM_PERCENT;
  if (EXECUTION_DELAY_SECONDS !== undefined) templConfig.executionDelaySeconds = EXECUTION_DELAY_SECONDS;
  if (BURN_ADDRESS) templConfig.burnAddress = BURN_ADDRESS;
  const expectedTempl = await factoryContract.createTemplWithConfig.staticCall(templConfig);
  const createTx = await factoryContract.createTemplWithConfig(templConfig);
  console.log("Factory tx hash:", createTx.hash);
  await createTx.wait();

  const contractAddress = expectedTempl;
  const contract = await hre.ethers.getContractAt("TEMPL", contractAddress);
  
  console.log("✅ Contract deployed to:", contractAddress);
  if (!FACTORY_ADDRESS_ENV) {
    console.log("TemplFactory Transaction hash:", createTx.hash);
  }
  
  const config = await contract.getConfig();
  const treasuryInfo = await contract.getTreasuryInfo();
  
  console.log("\n📋 Contract Configuration:");
  console.log("- Token:", config[0]);
  console.log("- Entry Fee:", config[1].toString());
  console.log("- Paused:", config[2]);
  console.log("- Total Purchases:", config[3].toString());
  console.log("- Treasury Balance:", config[4].toString());
  console.log("- Member Pool Balance:", config[5].toString());
  
  console.log("\n💰 Treasury Information:");
  console.log("- Treasury Balance:", treasuryInfo[0].toString());
  console.log("- Member Pool Balance:", treasuryInfo[1].toString());
  console.log("- Total to Treasury:", treasuryInfo[2].toString());
  console.log("- Total Burned:", treasuryInfo[3].toString());
  console.log("- Total to Protocol:", treasuryInfo[4].toString());
  console.log("- Protocol Fee Recipient:", treasuryInfo[5]);
  
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
    protocolPercent: PROTOCOL_PERCENT,
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
    console.log(`npx hardhat verify --network base ${factoryAddress} ${PROTOCOL_FEE_RECIPIENT} ${PROTOCOL_PERCENT}`);
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
