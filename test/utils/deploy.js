const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { ethers } = require("hardhat");

async function deployTempl({
  entryFee = ethers.parseUnits("100", 18),
  burnBP = 30,
  treasuryBP = 30,
  memberPoolBP = 30,
  protocolBP = 10,
  protocolFeeRecipient
} = {}) {
  async function fixture() {
    const accounts = await ethers.getSigners();
    const [owner, priest] = accounts;

    const Token = await ethers.getContractFactory(
      "contracts/mocks/TestToken.sol:TestToken"
    );
    const token = await Token.deploy("Test Token", "TEST", 18);
    await token.waitForDeployment();

    const TEMPL = await ethers.getContractFactory("TEMPL");
    const protocolRecipient = protocolFeeRecipient || priest.address;
    const templ = await TEMPL.deploy(
      priest.address,
      protocolRecipient,
      await token.getAddress(),
      entryFee,
      burnBP,
      treasuryBP,
      memberPoolBP,
      protocolBP
    );
    await templ.waitForDeployment();
    try {
      const { attachCreateProposalCompat } = require("./proposal");
      attachCreateProposalCompat(templ);
    } catch {}

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
