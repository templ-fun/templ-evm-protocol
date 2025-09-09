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

  if (!TOKEN_ADDRESS) {
    throw new Error("TOKEN_ADDRESS not set in environment");
  }
  if (!PROTOCOL_FEE_RECIPIENT) {
    throw new Error("PROTOCOL_FEE_RECIPIENT not set in environment");
  }
  if (!ENTRY_FEE) {
    throw new Error("ENTRY_FEE not set in environment");
  }

  const entryFee = BigInt(ENTRY_FEE);
  if (entryFee < 10n) {
    throw new Error("ENTRY_FEE must be at least 10 wei for proper distribution");
  }

  console.log("========================================");
  console.log("Deploying TEMPL Contract");
  console.log("========================================");
  console.log("Priest Address:", PRIEST_ADDRESS);
  console.log("Protocol Fee Recipient:", PROTOCOL_FEE_RECIPIENT);
  console.log("Token Address:", TOKEN_ADDRESS);
  // Governance: one address = one vote
  
  const thirtyPercent = (entryFee * 30n) / 100n;
  const tenPercent = (entryFee * 10n) / 100n;
  console.log("\nEntry Fee:", entryFee.toString());
  console.log("Fee Split:");
  console.log("  - 30% Burn:", thirtyPercent.toString());
  console.log("  - 30% DAO Treasury:", thirtyPercent.toString());
  console.log("  - 30% Member Pool:", thirtyPercent.toString());
  console.log("  - 10% Protocol Fee:", tenPercent.toString());
  
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
  
  console.log("\nDeploying TEMPL contract...");
  const TEMPL = await hre.ethers.getContractFactory("TEMPL");
  const contract = await TEMPL.deploy(
    PRIEST_ADDRESS,
    PROTOCOL_FEE_RECIPIENT,
    TOKEN_ADDRESS,
    ENTRY_FEE
  );
  
  await contract.waitForDeployment();
  const contractAddress = await contract.getAddress();
  
  console.log("✅ Contract deployed to:", contractAddress);
  console.log("Transaction hash:", contract.deploymentTransaction().hash);
  console.log("Waiting for confirmations...");
  await contract.deploymentTransaction().wait(2);
  
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
    tokenAddress: TOKEN_ADDRESS,
    entryFee: ENTRY_FEE,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    transactionHash: contract.deploymentTransaction().hash,
    abi: JSON.parse(contract.interface.formatJson())
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
  
  // Verify on BaseScan if on mainnet
  if (network.chainId === 8453n && process.env.BASESCAN_API_KEY) {
    console.log("\nVerifying contract on Basescan...");
    try {
      await hre.run("verify:verify", {
        address: contractAddress,
        constructorArguments: [
          PRIEST_ADDRESS,
          PROTOCOL_FEE_RECIPIENT,
          TOKEN_ADDRESS,
          ENTRY_FEE
        ],
      });
      console.log("✅ Contract verified on Basescan");
    } catch (error) {
      console.log("❌ Verification failed:", error.message);
      console.log("You can verify manually with:");
      console.log(`npx hardhat verify --network base ${contractAddress} ${PRIEST_ADDRESS} ${PROTOCOL_FEE_RECIPIENT} ${TOKEN_ADDRESS} ${ENTRY_FEE}`);
    }
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
