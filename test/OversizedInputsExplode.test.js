const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, joinMembers } = require("./utils/mintAndPurchase");
const { deployTemplModules } = require("./utils/modules");
const { attachTemplInterface } = require("./utils/templ");

const MAX_CURVE_SEGMENTS = 8;
const MAX_PROPOSAL_TITLE_LENGTH = 256;
const MAX_PROPOSAL_DESCRIPTION_LENGTH = 2048;
const MAX_TEMPL_NAME_LENGTH = 256;
const MAX_TEMPL_DESCRIPTION_LENGTH = 2048;
const MAX_TEMPL_LOGO_URI_LENGTH = 2048;

// Helper to build a curve that violates the max segment limit.
function buildTooManySegmentsCurve(extraSegments) {
  const primary = { style: 1, rateBps: 0, length: 1 };
  const additionalSegments = new Array(extraSegments).fill(null).map((_, i) => {
    const isLast = i === extraSegments - 1;
    return {
      style: 1,
      rateBps: 0,
      length: isLast ? 0 : 1
    };
  });
  return { primary, additionalSegments };
}

describe("Oversized inputs are rejected", function () {
  it("reverts when the curve exceeds the maximum segment count", async function () {
    const { templ } = await deployTempl();
    const [ , priest ] = await ethers.getSigners();

    const tooManySegments = MAX_CURVE_SEGMENTS; // extras + primary > MAX_CURVE_SEGMENTS
    const hugeCurve = buildTooManySegmentsCurve(tooManySegments);
    const base = await templ.baseEntryFee();

    await expect(
      templ
        .connect(priest)
        .createProposalSetEntryFeeCurve(
          hugeCurve,
          base,
          7 * 24 * 60 * 60,
          "Too many segments",
          "Expect InvalidCurveConfig"
        )
    ).to.be.revertedWithCustomError(templ, "InvalidCurveConfig");
  });

  it("reverts when proposal title or description exceeds the max length", async function () {
    const { templ } = await deployTempl();
    const [ , priest ] = await ethers.getSigners();

    const hugeTitle = "T".repeat(MAX_PROPOSAL_TITLE_LENGTH + 1);
    const hugeDescription = "D".repeat(MAX_PROPOSAL_DESCRIPTION_LENGTH + 1);

    await expect(
      templ
        .connect(priest)
        .createProposalSetJoinPaused(
          true,
          7 * 24 * 60 * 60,
          hugeTitle,
          ""
        )
    ).to.be.revertedWithCustomError(templ, "InvalidCallData");

    await expect(
      templ
        .connect(priest)
        .createProposalSetJoinPaused(
          true,
          7 * 24 * 60 * 60,
          "Valid",
          hugeDescription
        )
    ).to.be.revertedWithCustomError(templ, "InvalidCallData");
  });

  it("reverts when templ metadata fields exceed the max length (onlyDAO)", async function () {
    const [, priest, protocol] = await ethers.getSigners();
    const AccessToken = await ethers.getContractFactory("contracts/mocks/TestToken.sol:TestToken");
    const accessToken = await AccessToken.deploy("Access", "ACC", 18);
    await accessToken.waitForDeployment();
    const Harness = await ethers.getContractFactory(
      "contracts/mocks/DaoCallerHarness.sol:DaoCallerHarness"
    );
    const modules = await deployTemplModules();
    let templ = await Harness.deploy(
      priest.address,
      protocol.address,
      accessToken.target,
      ethers.parseUnits("100", 18),
      modules.membershipModule,
      modules.treasuryModule,
      modules.governanceModule,
      modules.councilModule
    );
    await templ.waitForDeployment();
    templ = await attachTemplInterface(templ);

    const longName = "N".repeat(MAX_TEMPL_NAME_LENGTH + 1);
    const longDescription = "D".repeat(MAX_TEMPL_DESCRIPTION_LENGTH + 1);
    const longLogo = "L".repeat(MAX_TEMPL_LOGO_URI_LENGTH + 1);

    await expect(
      templ.daoSetMetadata(longName, "ok", "ok")
    ).to.be.revertedWithCustomError(templ, "InvalidCallData");

    await expect(
      templ.daoSetMetadata("ok", longDescription, "ok")
    ).to.be.revertedWithCustomError(templ, "InvalidCallData");

    await expect(
      templ.daoSetMetadata("ok", "ok", longLogo)
    ).to.be.revertedWithCustomError(templ, "InvalidCallData");
  });

  it("reverts when proposal metadata exceeds limits at creation", async function () {
    const { templ, token, accounts } = await deployTempl();
    const [, , proposer] = accounts;
    const ENTRY_FEE = ethers.parseUnits("100", 18);
    const VOTING_PERIOD = 7 * 24 * 60 * 60;

    await mintToUsers(token, [proposer], ENTRY_FEE * 5n);
    await joinMembers(templ, token, [proposer]);

    const longName = "N".repeat(MAX_TEMPL_NAME_LENGTH + 1);
    const longDescription = "D".repeat(MAX_TEMPL_DESCRIPTION_LENGTH + 1);
    const longLogo = "L".repeat(MAX_TEMPL_LOGO_URI_LENGTH + 1);

    await expect(
      templ
        .connect(proposer)
        .createProposalUpdateMetadata(longName, "ok", "ok", VOTING_PERIOD, "Meta", "")
    ).to.be.revertedWithCustomError(templ, "InvalidCallData");

    await expect(
      templ
        .connect(proposer)
        .createProposalUpdateMetadata("ok", longDescription, "ok", VOTING_PERIOD, "Meta", "")
    ).to.be.revertedWithCustomError(templ, "InvalidCallData");

    await expect(
      templ
        .connect(proposer)
        .createProposalUpdateMetadata("ok", "ok", longLogo, VOTING_PERIOD, "Meta", "")
    ).to.be.revertedWithCustomError(templ, "InvalidCallData");
  });
});
