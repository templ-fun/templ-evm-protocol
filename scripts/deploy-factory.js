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

  const percentInput = (process.env.PROTOCOL_PERCENT ?? "").trim();
  const bpsInput = (process.env.PROTOCOL_BP ?? "").trim();
  let protocolPercentSource = "default";
  let protocolPercent = 10;
  let protocolPercentBps = 1_000;

  if (percentInput) {
    const parsedPercent = Number(percentInput);
    if (!Number.isFinite(parsedPercent)) {
      throw new Error("PROTOCOL_PERCENT must be a valid number");
    }
    if (parsedPercent < 0 || parsedPercent > 100) {
      throw new Error("PROTOCOL_PERCENT must be between 0 and 100");
    }
    protocolPercent = parsedPercent;
    protocolPercentBps = Math.round(parsedPercent * 100);
    protocolPercentSource = "percent";
  } else if (bpsInput) {
    const parsedBps = Number(bpsInput);
    if (!Number.isFinite(parsedBps)) {
      throw new Error("PROTOCOL_BP must be a valid number");
    }
    if (parsedBps < 0 || parsedBps > 10_000) {
      throw new Error("PROTOCOL_BP must be between 0 and 10_000");
    }
    protocolPercentBps = Math.round(parsedBps);
    protocolPercent = protocolPercentBps / 100;
    protocolPercentSource = "bps";
  }

  let factoryAddress = (process.env.FACTORY_ADDRESS || "").trim();

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
      const onChainBps = Number(await existingFactory.protocolPercent());
      if (!Number.isFinite(onChainBps)) {
        throw new Error("protocolPercent is not a finite number");
      }
      protocolPercentBps = onChainBps;
      protocolPercent = onChainBps / 100;
      protocolPercentSource = "factory";
    } catch (err) {
      console.warn("Warning: unable to read protocol percent from factory:", err?.message || err);
    }
  } else {
    if (network.chainId === 8453n) {
      console.log("\n⚠️  Deploying to BASE MAINNET");
      console.log("Please confirm all settings are correct...");
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    console.log("\nDeploying TemplFactory...");
    const Factory = await hre.ethers.getContractFactory("TemplFactory");
    const factory = await Factory.deploy(protocolRecipient, protocolPercentBps);
    await factory.waitForDeployment();
    factoryAddress = await factory.getAddress();
    console.log("Factory deployed at:", factoryAddress);
    if (network.chainId !== 31337n) {
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
  console.log(`Protocol percent (${protocolPercentSource}):`, protocolPercent);
  console.log("Protocol percent (bps):", protocolPercentBps);

  await waitForContractCode(factoryAddress, hre.ethers.provider);
  console.log("\n✅ TemplFactory ready at:", factoryAddress);

  const deploymentInfo = {
    contractVersion: "factory-1.0.0",
    network: network.chainId === 8453n ? "base" : "local",
    chainId: chainIdNumber,
    factoryAddress,
    protocolFeeRecipient: protocolRecipient,
    protocolPercentBps,
    protocolPercent,
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
    console.log(`npx hardhat verify --network base ${factoryAddress} ${protocolRecipient} ${protocolPercentBps}`);
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
