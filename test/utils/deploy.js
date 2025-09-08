const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { ethers } = require("hardhat");

async function deployTempl({ entryFee = ethers.parseUnits("100", 18) } = {}) {
  async function fixture() {
    const accounts = await ethers.getSigners();
    const [owner, priest] = accounts;

    const Token = await ethers.getContractFactory(
      "contracts/mocks/TestToken.sol:TestToken"
    );
    const token = await Token.deploy("Test Token", "TEST", 18);
    await token.waitForDeployment();

    const TEMPL = await ethers.getContractFactory("TEMPL");
    const templ = await TEMPL.deploy(
      priest.address,
      priest.address,
      await token.getAddress(),
      entryFee
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
