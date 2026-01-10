const { expect } = require("chai");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, joinMembers } = require("./utils/mintAndPurchase");

describe("Disband Treasury", function () {
  const ENTRY_FEE = ethers.parseUnits("100", 18);
  const TOKEN_SUPPLY = ethers.parseUnits("10000", 18);
  const VOTING_PERIOD = 7 * 24 * 60 * 60;
  const DISBAND_META = ["Disband treasury", "Move treasury into member pool"];

  let templ;
  let token;
  let accounts;
  let owner;
  let priest;
  let m1, m2, m3;

  beforeEach(async function () {
    ({ templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE }));
    [owner, priest, m1, m2, m3] = accounts;
    await mintToUsers(token, [m1, m2, m3], TOKEN_SUPPLY);
    await joinMembers(templ, token, [m1, m2, m3]);
  });

  async function advanceTimeBeyondVoting() {
    await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine");
  }

  it("allocates treasury equally to all members and empties treasury", async function () {
    const accessToken = await templ.accessToken();
    const memberCount = await templ.getMemberCount();
    const tBefore = await templ.treasuryBalance();
    expect(tBefore).to.be.gt(0n);

    const before1 = await templ.getClaimableMemberRewards(m1.address);
    const before2 = await templ.getClaimableMemberRewards(m2.address);
    const before3 = await templ.getClaimableMemberRewards(m3.address);

    await templ
      .connect(m1)
      .createProposalDisbandTreasury(accessToken, VOTING_PERIOD, ...DISBAND_META);
    await templ.connect(m1).vote(0, true);
    await templ.connect(m2).vote(0, true);

    await advanceTimeBeyondVoting();
    await templ.executeProposal(0);

    // Treasury moved to pool
    expect(await templ.treasuryBalance()).to.equal(0n);
    const perMember = tBefore / memberCount;

    const after1 = await templ.getClaimableMemberRewards(m1.address);
    const after2 = await templ.getClaimableMemberRewards(m2.address);
    const after3 = await templ.getClaimableMemberRewards(m3.address);

    expect(after1 - before1).to.equal(perMember);
    expect(after2 - before2).to.equal(perMember);
    expect(after3 - before3).to.equal(perMember);

    // members can claim without reverts
    await templ.connect(m1).claimMemberRewards();
    await templ.connect(m2).claimMemberRewards();
    await templ.connect(m3).claimMemberRewards();
  });

  it("executes disband proposals through governance", async function () {
    const accessToken = await templ.accessToken();
    await templ
      .connect(m1)
      .createProposalDisbandTreasury(accessToken, VOTING_PERIOD, ...DISBAND_META);
    await templ.connect(m2).vote(0, true);
    await templ.connect(m3).vote(0, true);

    await advanceTimeBeyondVoting();
    await expect(templ.executeProposal(0))
      .to.emit(templ, "TreasuryDisbanded")
      .withArgs(0, accessToken, anyValue, anyValue, anyValue);
  });

  it("reverts when called directly (NotDAO)", async function () {
    await expect(
      templ.connect(m1).disbandTreasuryDAO(token.target)
    ).to.be.revertedWithCustomError(templ, "NotDAO");
  });

  it("records whichever token the proposal specifies", async function () {
    const accessToken = await templ.accessToken();
    await templ
      .connect(m1)
      .createProposalDisbandTreasury(accessToken, VOTING_PERIOD, ...DISBAND_META);
    let proposal = await templ.proposals(0);
    expect(proposal.token).to.equal(accessToken);

    const OtherToken = await ethers.getContractFactory("TestToken");
    const otherToken = await OtherToken.deploy("Other", "OTH", 18);
    await otherToken.mint(owner.address, ENTRY_FEE);
    await otherToken.transfer(await templ.getAddress(), ENTRY_FEE);

    await templ
      .connect(m2)
      .createProposalDisbandTreasury(otherToken.target, VOTING_PERIOD, ...DISBAND_META);
    proposal = await templ.proposals(1);
    expect(proposal.token).to.equal(otherToken.target);
  });

  it("allows priest quorum-exempt disband after voting window", async function () {
    const accessToken = await templ.accessToken();
    await templ.connect(priest).createProposalDisbandTreasury(accessToken, VOTING_PERIOD, ...DISBAND_META);
    const proposal = await templ.proposals(0);
    expect(proposal.quorumExempt).to.equal(true);

    await ethers.provider.send("evm_increaseTime", [VOTING_PERIOD + 1]);
    await ethers.provider.send("evm_mine", []);

    await templ.connect(priest).executeProposal(0);

    expect((await templ.proposals(0)).executed).to.equal(true);
    expect(await templ.treasuryBalance()).to.equal(0n);
  });

  it("allows joins while a priest disband proposal is pending", async function () {
    const joiner = accounts[5];
    const accessToken = await templ.accessToken();

    await mintToUsers(token, [joiner], ENTRY_FEE);

    await templ.connect(priest).createProposalDisbandTreasury(accessToken, VOTING_PERIOD, ...DISBAND_META);

    await token.connect(joiner).approve(await templ.getAddress(), ENTRY_FEE);
    await templ.connect(joiner).join();
    expect(await templ.isMember(joiner.address)).to.equal(true);
  });

  it("allows joins while a member disband proposal is pending, even after quorum", async function () {
    const lateJoiner = accounts[6];
    const accessToken = await templ.accessToken();

    await mintToUsers(token, [lateJoiner], ENTRY_FEE);

    await templ
      .connect(m1)
      .createProposalDisbandTreasury(accessToken, VOTING_PERIOD, ...DISBAND_META);
    await templ.connect(m2).vote(0, true);

    await token.connect(lateJoiner).approve(await templ.getAddress(), ENTRY_FEE);
    await templ.connect(lateJoiner).join();
    expect(await templ.isMember(lateJoiner.address)).to.equal(true);
  });

  it("reverts when treasury is empty", async function () {
    const accessToken = await templ.accessToken();

    await templ
      .connect(m1)
      .createProposalDisbandTreasury(accessToken, VOTING_PERIOD, ...DISBAND_META);
    await templ.connect(m1).vote(0, true);
    await templ.connect(m2).vote(0, true);
    await advanceTimeBeyondVoting();
    await templ.executeProposal(0);

    await templ
      .connect(m1)
      .createProposalDisbandTreasury(accessToken, VOTING_PERIOD, ...DISBAND_META);
    await templ.connect(m1).vote(1, true);
    await templ.connect(m2).vote(1, true);
    await advanceTimeBeyondVoting();
    await expect(templ.executeProposal(1))
      .to.be.revertedWithCustomError(templ, "NoTreasuryFunds");
  });

  it("allows joins after a disband proposal execution fails", async function () {
    const accessToken = await templ.accessToken();
    const extraMember = accounts[5];
    const lateJoiner = accounts[6];

    await mintToUsers(token, [extraMember, lateJoiner], TOKEN_SUPPLY);
    await token.connect(extraMember).approve(await templ.getAddress(), ENTRY_FEE);
    await templ.connect(extraMember).join();

    await templ
      .connect(m1)
      .createProposalDisbandTreasury(accessToken, VOTING_PERIOD, ...DISBAND_META);
    await templ.connect(m1).vote(0, true);
    await templ.connect(m2).vote(0, true);
    await advanceTimeBeyondVoting();
    await templ.executeProposal(0);

    await templ
      .connect(m1)
      .createProposalDisbandTreasury(accessToken, VOTING_PERIOD, ...DISBAND_META);
    await templ.connect(m1).vote(1, true);
    await templ.connect(m2).vote(1, true);

    await advanceTimeBeyondVoting();
    await expect(templ.executeProposal(1))
      .to.be.revertedWithCustomError(templ, "NoTreasuryFunds");

    await token.connect(lateJoiner).approve(await templ.getAddress(), ENTRY_FEE);
    await templ.connect(lateJoiner).join();
    expect(await templ.isMember(lateJoiner.address)).to.equal(true);
  });

  it("allows joins after executing a disband proposal", async function () {
    const accessToken = await templ.accessToken();
    const extraMember = accounts[5];
    const lateJoiner = accounts[6];

    await mintToUsers(token, [extraMember, lateJoiner], TOKEN_SUPPLY);

    await token.connect(extraMember).approve(await templ.getAddress(), ENTRY_FEE);
    await templ.connect(extraMember).join();

    await templ
      .connect(m1)
      .createProposalDisbandTreasury(accessToken, VOTING_PERIOD, ...DISBAND_META);
    await templ.connect(m2).vote(0, true);

    await advanceTimeBeyondVoting();
    await templ.executeProposal(0);

    await token.connect(lateJoiner).approve(await templ.getAddress(), ENTRY_FEE);
    await templ.connect(lateJoiner).join();
    expect(await templ.isMember(lateJoiner.address)).to.equal(true);
  });

  it("allows joins after a disband proposal fails", async function () {
    const accessToken = await templ.accessToken();
    const extraMember = accounts[5];
    const lateJoiner = accounts[6];

    await mintToUsers(token, [extraMember, lateJoiner], TOKEN_SUPPLY);

    await token.connect(extraMember).approve(await templ.getAddress(), ENTRY_FEE);
    await templ.connect(extraMember).join();

    await templ
      .connect(m1)
      .createProposalDisbandTreasury(accessToken, VOTING_PERIOD, ...DISBAND_META);
    await templ.connect(m2).vote(0, true);

    await templ.connect(m3).vote(0, false);
    await templ.connect(extraMember).vote(0, false);
    await templ.connect(priest).vote(0, false);

    await advanceTimeBeyondVoting();
    await expect(templ.executeProposal(0))
      .to.be.revertedWithCustomError(templ, "ProposalNotPassed");

    await token.connect(lateJoiner).approve(await templ.getAddress(), ENTRY_FEE);
    await templ.connect(lateJoiner).join();
    expect(await templ.isMember(lateJoiner.address)).to.equal(true);
  });

});
