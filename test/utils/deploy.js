const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { ethers } = require("hardhat");

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
  feeCurveOverride = "constant",
  useFixture = true,
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
    const deployAsDictator = priestIsDictator || feeCurveOverride !== null;
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
      deployAsDictator,
      maxMembers,
      homeLink
    );
    await templ.waitForDeployment();
    if (feeCurveOverride !== null) {
      let formula = 0;
      let slope = 0n;
      let scale = ethers.parseUnits("1", 18);
      if (feeCurveOverride === "linear") {
        formula = 1;
        slope = ethers.parseUnits("1", 18);
        scale = 1n;
      } else if (feeCurveOverride === "exponential") {
        formula = 2;
        slope = ethers.parseUnits("1.1", 18);
        scale = ethers.parseUnits("1", 18);
      } else if (typeof feeCurveOverride === "object" && feeCurveOverride !== null) {
        formula = feeCurveOverride.formula ?? 0;
        slope = BigInt(feeCurveOverride.slope ?? 0);
        scale = BigInt(feeCurveOverride.scale ?? ethers.parseUnits("1", 18));
      }
      await templ.connect(priest).setFeeCurveDAO(formula, slope, scale);
    }
    if (!priestIsDictator && deployAsDictator) {
      await templ.connect(priest).setDictatorshipDAO(false);
    }
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

  if (useFixture) {
    return loadFixture(fixture);
  }
  return fixture();
}

module.exports = {
  deployTempl,
};
