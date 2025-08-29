const hre = require("hardhat");

async function main() {
  const [signer] = await hre.ethers.getSigners();
  const testWalletAddress = "0xC35Db6C7d05dc4421Af552eB328C035dbE8eCC83";
  
  console.log("Funding test wallet:", testWalletAddress);
  console.log("From:", signer.address);
  
  const tx = await signer.sendTransaction({
    to: testWalletAddress,
    value: hre.ethers.parseEther("1.0")
  });
  
  await tx.wait();
  
  const balance = await hre.ethers.provider.getBalance(testWalletAddress);
  console.log("Test wallet balance:", hre.ethers.formatEther(balance), "ETH");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });