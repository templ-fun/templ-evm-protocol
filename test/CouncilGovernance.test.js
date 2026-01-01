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
  it("restricts voting to council members and supports priest bootstrap", async function () {
    const { templ, priest, member1, member2, member3 } = await setupTempl();

    await enableCouncilMode(templ, member1, [member2, member3]);
    expect(await templ.councilModeEnabled()).to.equal(true);
    expect(await templ.councilMemberCount()).to.equal(1n);

    await expect(templ.connect(priest).bootstrapCouncilMember(member1.address))
      .to.emit(templ, "CouncilMemberAdded")
      .withArgs(member1.address, priest.address);
    await expect(templ.connect(priest).bootstrapCouncilMember(member2.address))
      .to.be.revertedWithCustomError(templ, "CouncilBootstrapConsumed");

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

  it("allows governance to add and remove council members", async function () {
    const { templ, priest, member1, member2, member3 } = await setupTempl();

    await enableCouncilMode(templ, member1, [member2, member3]);
    await templ.connect(priest).bootstrapCouncilMember(member1.address);
    expect(await templ.councilMemberCount()).to.equal(2n);

    await templ.connect(member1).createProposalAddCouncilMember(member2.address, WEEK, "Add member2", "");
    let proposalId = (await templ.proposalCount()) - 1n;
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

  it("charges proposal fees for council and non-council proposers", async function () {
    const { templ, token, priest, member1, member2 } = await setupTempl({ proposalFeeBps: 1_000 });

    const templAddress = await templ.getAddress();
    await token.connect(member1).approve(templAddress, ethers.MaxUint256);
    await token.connect(member2).approve(templAddress, ethers.MaxUint256);
    await token.connect(priest).approve(templAddress, ethers.MaxUint256);

    await enableCouncilMode(templ, member1, [member2]);
    await templ.connect(priest).bootstrapCouncilMember(member1.address);

    const fee = (await templ.entryFee()) * (await templ.proposalCreationFeeBps()) / 10_000n;

    // Non-council proposer pays the fee
    const nonCouncilBalanceBefore = await token.balanceOf(member2.address);
    const treasuryBefore = await templ.treasuryBalance();
    await templ
      .connect(member2)
      .createProposalSetBurnAddress("0x00000000000000000000000000000000000000AA", WEEK, "Non-council", "");
    expect(await templ.treasuryBalance()).to.equal(treasuryBefore + fee);
    expect(nonCouncilBalanceBefore - (await token.balanceOf(member2.address))).to.equal(fee);

    // Council proposer pays the fee as well
    const councilBalanceBefore = await token.balanceOf(member1.address);
    const treasuryAfter = await templ.treasuryBalance();
    await templ
      .connect(member1)
      .createProposalSetBurnAddress("0x00000000000000000000000000000000000000BB", WEEK, "Council", "");
    expect(await templ.treasuryBalance()).to.equal(treasuryAfter + fee);
    expect(councilBalanceBefore - (await token.balanceOf(member1.address))).to.equal(fee);
  });
});
