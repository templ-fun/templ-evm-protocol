const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, joinMembers } = require("./utils/mintAndPurchase");

const ENTRY_FEE = ethers.parseUnits("100", 18);
const TOKEN_SUPPLY = ethers.parseUnits("10000", 18);
const WEEK = 7 * 24 * 60 * 60;
const EIGHT_DAYS = 8 * 24 * 60 * 60;

async function advanceTime(seconds = EIGHT_DAYS) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine");
}

async function setupTempl(overrides = {}) {
  const ctx = await deployTempl({ entryFee: ENTRY_FEE, ...overrides });
  const { templ, token, accounts } = ctx;
  const [owner, priest, member1, member2, member3, member4] = accounts;
  await mintToUsers(token, [member1, member2, member3, member4], TOKEN_SUPPLY);
  await joinMembers(templ, token, [member1, member2, member3, member4]);
  return { templ, token, owner, priest, member1, member2, member3, member4 };
}

async function enableCouncilMode(templ, proposer, voters) {
  await templ.connect(proposer).createProposalSetCouncilMode(true, WEEK, "Enable council", "");
  const proposalId = (await templ.proposalCount()) - 1n;
  for (const voter of voters) {
    await templ.connect(voter).vote(proposalId, true);
  }
  await advanceTime();
  await templ.executeProposal(proposalId);
}

describe("Council governance", function () {
  it("keeps proposal voting mode fixed when council mode toggles", async function () {
    const { templ, member1, member2, member3 } = await setupTempl({ councilMode: false });
    const longVotingPeriod = 14 * 24 * 60 * 60;

    await templ
      .connect(member1)
      .createProposalSetBurnAddress("0x0000000000000000000000000000000000000101", longVotingPeriod, "burn", "");
    const memberProposalId = (await templ.proposalCount()) - 1n;

    await templ.connect(member2).createProposalSetCouncilMode(true, WEEK, "Enable council", "");
    const councilProposalId = (await templ.proposalCount()) - 1n;
    await templ.connect(member1).vote(councilProposalId, true);
    await templ.connect(member3).vote(councilProposalId, true);
    await advanceTime();
    await templ.executeProposal(councilProposalId);
    expect(await templ.councilModeEnabled()).to.equal(true);

    await expect(templ.connect(member3).vote(memberProposalId, true)).to.emit(templ, "VoteCast");
  });

  it("snapshots member quorum denominators even after council mode is enabled", async function () {
    const { templ, member1, member2, member3, member4 } = await setupTempl({ councilMode: false });

    await templ.connect(member1).createProposalAddCouncilMember(member2.address, WEEK, "Add council", "");
    let proposalId = (await templ.proposalCount()) - 1n;
    await templ.connect(member3).vote(proposalId, true);
    await templ.connect(member4).vote(proposalId, true);
    await advanceTime();
    await templ.executeProposal(proposalId);
    expect(await templ.councilMemberCount()).to.equal(2n);

    const longVotingPeriod = 14 * 24 * 60 * 60;
    await templ
      .connect(member1)
      .createProposalSetBurnAddress("0x0000000000000000000000000000000000000102", longVotingPeriod, "burn", "");
    const memberProposalId = (await templ.proposalCount()) - 1n;

    await templ.connect(member3).createProposalSetCouncilMode(true, WEEK, "Enable council", "");
    proposalId = (await templ.proposalCount()) - 1n;
    await templ.connect(member1).vote(proposalId, true);
    await templ.connect(member4).vote(proposalId, true);
    await advanceTime();
    await templ.executeProposal(proposalId);
    expect(await templ.councilModeEnabled()).to.equal(true);

    await templ.connect(member4).vote(memberProposalId, true);

    const [, postQuorumEligibleVoters] = await templ.getProposalSnapshots(memberProposalId);
    expect(postQuorumEligibleVoters).to.equal(await templ.memberCount());
  });

  it("freezes council membership for active proposals", async function () {
    const { templ, priest, member1, member2 } = await setupTempl({ councilMode: true });
    const longVotingPeriod = 14 * 24 * 60 * 60;

    await templ
      .connect(member1)
      .createProposalSetBurnAddress("0x0000000000000000000000000000000000000202", longVotingPeriod, "burn", "");
    const memberProposalId = (await templ.proposalCount()) - 1n;

    await templ
      .connect(member2)
      .createProposalAddCouncilMember(member2.address, WEEK, "Add member2", "");
    const councilProposalId = (await templ.proposalCount()) - 1n;
    await templ.connect(priest).vote(councilProposalId, true);
    await advanceTime();
    await templ.executeProposal(councilProposalId);
    expect(await templ.councilMembers(member2.address)).to.equal(true);

    await expect(templ.connect(member2).vote(memberProposalId, true))
      .to.be.revertedWithCustomError(templ, "NotCouncil");
  });

  it("preserves council snapshot eligibility across remove and re-add", async function () {
    const { templ, priest, member1, member2 } = await setupTempl({ councilMode: true });
    const longVotingPeriod = 14 * 24 * 60 * 60;
    const twoDays = 2 * 24 * 60 * 60;

    await templ.connect(member2).createProposalAddCouncilMember(member1.address, WEEK, "Add member1", "");
    let proposalId = (await templ.proposalCount()) - 1n;
    await templ.connect(priest).vote(proposalId, true);
    await advanceTime(twoDays);
    await templ.executeProposal(proposalId);
    expect(await templ.councilMembers(member1.address)).to.equal(true);

    const longBurn = "0x0000000000000000000000000000000000000203";
    await templ.connect(member2).createProposalSetBurnAddress(longBurn, longVotingPeriod, "long burn", "");
    const longProposalId = (await templ.proposalCount()) - 1n;

    await templ.connect(member1).createProposalRemoveCouncilMember(member1.address, WEEK, "remove member1", "");
    proposalId = (await templ.proposalCount()) - 1n;
    await templ.connect(priest).vote(proposalId, true);
    await advanceTime(twoDays);
    await templ.executeProposal(proposalId);
    expect(await templ.councilMembers(member1.address)).to.equal(false);

    await templ.connect(priest).createProposalAddCouncilMember(member1.address, WEEK, "re-add member1", "");
    proposalId = (await templ.proposalCount()) - 1n;
    await advanceTime(twoDays);
    await templ.executeProposal(proposalId);
    expect(await templ.councilMembers(member1.address)).to.equal(true);

    await expect(templ.connect(member1).vote(longProposalId, true)).to.emit(templ, "VoteCast");
  });

  it("restricts voting to council members and supports governance onboarding", async function () {
    const { templ, priest, member1, member2, member3 } = await setupTempl();

    await enableCouncilMode(templ, member1, [member2, member3]);
    expect(await templ.councilModeEnabled()).to.equal(true);
    expect(await templ.councilMemberCount()).to.equal(1n);

    await templ.connect(member1).createProposalAddCouncilMember(member1.address, WEEK, "Add council", "");
    const addId = (await templ.proposalCount()) - 1n;
    await templ.connect(priest).vote(addId, true);
    await advanceTime();
    await templ.executeProposal(addId);
    expect(await templ.councilMembers(member1.address)).to.equal(true);

    const newBurn = "0x0000000000000000000000000000000000000011";
    await templ.connect(member2).createProposalSetBurnAddress(newBurn, WEEK, "update burn", "");
    const proposalId = (await templ.proposalCount()) - 1n;
    const [voted] = await templ.hasVoted(proposalId, member2.address);
    expect(voted).to.equal(false);
    await expect(templ.connect(member2).vote(proposalId, true))
      .to.be.revertedWithCustomError(templ, "NotCouncil");

    await templ.connect(priest).vote(proposalId, true);
    await advanceTime();
    await templ.executeProposal(proposalId);
    expect(await templ.burnAddress()).to.equal(newBurn);
  });

  it("does not auto-YES for non-council proposers in council mode", async function () {
    const { templ, priest, member1 } = await setupTempl({ councilMode: true });

    await templ
      .connect(member1)
      .createProposalSetBurnAddress("0x0000000000000000000000000000000000000033", WEEK, "burn", "");
    const proposalId = (await templ.proposalCount()) - 1n;

    const proposal = await templ.getProposal(proposalId);
    expect(proposal.yesVotes).to.equal(0n);
    const [voted] = await templ.hasVoted(proposalId, member1.address);
    expect(voted).to.equal(false);

    await templ.connect(priest).vote(proposalId, true);
    const proposalAfter = await templ.getProposal(proposalId);
    expect(proposalAfter.yesVotes).to.equal(1n);
  });

  it("rejects priest bootstrap council additions after deploy", async function () {
    const { templ, priest, member1 } = await setupTempl({ councilMode: true });
    const iface = new ethers.Interface(["function bootstrapCouncilMember(address)"]);
    const data = iface.encodeFunctionData("bootstrapCouncilMember", [member1.address]);
    await expect(priest.sendTransaction({ to: await templ.getAddress(), data }))
      .to.be.revertedWithCustomError(templ, "InvalidCallData");
  });

  it("allows governance to add and remove council members", async function () {
    const { templ, priest, member1, member2, member3 } = await setupTempl();

    await enableCouncilMode(templ, member1, [member2, member3]);
    await templ.connect(member1).createProposalAddCouncilMember(member1.address, WEEK, "Add member1", "");
    let proposalId = (await templ.proposalCount()) - 1n;
    await templ.connect(priest).vote(proposalId, true);
    await advanceTime();
    await templ.executeProposal(proposalId);
    expect(await templ.councilMemberCount()).to.equal(2n);

    await templ.connect(member1).createProposalAddCouncilMember(member2.address, WEEK, "Add member2", "");
    proposalId = (await templ.proposalCount()) - 1n;
    await templ.connect(priest).vote(proposalId, true);
    await advanceTime();
    await templ.executeProposal(proposalId);
    expect(await templ.councilMembers(member2.address)).to.equal(true);
    expect(await templ.councilMemberCount()).to.equal(3n);

    await expect(
      templ.connect(member1).createProposalAddCouncilMember(member2.address, WEEK, "dup add", "")
    ).to.be.revertedWithCustomError(templ, "CouncilMemberExists");
    await expect(
      templ.connect(member3).createProposalRemoveCouncilMember(member2.address, WEEK, "remove", "")
    ).to.be.revertedWithCustomError(templ, "NotCouncil");

    await templ.connect(member1).createProposalRemoveCouncilMember(member2.address, WEEK, "remove member2", "");
    proposalId = (await templ.proposalCount()) - 1n;
    await templ.connect(priest).vote(proposalId, true);
    await templ.connect(member1).vote(proposalId, true);
    await advanceTime();
    await templ.executeProposal(proposalId);
    expect(await templ.councilMembers(member2.address)).to.equal(false);
    expect(await templ.councilMemberCount()).to.equal(2n);

    await templ.connect(member1).createProposalRemoveCouncilMember(priest.address, WEEK, "remove priest", "");
    proposalId = (await templ.proposalCount()) - 1n;
    await templ.connect(priest).vote(proposalId, true);
    await advanceTime();
    await templ.executeProposal(proposalId);
    expect(await templ.councilMembers(priest.address)).to.equal(false);
    expect(await templ.councilMemberCount()).to.equal(1n);

    const soloBurn = "0x0000000000000000000000000000000000000020";
    await templ.connect(member1).createProposalSetBurnAddress(soloBurn, WEEK, "solo burn", "");
    proposalId = (await templ.proposalCount()) - 1n;
    await templ.executeProposal(proposalId);
    expect(await templ.burnAddress()).to.equal(soloBurn);

    await expect(
      templ.connect(member1).createProposalRemoveCouncilMember(member1.address, WEEK, "remove last", "")
    ).to.be.revertedWithCustomError(templ, "CouncilMemberMinimum");
  });

  it("updates YES vote threshold and enforces the configured ratio", async function () {
    const { templ, member1, member2, member3, member4 } = await setupTempl();

    await templ.connect(member1).createProposalSetYesVoteThreshold(7000, WEEK, "raise yes threshold", "");
    let proposalId = (await templ.proposalCount()) - 1n;
    await templ.connect(member2).vote(proposalId, true);
    await templ.connect(member3).vote(proposalId, true);
    await advanceTime();
    await templ.executeProposal(proposalId);
    expect(await templ.yesVoteThresholdBps()).to.equal(7000n);

    const failingBurn = "0x0000000000000000000000000000000000000012";
    await templ.connect(member1).createProposalSetBurnAddress(failingBurn, WEEK, "failing burn", "");
    proposalId = (await templ.proposalCount()) - 1n;
    await templ.connect(member2).vote(proposalId, true);
    await templ.connect(member3).vote(proposalId, false);
    await advanceTime();
    await expect(templ.executeProposal(proposalId))
      .to.be.revertedWithCustomError(templ, "ProposalNotPassed");
    expect(await templ.burnAddress()).to.not.equal(failingBurn);

    const passingBurn = "0x0000000000000000000000000000000000000013";
    await templ.connect(member1).createProposalSetBurnAddress(passingBurn, WEEK, "passing burn", "");
    proposalId = (await templ.proposalCount()) - 1n;
    await templ.connect(member2).vote(proposalId, true);
    await templ.connect(member3).vote(proposalId, true);
    await templ.connect(member4).vote(proposalId, false);
    await advanceTime();
    await templ.executeProposal(proposalId);
    expect(await templ.burnAddress()).to.equal(passingBurn);
  });

  it("charges proposal fees for non-council proposers and waives for council proposers", async function () {
    const { templ, token, priest, member1, member2 } = await setupTempl({ proposalFeeBps: 1_000 });

    const templAddress = await templ.getAddress();
    await token.connect(member1).approve(templAddress, ethers.MaxUint256);
    await token.connect(member2).approve(templAddress, ethers.MaxUint256);
    await token.connect(priest).approve(templAddress, ethers.MaxUint256);

    await enableCouncilMode(templ, member1, [member2]);
    await templ.connect(member1).createProposalAddCouncilMember(member1.address, WEEK, "Add member1", "");
    const addId = (await templ.proposalCount()) - 1n;
    await templ.connect(priest).vote(addId, true);
    await advanceTime();
    await templ.executeProposal(addId);

    const fee = (await templ.entryFee()) * (await templ.proposalCreationFeeBps()) / 10_000n;

    // Non-council proposer pays the fee
    const nonCouncilBalanceBefore = await token.balanceOf(member2.address);
    const treasuryBefore = await templ.treasuryBalance();
    await templ
      .connect(member2)
      .createProposalSetBurnAddress("0x00000000000000000000000000000000000000AA", WEEK, "Non-council", "");
    expect(await templ.treasuryBalance()).to.equal(treasuryBefore + fee);
    expect(nonCouncilBalanceBefore - (await token.balanceOf(member2.address))).to.equal(fee);

    // Council proposer is fee-exempt
    const councilBalanceBefore = await token.balanceOf(member1.address);
    const treasuryAfter = await templ.treasuryBalance();
    await templ
      .connect(member1)
      .createProposalSetBurnAddress("0x00000000000000000000000000000000000000BB", WEEK, "Council", "");
    expect(await templ.treasuryBalance()).to.equal(treasuryAfter);
    expect(councilBalanceBefore - (await token.balanceOf(member1.address))).to.equal(0n);
  });

  it("charges proposal fees again after council mode is disabled", async function () {
    const { templ, token, priest, member1, member2 } = await setupTempl({ proposalFeeBps: 1_000 });

    const templAddress = await templ.getAddress();
    await token.connect(member1).approve(templAddress, ethers.MaxUint256);
    await token.connect(member2).approve(templAddress, ethers.MaxUint256);
    await token.connect(priest).approve(templAddress, ethers.MaxUint256);

    await enableCouncilMode(templ, member1, [member2]);
    await templ.connect(member1).createProposalAddCouncilMember(member1.address, WEEK, "Add member1", "");
    const addId = (await templ.proposalCount()) - 1n;
    await templ.connect(priest).vote(addId, true);
    await advanceTime();
    await templ.executeProposal(addId);

    await templ.connect(member1).createProposalSetCouncilMode(false, WEEK, "Disable council", "");
    const disableId = (await templ.proposalCount()) - 1n;
    await templ.connect(priest).vote(disableId, true);
    await advanceTime();
    await templ.executeProposal(disableId);
    expect(await templ.councilModeEnabled()).to.equal(false);

    const fee = (await templ.entryFee()) * (await templ.proposalCreationFeeBps()) / 10_000n;
    const balanceBefore = await token.balanceOf(member1.address);
    const treasuryBefore = await templ.treasuryBalance();

    await templ
      .connect(member1)
      .createProposalSetBurnAddress("0x00000000000000000000000000000000000000CC", WEEK, "Fee returns", "");
    expect(await templ.treasuryBalance()).to.equal(treasuryBefore + fee);
    expect(balanceBefore - (await token.balanceOf(member1.address))).to.equal(fee);
  });

  it("rejects invalid council proposal inputs", async function () {
    const { templ, priest, member1 } = await setupTempl();
    const outsider = (await ethers.getSigners())[7];

    await expect(
      templ.connect(member1).createProposalSetYesVoteThreshold(99, WEEK, "too low", "")
    ).to.be.revertedWithCustomError(templ, "InvalidPercentage");
    await expect(
      templ.connect(member1).createProposalSetYesVoteThreshold(10_001, WEEK, "too high", "")
    ).to.be.revertedWithCustomError(templ, "InvalidPercentage");

    await expect(
      templ.connect(member1).createProposalAddCouncilMember(ethers.ZeroAddress, WEEK, "zero", "")
    ).to.be.revertedWithCustomError(templ, "InvalidRecipient");
    await expect(
      templ.connect(member1).createProposalAddCouncilMember(outsider.address, WEEK, "not member", "")
    ).to.be.revertedWithCustomError(templ, "NotMember");

    await expect(
      templ.connect(priest).createProposalRemoveCouncilMember(member1.address, WEEK, "not council", "")
    ).to.be.revertedWithCustomError(templ, "CouncilMemberMissing");
  });
});
