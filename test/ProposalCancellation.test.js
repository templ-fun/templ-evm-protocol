const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, joinMembers } = require("./utils/mintAndPurchase");

const ENTRY_FEE = ethers.parseUnits("100", 18);
const VOTING_PERIOD = 36 * 60 * 60;

describe("Proposal cancellation", function () {
  it("allows the proposer to cancel before any other votes and clears active state", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, , proposer, voter] = accounts;

    await mintToUsers(token, [proposer, voter], ENTRY_FEE * 3n);
    await joinMembers(templ, token, [proposer, voter], ENTRY_FEE);

    await templ.connect(proposer).createProposalSetJoinPaused(true, VOTING_PERIOD, "Pause", "Test");
    const proposalId = (await templ.proposalCount()) - 1n;

    await expect(templ.connect(proposer).cancelProposal(proposalId))
      .to.emit(templ, "ProposalCancelled")
      .withArgs(proposalId, proposer.address);

    expect(await templ.hasActiveProposal(proposer.address)).to.equal(false);
    expect(await templ.activeProposalId(proposer.address)).to.equal(0n);

    const active = await templ.getActiveProposals();
    expect(active).to.not.include(proposalId);

    const proposal = await templ.getProposal(proposalId);
    expect(proposal[4]).to.equal(true); // executed flag set on cancel

    await expect(templ.executeProposal(proposalId))
      .to.be.revertedWithCustomError(templ, "AlreadyExecuted");
  });

  it("reverts cancellation attempts by non-proposers or after other votes", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, , proposer, voter, outsider] = accounts;

    await mintToUsers(token, [proposer, voter, outsider], ENTRY_FEE * 3n);
    await joinMembers(templ, token, [proposer, voter, outsider], ENTRY_FEE);

    await templ.connect(proposer).createProposalSetJoinPaused(true, VOTING_PERIOD, "Pause", "Test");
    const proposalId = (await templ.proposalCount()) - 1n;

    await expect(templ.connect(outsider).cancelProposal(proposalId))
      .to.be.revertedWithCustomError(templ, "InvalidCallData");

    await templ.connect(voter).vote(proposalId, true);

    await expect(templ.connect(proposer).cancelProposal(proposalId))
      .to.be.revertedWithCustomError(templ, "InvalidCallData");
  });
});
