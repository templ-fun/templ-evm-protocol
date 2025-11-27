const { ethers } = require("hardhat");

async function deployTemplModules() {
  const MembershipModule = await ethers.getContractFactory("TemplMembershipModule");
  const membershipModule = await MembershipModule.deploy();
  await membershipModule.waitForDeployment();

  const TreasuryModule = await ethers.getContractFactory("TemplTreasuryModule");
  const treasuryModule = await TreasuryModule.deploy();
  await treasuryModule.waitForDeployment();

  const GovernanceModule = await ethers.getContractFactory("TemplGovernanceModule");
  const governanceModule = await GovernanceModule.deploy();
  await governanceModule.waitForDeployment();

  const CouncilModule = await ethers.getContractFactory("TemplCouncilModule");
  const councilModule = await CouncilModule.deploy();
  await councilModule.waitForDeployment();

  return {
    membershipModule: await membershipModule.getAddress(),
    treasuryModule: await treasuryModule.getAddress(),
    governanceModule: await governanceModule.getAddress(),
    councilModule: await councilModule.getAddress()
  };
}

async function deployTemplDeployer() {
  const Deployer = await ethers.getContractFactory("TemplDeployer");
  const instance = await Deployer.deploy();
  await instance.waitForDeployment();
  return instance.getAddress();
}

module.exports = {
  deployTemplModules,
  deployTemplDeployer,
};
