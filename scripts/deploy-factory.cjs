const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

async function waitForContractCode(address, provider, attempts = 20, delayMs = 3000) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const code = await provider.getCode(address);
    if (code && code !== "0x") {
      return;
    }
    if (attempt === 0) {
      console.log(`Waiting for on-chain code at ${address} ...`);
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(`Timed out waiting for contract code at ${address}`);
}

async function deployModuleIfNeeded(label, contractName, envKey) {
  const existing = (process.env[envKey] || "").trim();
  if (existing) {
    if (!hre.ethers.isAddress(existing)) {
      throw new Error(`${envKey} must be a valid address`);
    }
    console.log(`${label} module provided via env: ${existing}`);
    return existing;
  }

  console.log(`Deploying ${label} module (${contractName})...`);
  const Factory = await hre.ethers.getContractFactory(contractName);
  const module = await Factory.deploy();
  await module.waitForDeployment();
  const address = await module.getAddress();
  console.log(`${label} module deployed at: ${address}`);
  return address;
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  if (!deployer) {
    throw new Error(
      "No Hardhat signer available. Set PRIVATE_KEY in your environment or configure accounts for this network."
    );
  }

  const protocolRecipient = (process.env.PROTOCOL_FEE_RECIPIENT || "").trim();
  if (!protocolRecipient) {
    throw new Error("PROTOCOL_FEE_RECIPIENT not set in environment");
  }
  if (!hre.ethers.isAddress(protocolRecipient)) {
    throw new Error("PROTOCOL_FEE_RECIPIENT must be a valid address");
  }

  const bpsInput = (process.env.PROTOCOL_BPS || "").trim();
  let protocolPercentSource = "default";
  let protocolPercentBps = 1_000;
  if (bpsInput) {
    const parsedBps = Number(bpsInput);
    if (!Number.isFinite(parsedBps)) {
      throw new Error("PROTOCOL_BPS must be a valid number");
    }
    if (parsedBps < 0 || parsedBps > 10_000) {
      throw new Error("PROTOCOL_BPS must be between 0 and 10_000");
    }
    protocolPercentBps = Math.round(parsedBps);
    protocolPercentSource = "bps";
  }

  let factoryAddress = (process.env.FACTORY_ADDRESS || "").trim();
  let membershipModuleAddress = (process.env.MEMBERSHIP_MODULE_ADDRESS || "").trim();
  let treasuryModuleAddress = (process.env.TREASURY_MODULE_ADDRESS || "").trim();
  let governanceModuleAddress = (process.env.GOVERNANCE_MODULE_ADDRESS || "").trim();

  const network = await hre.ethers.provider.getNetwork();
  const chainIdNumber = Number(network.chainId);

  console.log("========================================");
  console.log("Deploying TemplFactory");
  console.log("========================================");
  console.log("Network Chain ID:", network.chainId.toString());
  console.log("Deploying from:", deployer.address);
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Deployer balance:", hre.ethers.formatEther(balance), "ETH");

  let deploymentReceipt = null;

  if (factoryAddress) {
    console.log("\nReusing existing factory at:", factoryAddress);
    try {
      const existingFactory = await hre.ethers.getContractAt("TemplFactory", factoryAddress);
      const onChainBps = Number(await existingFactory.protocolBps());
      if (!Number.isFinite(onChainBps)) {
        throw new Error("protocolBps is not a finite number");
      }
      protocolPercentBps = onChainBps;
      protocolPercentSource = "factory";
      membershipModuleAddress = await existingFactory.membershipModule();
      treasuryModuleAddress = await existingFactory.treasuryModule();
      governanceModuleAddress = await existingFactory.governanceModule();
      console.log("Existing modules:");
      console.log("  - membership:", membershipModuleAddress);
      console.log("  - treasury:", treasuryModuleAddress);
      console.log("  - governance:", governanceModuleAddress);
    } catch (err) {
    console.warn("Warning: unable to read protocol bps from factory:", err?.message || err);
    }
  } else {
    if (network.chainId === 8453n) {
      console.log("\n⚠️  Deploying to BASE MAINNET");
      console.log("Please confirm all settings are correct...");
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    membershipModuleAddress = await deployModuleIfNeeded(
      "Membership",
      "TemplMembershipModule",
      "MEMBERSHIP_MODULE_ADDRESS"
    );
    treasuryModuleAddress = await deployModuleIfNeeded(
      "Treasury",
      "TemplTreasuryModule",
      "TREASURY_MODULE_ADDRESS"
    );
    governanceModuleAddress = await deployModuleIfNeeded(
      "Governance",
      "TemplGovernanceModule",
      "GOVERNANCE_MODULE_ADDRESS"
    );

    console.log("\nDeploying TemplFactory...");
    const Factory = await hre.ethers.getContractFactory("TemplFactory");
    const factory = await Factory.deploy(
      protocolRecipient,
      protocolPercentBps,
      membershipModuleAddress,
      treasuryModuleAddress,
      governanceModuleAddress
    );
    await factory.waitForDeployment();
    factoryAddress = await factory.getAddress();
    console.log("Factory deployed at:", factoryAddress);
    // Treat both 31337 (Hardhat) and 1337 (common local) as local chains
    if (network.chainId !== 31337n && network.chainId !== 1337n) {
      console.log("Waiting for confirmations...");
      deploymentReceipt = await factory.deploymentTransaction().wait(2);
    }
    if (!deploymentReceipt) {
      deploymentReceipt = await hre.ethers.provider.getTransactionReceipt(factory.deploymentTransaction().hash);
    }
    if (deploymentReceipt?.blockNumber) {
      console.log("Factory deployment block:", deploymentReceipt.blockNumber);
    }
    console.log("Factory deployment tx hash:", factory.deploymentTransaction().hash);
  }

  console.log("Protocol fee recipient:", protocolRecipient);
  console.log(`Protocol bps (${protocolPercentSource}):`, protocolPercentBps);
  console.log("\nFactory module wiring:");
  console.log("- Membership Module:", membershipModuleAddress);
  console.log("- Treasury Module:", treasuryModuleAddress);
  console.log("- Governance Module:", governanceModuleAddress);

  await waitForContractCode(factoryAddress, hre.ethers.provider);
  console.log("\n✅ TemplFactory ready at:", factoryAddress);

  const deploymentInfo = {
    contractVersion: "factory-1.0.0",
    network: network.chainId === 8453n ? "base" : "local",
    chainId: chainIdNumber,
    factoryAddress,
    protocolFeeRecipient: protocolRecipient,
    protocolBps: protocolPercentBps,
    membershipModule: membershipModuleAddress,
    treasuryModule: treasuryModuleAddress,
    governanceModule: governanceModuleAddress,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    deploymentTx: deploymentReceipt?.hash || null,
    deploymentBlock: deploymentReceipt?.blockNumber || null
  };

  const deploymentPath = path.join(__dirname, "../deployments");
  if (!fs.existsSync(deploymentPath)) {
    fs.mkdirSync(deploymentPath, { recursive: true });
  }

  const filename = `factory-${network.chainId}-${Date.now()}.json`;
  fs.writeFileSync(path.join(deploymentPath, filename), JSON.stringify(deploymentInfo, null, 2));

  console.log("\n📁 Factory info saved to deployments/" + filename);

  if (network.chainId === 8453n && !process.env.SKIP_VERIFY_NOTE) {
    console.log("\nVerification command:");
    console.log(
      `npx hardhat verify --network base ${factoryAddress} ${protocolRecipient} ${protocolPercentBps} ${membershipModuleAddress} ${treasuryModuleAddress} ${governanceModuleAddress}`
    );
  }

  console.log("\n========================================");
  console.log("🎉 FACTORY DEPLOYMENT COMPLETE");
  console.log("========================================");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ DEPLOYMENT FAILED:", error);
    process.exit(1);
  });
