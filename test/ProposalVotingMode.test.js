const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");

describe("Proposal voting mode view", function () {
  const ENTRY_FEE = ethers.parseUnits("100", 18);
  const VOTING_PERIOD = 7 * 24 * 60 * 60;

  it("reports member voting mode when council mode is disabled", async function () {
    const { templ, priest } = await deployTempl({ entryFee: ENTRY_FEE, councilMode: false });

    await templ
      .connect(priest)
      .createProposalSetBurnAddress("0x00000000000000000000000000000000000000c1", VOTING_PERIOD, "burn", "");
    const proposalId = (await templ.proposalCount()) - 1n;

    const [councilOnly, snapshotEpoch] = await templ.getProposalVotingMode(proposalId);
    expect(councilOnly).to.equal(false);
    expect(snapshotEpoch).to.equal(0n);
  });

  it("reports council voting mode and snapshot epoch when council mode is enabled", async function () {
    const { templ, priest } = await deployTempl({ entryFee: ENTRY_FEE, councilMode: true });

    await templ
      .connect(priest)
      .createProposalSetBurnAddress("0x00000000000000000000000000000000000000c2", VOTING_PERIOD, "burn", "");
    const proposalId = (await templ.proposalCount()) - 1n;

    const [councilOnly, snapshotEpoch] = await templ.getProposalVotingMode(proposalId);
    expect(councilOnly).to.equal(true);
    expect(snapshotEpoch).to.equal(await templ.councilEpoch());
  });
});
