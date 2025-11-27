#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { ethers } from "ethers";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const artifactsRoot = path.join(__dirname, "..", "artifacts", "contracts");
const outDir = path.join(__dirname, "out");

const TREASURY_DEFAULT = "0x420f7D96FcEFe9D4708312F454c677ceB61D8420";
const TARGET_CHAINS = [
  { name: "mainnet", chainId: 1n, rpcEnv: "RPC_MAINNET_URL" },
  { name: "base", chainId: 8453n, rpcEnv: "RPC_BASE_URL" },
  { name: "optimism", chainId: 10n, rpcEnv: "RPC_OPTIMISM_URL" },
  { name: "arbitrum", chainId: 42161n, rpcEnv: "RPC_ARBITRUM_URL" }
];

function loadArtifact(file, name) {
  const artifactPath = path.join(artifactsRoot, file, `${name}.json`);
  if (!fs.existsSync(artifactPath)) {
    throw new Error(`Artifact missing at ${artifactPath}. Run 'npx hardhat compile' first.`);
  }
  return JSON.parse(fs.readFileSync(artifactPath, "utf8"));
}

function getProvider(rpcUrl) {
  return new ethers.JsonRpcProvider(rpcUrl);
}

function parseBps(value, label) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(`${label} must be a number`);
  }
  if (numeric < 0 || numeric > 10_000) {
    throw new Error(`${label} must be between 0 and 10_000`);
  }
  return Math.trunc(numeric);
}

async function deployContract(label, artifact, signer, args, expectedAddress) {
  const Factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, signer);
  const contract = await Factory.deploy(...args);
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  if (expectedAddress && address.toLowerCase() !== expectedAddress.toLowerCase()) {
    throw new Error(`${label} deployed at ${address}, expected ${expectedAddress}`);
  }
  let receipt = null;
  if (contract.deploymentTransaction) {
    try {
      receipt = await contract.deploymentTransaction().wait(2);
    } catch {
      // proceed even if confirmations are not available
    }
  }
  return {
    address,
    txHash: contract.deploymentTransaction ? contract.deploymentTransaction().hash : null,
    blockNumber: receipt?.blockNumber || null
  };
}

async function main() {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("Set PRIVATE_KEY in your environment to deploy.");
  }

  const protocolFeeRecipient = (process.env.PROTOCOL_FEE_RECIPIENT || TREASURY_DEFAULT).trim();
  const protocolBps = parseBps(process.env.PROTOCOL_BPS || 1_000, "PROTOCOL_BPS");
  const factoryDeployerOverride = process.env.FACTORY_DEPLOYER && process.env.FACTORY_DEPLOYER.trim();

  const chainContexts = [];
  for (const chain of TARGET_CHAINS) {
    const rpcUrl = (process.env[chain.rpcEnv] || "").trim();
    if (!rpcUrl) {
      throw new Error(`Missing RPC for ${chain.name}. Set ${chain.rpcEnv}.`);
    }
    const provider = getProvider(rpcUrl);
    const signer = new ethers.Wallet(privateKey, provider);
    const network = await provider.getNetwork();
    if (network.chainId !== chain.chainId) {
      throw new Error(`Connected to chainId ${network.chainId} for ${chain.name}, expected ${chain.chainId}`);
    }
    const nonce = await provider.getTransactionCount(signer.address);
    chainContexts.push({ ...chain, provider, signer, nonce });
  }

  const baseNonce = chainContexts[0].nonce;
  for (const ctx of chainContexts) {
    if (ctx.nonce !== baseNonce) {
      throw new Error(
        `Deployer nonce mismatch across chains. ${chainContexts[0].name}: ${baseNonce}, ${ctx.name}: ${ctx.nonce}. Use a fresh key with the same starting nonce on every chain.`
      );
    }
  }
  if (baseNonce !== 0n && process.env.ALLOW_NONZERO_NONCE !== "true") {
    throw new Error(
      `Deployer nonce is ${baseNonce}. Use a fresh key (nonce 0) or set ALLOW_NONZERO_NONCE=true if you intentionally start from a non-zero nonce.`
    );
  }

  const deployerAddress = chainContexts[0].signer.address;
  const factoryDeployer = factoryDeployerOverride || deployerAddress;
  console.log("Deployer:", deployerAddress);
  console.log("Factory deployer:", factoryDeployer);
  console.log("Protocol fee recipient:", protocolFeeRecipient);
  console.log("Protocol BPS:", protocolBps);
  console.log("Starting nonce:", baseNonce.toString());

  const artifactMap = {
    membership: loadArtifact("TemplMembership.sol", "TemplMembershipModule"),
    treasury: loadArtifact("TemplTreasury.sol", "TemplTreasuryModule"),
    governance: loadArtifact("TemplGovernance.sol", "TemplGovernanceModule"),
    council: loadArtifact("TemplCouncil.sol", "TemplCouncilModule"),
    templDeployer: loadArtifact("TemplDeployer.sol", "TemplDeployer"),
    factory: loadArtifact("TemplFactory.sol", "TemplFactory")
  };

  const labels = ["membership", "treasury", "governance", "council", "templDeployer", "factory"];
  const predicted = {};
  for (let i = 0; i < labels.length; i += 1) {
    predicted[labels[i]] = ethers.getCreateAddress({
      from: deployerAddress,
      nonce: baseNonce + BigInt(i)
    });
  }

  // Preflight: ensure target addresses are unused
  for (const ctx of chainContexts) {
    for (const label of labels) {
      const addr = predicted[label];
      const code = await ctx.provider.getCode(addr);
      if (code && code !== "0x") {
        throw new Error(
          `Address collision on ${ctx.name} for ${label} at ${addr}. Start from a clean deployer nonce or adjust ALLOW_NONZERO_NONCE/START nonce strategy.`
        );
      }
    }
  }

  const results = {
    deployer: deployerAddress,
    factoryDeployer,
    protocolFeeRecipient,
    protocolBps,
    startNonce: baseNonce.toString(),
    timestamp: new Date().toISOString(),
    chains: {}
  };

  for (const ctx of chainContexts) {
    console.log(`\n=== Deploying to ${ctx.name} (chain ${ctx.chainId}) ===`);
    const chainResult = { chainId: ctx.chainId, txs: {} };

    const membership = await deployContract(
      "membership module",
      artifactMap.membership,
      ctx.signer,
      [],
      predicted.membership
    );
    chainResult.membershipModule = membership.address;
    chainResult.txs.membership = membership.txHash;
    console.log(`Membership -> ${membership.address}`);

    const treasury = await deployContract(
      "treasury module",
      artifactMap.treasury,
      ctx.signer,
      [],
      predicted.treasury
    );
    chainResult.treasuryModule = treasury.address;
    chainResult.txs.treasury = treasury.txHash;
    console.log(`Treasury -> ${treasury.address}`);

    const governance = await deployContract(
      "governance module",
      artifactMap.governance,
      ctx.signer,
      [],
      predicted.governance
    );
    chainResult.governanceModule = governance.address;
    chainResult.txs.governance = governance.txHash;
    console.log(`Governance -> ${governance.address}`);

    const council = await deployContract(
      "council module",
      artifactMap.council,
      ctx.signer,
      [],
      predicted.council
    );
    chainResult.councilModule = council.address;
    chainResult.txs.council = council.txHash;
    console.log(`Council -> ${council.address}`);

    const templDeployer = await deployContract(
      "templ deployer",
      artifactMap.templDeployer,
      ctx.signer,
      [],
      predicted.templDeployer
    );
    chainResult.templDeployer = templDeployer.address;
    chainResult.txs.templDeployer = templDeployer.txHash;
    console.log(`TemplDeployer -> ${templDeployer.address}`);

    const factory = await deployContract(
      "TemplFactory",
      artifactMap.factory,
      ctx.signer,
      [
        factoryDeployer,
        protocolFeeRecipient,
        protocolBps,
        chainResult.membershipModule,
        chainResult.treasuryModule,
        chainResult.governanceModule,
        chainResult.councilModule,
        chainResult.templDeployer
      ],
      predicted.factory
    );
    chainResult.factory = factory.address;
    chainResult.txs.factory = factory.txHash;
    chainResult.factoryBlock = factory.blockNumber;
    console.log(`Factory -> ${factory.address} (tx ${factory.txHash || "N/A"})`);

    results.chains[ctx.name] = chainResult;
  }

  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  const outPath = path.join(outDir, "factory-addresses.json");
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nSaved output to ${outPath}`);

  console.log("\nVerification commands:");
  for (const [name, data] of Object.entries(results.chains)) {
    console.log(
      `${name}: npx hardhat verify --network ${name} ${data.factory} ${factoryDeployer} ${protocolFeeRecipient} ${protocolBps} ${data.membershipModule} ${data.treasuryModule} ${data.governanceModule} ${data.councilModule} ${data.templDeployer}`
    );
  }
}

main().catch((err) => {
  console.error("\n❌ Multichain deployment failed:", err);
  process.exit(1);
});

