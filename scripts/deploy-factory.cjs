const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

function normalizeNetworkName(value) {
  return typeof value === "string" ? value.trim() : "";
}

function resolveNetworkName(network) {
  const envNetwork = normalizeNetworkName(process.env.HARDHAT_NETWORK);
  if (envNetwork) return envNetwork;
  const hreNetwork = normalizeNetworkName(hre.network?.name);
  if (hreNetwork) return hreNetwork;
  const providerName = normalizeNetworkName(network?.name);
  if (providerName) return providerName;
  return "hardhat";
}

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

  // Normalize factory deployer early so it's available for logs/verification
  let factoryDeployer = (process.env.FACTORY_DEPLOYER || deployer.address).trim();
  if (!hre.ethers.isAddress(factoryDeployer)) {
    throw new Error("FACTORY_DEPLOYER must be a valid address (or omit to default to signer)");
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
  let councilModuleAddress = (process.env.COUNCIL_MODULE_ADDRESS || "").trim();
  let templDeployerAddress = (process.env.TEMPL_DEPLOYER_ADDRESS || "").trim();

  const network = await hre.ethers.provider.getNetwork();
  const networkName = resolveNetworkName(network);
  const chainIdNumber = Number(network.chainId);

  console.log("========================================");
  console.log("Deploying TemplFactory");
  console.log("========================================");
  console.log("Network:", networkName);
  console.log("Network Chain ID:", network.chainId.toString());
  console.log("Deploying from:", deployer.address);
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Deployer balance:", hre.ethers.formatEther(balance), "ETH");

  let deploymentReceipt = null;

  if (factoryAddress) {
    console.log("\nReusing existing factory at:", factoryAddress);
    try {
      const existingFactory = await hre.ethers.getContractAt("TemplFactory", factoryAddress);
      const onChainBps = Number(await existingFactory.PROTOCOL_BPS());
      if (!Number.isFinite(onChainBps)) {
        throw new Error("protocolBps is not a finite number");
      }
      protocolPercentBps = onChainBps;
      protocolPercentSource = "factory";
      membershipModuleAddress = await existingFactory.MEMBERSHIP_MODULE();
      treasuryModuleAddress = await existingFactory.TREASURY_MODULE();
      governanceModuleAddress = await existingFactory.GOVERNANCE_MODULE();
      councilModuleAddress = await existingFactory.COUNCIL_MODULE();
      templDeployerAddress = await existingFactory.TEMPL_DEPLOYER();
      // Prefer the on-chain factory deployer when reusing an existing deployment
      factoryDeployer = await existingFactory.factoryDeployer();
      console.log("Existing modules:");
      console.log("  - membership:", membershipModuleAddress);
      console.log("  - treasury:", treasuryModuleAddress);
      console.log("  - governance:", governanceModuleAddress);
      console.log("  - council:", councilModuleAddress);
      console.log("  - templ deployer:", templDeployerAddress);
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
    councilModuleAddress = await deployModuleIfNeeded(
      "Council",
      "TemplCouncilModule",
      "COUNCIL_MODULE_ADDRESS"
    );
    templDeployerAddress = await deployModuleIfNeeded(
      "Templ deployer",
      "TemplDeployer",
      "TEMPL_DEPLOYER_ADDRESS"
    );

    console.log("\nDeploying TemplFactory...");
    const Factory = await hre.ethers.getContractFactory("TemplFactory");
    const factory = await Factory.deploy(
      factoryDeployer,
      protocolRecipient,
      protocolPercentBps,
      membershipModuleAddress,
      treasuryModuleAddress,
      governanceModuleAddress,
      councilModuleAddress,
      templDeployerAddress
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
  console.log("- Council Module:", councilModuleAddress);
  console.log("- Templ Deployer:", templDeployerAddress);

  await waitForContractCode(factoryAddress, hre.ethers.provider);
  console.log("\n✅ TemplFactory ready at:", factoryAddress);

  console.warn("\n[warn] TEMPL instances expect vanilla ERC-20 access tokens (no transfer fees/rebasing). The factory cannot validate token semantics at this stage; ensure downstream deployments use standard tokens.");

  const deploymentInfo = {
    contractVersion: "factory-1.0.0",
    network: networkName,
    chainId: chainIdNumber,
    factoryAddress,
    protocolFeeRecipient: protocolRecipient,
    protocolBps: protocolPercentBps,
    membershipModule: membershipModuleAddress,
    treasuryModule: treasuryModuleAddress,
    governanceModule: governanceModuleAddress,
    councilModule: councilModuleAddress,
    templDeployer: templDeployerAddress,
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
    const verifyNetwork = networkName || "base";
    console.log("\nVerification command:");
    console.log(
      `npx hardhat verify --contract contracts/TemplFactory.sol:TemplFactory --network ${verifyNetwork} ${factoryAddress} ${factoryDeployer} ${protocolRecipient} ${protocolPercentBps} ${membershipModuleAddress} ${treasuryModuleAddress} ${governanceModuleAddress} ${councilModuleAddress} ${templDeployerAddress}`
    );
    console.log("\nModule verification commands:");
    console.log(
      `npx hardhat verify --contract contracts/TemplMembership.sol:TemplMembershipModule --network ${verifyNetwork} ${membershipModuleAddress}`
    );
    console.log(
      `npx hardhat verify --contract contracts/TemplTreasury.sol:TemplTreasuryModule --network ${verifyNetwork} ${treasuryModuleAddress}`
    );
    console.log(
      `npx hardhat verify --contract contracts/TemplGovernance.sol:TemplGovernanceModule --network ${verifyNetwork} ${governanceModuleAddress}`
    );
    console.log(
      `npx hardhat verify --contract contracts/TemplCouncil.sol:TemplCouncilModule --network ${verifyNetwork} ${councilModuleAddress}`
    );
    console.log(
      `npx hardhat verify --contract contracts/TemplDeployer.sol:TemplDeployer --network ${verifyNetwork} ${templDeployerAddress}`
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
