const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");

// Helper to build a very large curve with many additional segments
function buildOversizedCurve({ segments = 9000 } = {}) {
  // Primary must have non-zero length when additional segments exist
  const primary = { style: 1, rateBps: 0, length: 1 }; // Linear, length>0
  const additionalSegments = new Array(segments).fill(null).map((_, i) => {
    const isLast = i === segments - 1;
    return {
      style: 1, // Linear
      rateBps: 0,
      length: isLast ? 0 : 1 // last segment must have length=0, others > 0
    };
  });
  return { primary, additionalSegments };
}

describe("Oversized inputs explode (expected fail)", function () {
  it("reverts creating a curve proposal with a very large additionalSegments array (out-of-gas)", async function () {
    const { templ } = await deployTempl();
    const [ , priest ] = await ethers.getSigners();

    // Large enough to exceed the default Hardhat block gas limit during storage writes
    const hugeCurve = buildOversizedCurve({ segments: 9000 });
    const base = await templ.baseEntryFee();

    await expect(
      templ
        .connect(priest)
        .createProposalSetEntryFeeCurve(
          hugeCurve,
          base,
          7 * 24 * 60 * 60,
          "Huge curve",
          "Expect OOG during proposal storage"
        )
    ).to.be.reverted;
  });

  it("reverts creating a proposal with extremely large metadata strings (out-of-gas)", async function () {
    const { templ } = await deployTempl();
    const [ , priest ] = await ethers.getSigners();

    // Construct very large strings (~800 KB total) to blow past block gas on storage
    const hugeTitle = "T".repeat(100_000);
    const hugeDescription = "D".repeat(700_000);

    await expect(
      templ
        .connect(priest)
        .createProposalSetJoinPaused(
          true,
          7 * 24 * 60 * 60,
          hugeTitle,
          hugeDescription
        )
    ).to.be.reverted;
  });
});

