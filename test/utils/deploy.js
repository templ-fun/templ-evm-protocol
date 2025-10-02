const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { ethers } = require("hardhat");

const STATIC_CURVE = {
  primary: { style: 0, rateBps: 0 },
  secondary: { style: 0, rateBps: 0 },
  pivotPercentOfMax: 0,
};

const EXPONENTIAL_CURVE = {
  primary: { style: 2, rateBps: 11_000 },
  secondary: { style: 0, rateBps: 0 },
  pivotPercentOfMax: 0,
};

async function deployTempl({
  entryFee = ethers.parseUnits("100", 18),
  burnPercent = 3000,
  treasuryPercent = 3000,
  memberPoolPercent = 3000,
  protocolPercent = 1000,
  quorumPercent = 3300,
  executionDelay = 7 * 24 * 60 * 60,
  burnAddress = "0x000000000000000000000000000000000000dEaD",
  protocolFeeRecipient,
  priestIsDictator = false,
  maxMembers = 0,
  homeLink = "",
  curve = STATIC_CURVE,
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
      burnPercent,
      treasuryPercent,
      memberPoolPercent,
      protocolPercent,
      quorumPercent,
      executionDelay,
      burnAddress,
      priestIsDictator,
      maxMembers,
      homeLink,
      curve
    );
    await templ.waitForDeployment();
    try {
      const { attachCreateProposalCompat, attachProposalMetadataShim } = require("./proposal");
      attachCreateProposalCompat(templ);
      attachProposalMetadataShim(templ);
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
  STATIC_CURVE,
  EXPONENTIAL_CURVE,
};
