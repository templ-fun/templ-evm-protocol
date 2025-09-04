const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { ethers } = require("hardhat");

async function deployTempl({ entryFee = ethers.parseUnits("100", 18), priestVoteWeight = 10, priestWeightThreshold = 10 } = {}) {
  async function fixture() {
    const accounts = await ethers.getSigners();
    const [owner, priest] = accounts;

    const Token = await ethers.getContractFactory("TestToken");
    const token = await Token.deploy("Test Token", "TEST", 18);
    await token.waitForDeployment();

    const TEMPL = await ethers.getContractFactory("TEMPL");
    const templ = await TEMPL.deploy(
      priest.address,
      priest.address,
      await token.getAddress(),
      entryFee,
      priestVoteWeight,
      priestWeightThreshold
    );
    await templ.waitForDeployment();

    return {
      templ,
      token,
      accounts,
      owner,
      priest,
    };
  }

  return loadFixture(fixture);
}

module.exports = {
  deployTempl,
};
