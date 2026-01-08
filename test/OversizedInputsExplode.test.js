const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");

const MAX_CURVE_SEGMENTS = 8;
const MAX_PROPOSAL_TITLE_LENGTH = 256;
const MAX_PROPOSAL_DESCRIPTION_LENGTH = 2048;

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
});
