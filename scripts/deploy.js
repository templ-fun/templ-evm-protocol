const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
const Database = require("../src/database/db");
require("dotenv").config();

async function main() {
  const PRIEST_ADDRESS = process.env.PRIEST_ADDRESS;
  const TOKEN_ADDRESS = process.env.TOKEN_ADDRESS;
  const ENTRY_FEE = process.env.ENTRY_FEE || "420";
  
  if (!PRIEST_ADDRESS) {
    throw new Error("PRIEST_ADDRESS not set in environment - this is the address that can withdraw treasury funds");
  }
  
  if (!TOKEN_ADDRESS) {
    throw new Error("TOKEN_ADDRESS not set in environment");
  }
  if (parseInt(ENTRY_FEE) < 10) {
    throw new Error("ENTRY_FEE must be at least 10 wei for proper distribution");
  }

  console.log("========================================");
  console.log("Deploying TEMPL (Telegram Entry Management Protocol with DAO Governance)");
  console.log("========================================");
  console.log("Priest Address (Protocol Fee Receiver):", PRIEST_ADDRESS);
  console.log("Token Address:", TOKEN_ADDRESS);
  const thirtyPercent = Math.floor((parseInt(ENTRY_FEE) * 30) / 100);
  const tenPercent = Math.floor((parseInt(ENTRY_FEE) * 10) / 100);
  console.log("Entry Fee:", ENTRY_FEE, "(30% burn, 30% DAO treasury, 30% pool, 10% protocol)");
  console.log("  - Burn Amount:", thirtyPercent);
  console.log("  - DAO Treasury:", thirtyPercent, "(controlled by voting)");
  console.log("  - Member Pool:", thirtyPercent);
  console.log("  - Protocol Fee:", tenPercent);
  const [deployer] = await hre.ethers.getSigners();
  console.log("\nDeploying from:", deployer.address);
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Deployer balance:", hre.ethers.formatEther(balance), "ETH");
  
  const network = await hre.ethers.provider.getNetwork();
  console.log("Network: BASE", "Chain ID:", network.chainId);
  if (network.chainId !== 8453n) {
    console.log("\n⚠️  WARNING: Not deploying to BASE mainnet!");
    console.log("Expected Chain ID: 8453");
    console.log("Current Chain ID:", network.chainId);
    throw new Error("Wrong network - please connect to BASE mainnet");
  }
  
  console.log("\n⚠️  Deploying to BASE MAINNET");
  console.log("Please confirm the following:");
  console.log("1. Priest address is correct (receives 10% protocol fee only)");
  console.log("2. Entry fee amount is correct");
  console.log("3. Token address is correct");
  console.log("4. You have enough ETH on BASE for gas");
  console.log("5. Treasury will be controlled by DAO voting, not priest");
  await new Promise(resolve => setTimeout(resolve, 5000));
  console.log("\nDeploying TEMPL contract...");
  const TEMPL = await hre.ethers.getContractFactory("TEMPL");
  const contract = await TEMPL.deploy(
    PRIEST_ADDRESS,
    process.env.PROTOCOL_FEE_RECIPIENT || PRIEST_ADDRESS,  // Default to priest if not specified
    TOKEN_ADDRESS,
    ENTRY_FEE,
    process.env.PRIEST_VOTE_WEIGHT || 10,  // Default to 10 if not specified
    process.env.PRIEST_WEIGHT_THRESHOLD || 10  // Default to 10 members if not specified
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
  
  console.log("\n💰 Treasury & Pool Information:");
  console.log("- Treasury Balance:", treasuryInfo[0].toString());
  console.log("- Member Pool Balance:", treasuryInfo[1].toString());
  console.log("- Total to Treasury:", treasuryInfo[2].toString());
  console.log("- Total Burned:", treasuryInfo[3].toString());
  console.log("- Total to Protocol:", treasuryInfo[4].toString());
  console.log("- Protocol Address:", treasuryInfo[5]);
  if (treasuryInfo[5].toLowerCase() !== PRIEST_ADDRESS.toLowerCase()) {
    throw new Error("CRITICAL: Priest address mismatch! Contract deployment may have failed.");
  }
  const deploymentInfo = {
    contractVersion: "1.0.0",
    network: "base",
    chainId: 8453,
    contractAddress: contractAddress,
    priestAddress: PRIEST_ADDRESS,
    tokenAddress: TOKEN_ADDRESS,
    entryFee: ENTRY_FEE,
    treasuryAmount: thirtyPercent,
    burnAmount: thirtyPercent,
    memberPoolAmount: thirtyPercent,
    protocolFee: tenPercent,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    transactionHash: contract.deploymentTransaction().hash,
    abi: JSON.parse(contract.interface.formatJson()),
    basescanUrl: `https://basescan.org/address/${contractAddress}`,
    securityFeatures: [
      "30% burn / 30% DAO treasury / 30% member pool / 10% protocol split",
      "Pro-rata member pool distribution",
      "DAO-controlled treasury (voting required)",
      "Member-driven governance system",
      "Proposal and voting mechanisms",
      "Executable on-chain proposals",
      "Payment verification before access",
      "Reentrancy protection",
      "Overflow protection",
      "Member rewards system"
    ]
  };
  
  const deploymentPath = path.join(__dirname, "../deployments");
  if (!fs.existsSync(deploymentPath)) {
    fs.mkdirSync(deploymentPath, { recursive: true });
  }
  
  const filename = `deployment-base-${Date.now()}.json`;
  fs.writeFileSync(
    path.join(deploymentPath, filename),
    JSON.stringify(deploymentInfo, null, 2)
  );
  
  console.log("\n📁 Deployment info saved to deployments/" + filename);
  if (process.env.BASESCAN_API_KEY) {
    console.log("\nVerifying contract on Basescan...");
    try {
      await hre.run("verify:verify", {
        address: contractAddress,
        constructorArguments: [PRIEST_ADDRESS, TOKEN_ADDRESS, ENTRY_FEE],
      });
      console.log("✅ Contract verified on Basescan");
    } catch (error) {
      console.log("❌ Verification failed:", error.message);
      console.log("You can verify manually with:");
      console.log(`npx hardhat verify --network base ${contractAddress} ${PRIEST_ADDRESS} ${TOKEN_ADDRESS} ${ENTRY_FEE}`);
    }
  } else {
    console.log("\n💡 To verify on Basescan, add BASESCAN_API_KEY to .env");
  }
  
  // Register contract in database
  console.log("\n📚 Registering contract in database...");
  const db = new Database();
  try {
    await db.initialize();
    await db.registerContract(
      contractAddress.toLowerCase(),
      8453, // BASE chain ID
      TOKEN_ADDRESS.toLowerCase(),
      ENTRY_FEE,
      process.env.TELEGRAM_GROUP_ID || '-1001234567890',
      process.env.GROUP_TITLE || 'Premium Access Group'
    );
    console.log("✅ Contract registered in database");
    await db.close();
  } catch (dbError) {
    console.log("⚠️  Warning: Could not register contract in database:", dbError.message);
    console.log("You may need to manually register it or restart the service.");
  }
  
  // Update .env file with new contract address
  console.log("\n📝 Updating .env file...");
  try {
    const envPath = path.join(__dirname, "../.env");
    let envContent = fs.readFileSync(envPath, 'utf-8');
    
    if (envContent.includes('CONTRACT_ADDRESS=')) {
      envContent = envContent.replace(/CONTRACT_ADDRESS=.*/g, `CONTRACT_ADDRESS=${contractAddress}`);
    } else {
      envContent += `\nCONTRACT_ADDRESS=${contractAddress}`;
    }
    
    fs.writeFileSync(envPath, envContent);
    console.log("✅ Updated CONTRACT_ADDRESS in .env file");
  } catch (envError) {
    console.log("⚠️  Could not auto-update .env file:", envError.message);
    console.log(`Please manually add: CONTRACT_ADDRESS=${contractAddress}`);
  }
  
  console.log("\n========================================");
  console.log("🎉 DEPLOYMENT COMPLETE!");
  console.log("========================================");
  console.log("\n⚠️  IMPORTANT NEXT STEPS:");
  console.log("1. CONTRACT_ADDRESS has been updated in .env");
  console.log("2. Contract has been registered in the database");
  console.log("3. Restart the service with: npm start");
  console.log("\n🗳️ DAO Treasury Management:");
  console.log(`   Treasury controlled by member voting, not by priest`);
  console.log("   Members create proposals to withdraw treasury funds");
  console.log("   Proposals require >50% yes votes to pass");
  console.log("   Default voting period: 7 days");
  console.log("\n🔒 Security Features Active:");
  console.log("   ✅ 30% of fees are burned permanently");
  console.log("   ✅ 30% of fees go to DAO treasury (controlled by voting)");
  console.log("   ✅ 30% of fees go to member pool (claimable pro-rata)");
  console.log("   ✅ 10% protocol fee to priest address");
  console.log("   ✅ Users cannot join without paying");
  console.log("   ✅ One purchase per wallet enforced");
  console.log("   ✅ Treasury withdrawals require member voting");
  console.log("   ✅ Proposals need >50% yes votes to pass");
  console.log("\n📊 Access your DAO:");
  console.log(`   Create Proposals: http://yoursite.com/propose.html?contract=${contractAddress}`);
  console.log(`   Vote on Proposals: http://yoursite.com/vote.html?contract=${contractAddress}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ DEPLOYMENT FAILED:", error);
    process.exit(1);
  });