const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const PRIEST_ADDRESS = process.env.PRIEST_ADDRESS || deployer.address;
  const PROTOCOL_FEE_RECIPIENT = process.env.PROTOCOL_FEE_RECIPIENT;
  const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS;
  const ENTRY_FEE = process.env.ENTRY_FEE;
  const FACTORY_ADDRESS_ENV = process.env.FACTORY_ADDRESS;
  const BURN_BP = Number(process.env.BURN_BP ?? '30');
  const TREASURY_BP = Number(process.env.TREASURY_BP ?? '30');
  const MEMBER_POOL_BP = Number(process.env.MEMBER_POOL_BP ?? '30');
  const PROTOCOL_BP = Number(process.env.PROTOCOL_BP ?? '10');

  if (!TOKEN_ADDRESS) {
    throw new Error("TOKEN_ADDRESS not set in environment");
  }
  if (!PROTOCOL_FEE_RECIPIENT) {
    throw new Error("PROTOCOL_FEE_RECIPIENT not set in environment");
  }
  if (!ENTRY_FEE) {
    throw new Error("ENTRY_FEE not set in environment");
  }
  if ([BURN_BP, TREASURY_BP, MEMBER_POOL_BP, PROTOCOL_BP].some((bp) => !Number.isFinite(bp))) {
    throw new Error("All basis point values must be valid numbers");
  }
  const totalSplit = BURN_BP + TREASURY_BP + MEMBER_POOL_BP + PROTOCOL_BP;
  if (totalSplit !== 100) {
    throw new Error(`Fee split must sum to 100 basis points; received ${totalSplit}`);
  }

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
  console.log("Fee Split (BPS): burn=%d treasury=%d memberPool=%d protocol=%d", BURN_BP, TREASURY_BP, MEMBER_POOL_BP, PROTOCOL_BP);

  const burnAmount = (entryFee * BigInt(BURN_BP)) / 100n;
  const treasuryAmount = (entryFee * BigInt(TREASURY_BP)) / 100n;
  const memberPoolAmount = (entryFee * BigInt(MEMBER_POOL_BP)) / 100n;
  const protocolAmount = (entryFee * BigInt(PROTOCOL_BP)) / 100n;
  console.log("\nEntry Fee:", entryFee.toString());
  console.log("Fee Split:");
  console.log(`  - ${BURN_BP}% Burn:`, burnAmount.toString());
  console.log(`  - ${TREASURY_BP}% DAO Treasury:`, treasuryAmount.toString());
  console.log(`  - ${MEMBER_POOL_BP}% Member Pool:`, memberPoolAmount.toString());
  console.log(`  - ${PROTOCOL_BP}% Protocol Fee:`, protocolAmount.toString());
  
  console.log("\nDeploying from:", deployer.address);
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Deployer balance:", hre.ethers.formatEther(balance), "ETH");
  
  const network = await hre.ethers.provider.getNetwork();
  console.log("Network Chain ID:", network.chainId.toString());
  
  if (network.chainId === 8453n) {
    console.log("\n⚠️  Deploying to BASE MAINNET");
    console.log("Please confirm all settings are correct...");
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  
  let factoryAddress = FACTORY_ADDRESS_ENV;
  if (!factoryAddress) {
    console.log("\nDeploying TemplFactory...");
    const Factory = await hre.ethers.getContractFactory("TemplFactory");
    const factory = await Factory.deploy(PROTOCOL_FEE_RECIPIENT, PROTOCOL_BP);
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
  const expectedTempl = await factoryContract.createTempl.staticCall(
    PRIEST_ADDRESS,
    TOKEN_ADDRESS,
    ENTRY_FEE,
    BURN_BP,
    TREASURY_BP,
    MEMBER_POOL_BP
  );
  const createTx = await factoryContract.createTempl(
    PRIEST_ADDRESS,
    TOKEN_ADDRESS,
    ENTRY_FEE,
    BURN_BP,
    TREASURY_BP,
    MEMBER_POOL_BP
  );
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
    burnBasisPoints: BURN_BP,
    treasuryBasisPoints: TREASURY_BP,
    memberPoolBasisPoints: MEMBER_POOL_BP,
    protocolBasisPoints: PROTOCOL_BP,
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
    console.log(`npx hardhat verify --network base ${factoryAddress} ${PROTOCOL_FEE_RECIPIENT} ${PROTOCOL_BP}`);
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
