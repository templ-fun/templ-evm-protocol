const { expect } = require("chai");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, joinMembers } = require("./utils/mintAndPurchase");

describe("Disband Treasury", function () {
  const ENTRY_FEE = ethers.parseUnits("100", 18);
  const TOKEN_SUPPLY = ethers.parseUnits("10000", 18);
  const VOTING_PERIOD = 7 * 24 * 60 * 60;

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
      .createProposalDisbandTreasury(accessToken, VOTING_PERIOD);
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
      .createProposalDisbandTreasury(accessToken, VOTING_PERIOD);
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
      .createProposalDisbandTreasury(accessToken, VOTING_PERIOD);
    let proposal = await templ.proposals(0);
    expect(proposal.token).to.equal(accessToken);

    const OtherToken = await ethers.getContractFactory("TestToken");
    const otherToken = await OtherToken.deploy("Other", "OTH", 18);
    await otherToken.mint(owner.address, ENTRY_FEE);
    await otherToken.transfer(await templ.getAddress(), ENTRY_FEE);

    await templ
      .connect(m2)
      .createProposalDisbandTreasury(otherToken.target, VOTING_PERIOD);
    proposal = await templ.proposals(1);
    expect(proposal.token).to.equal(otherToken.target);
  });

  it("allows priest quorum-exempt disband after voting window", async function () {
    const accessToken = await templ.accessToken();
    await templ.connect(priest).createProposalDisbandTreasury(accessToken, VOTING_PERIOD);
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

    await templ.connect(priest).createProposalDisbandTreasury(accessToken, VOTING_PERIOD);

    await token.connect(joiner).approve(await templ.getAddress(), ENTRY_FEE);
    await expect(templ.connect(joiner).join()).to.not.be.reverted;
    expect(await templ.isMember(joiner.address)).to.equal(true);
  });

  it("allows joins while a member disband proposal is pending, even after quorum", async function () {
    const lateJoiner = accounts[6];
    const accessToken = await templ.accessToken();

    await mintToUsers(token, [lateJoiner], ENTRY_FEE);

    await templ
      .connect(m1)
      .createProposalDisbandTreasury(accessToken, VOTING_PERIOD);
    await templ.connect(m2).vote(0, true);

    await token.connect(lateJoiner).approve(await templ.getAddress(), ENTRY_FEE);
    await expect(templ.connect(lateJoiner).join()).to.not.be.reverted;
    expect(await templ.isMember(lateJoiner.address)).to.equal(true);
  });

  it("reverts when treasury is empty", async function () {
    const accessToken = await templ.accessToken();

    await templ
      .connect(m1)
      .createProposalDisbandTreasury(accessToken, VOTING_PERIOD);
    await templ.connect(m1).vote(0, true);
    await templ.connect(m2).vote(0, true);
    await advanceTimeBeyondVoting();
    await templ.executeProposal(0);

    await templ
      .connect(m1)
      .createProposalDisbandTreasury(accessToken, VOTING_PERIOD);
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
      .createProposalDisbandTreasury(accessToken, VOTING_PERIOD);
    await templ.connect(m1).vote(0, true);
    await templ.connect(m2).vote(0, true);
    await advanceTimeBeyondVoting();
    await templ.executeProposal(0);

    await templ
      .connect(m1)
      .createProposalDisbandTreasury(accessToken, VOTING_PERIOD);
    await templ.connect(m1).vote(1, true);
    await templ.connect(m2).vote(1, true);

    await advanceTimeBeyondVoting();
    await expect(templ.executeProposal(1))
      .to.be.revertedWithCustomError(templ, "NoTreasuryFunds");

    await token.connect(lateJoiner).approve(await templ.getAddress(), ENTRY_FEE);
    await expect(templ.connect(lateJoiner).join()).to.not.be.reverted;
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
      .createProposalDisbandTreasury(accessToken, VOTING_PERIOD);
    await templ.connect(m2).vote(0, true);

    await advanceTimeBeyondVoting();
    await templ.executeProposal(0);

    await token.connect(lateJoiner).approve(await templ.getAddress(), ENTRY_FEE);
    await expect(templ.connect(lateJoiner).join()).to.not.be.reverted;
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
      .createProposalDisbandTreasury(accessToken, VOTING_PERIOD);
    await templ.connect(m2).vote(0, true);

    await templ.connect(m3).vote(0, false);
    await templ.connect(extraMember).vote(0, false);

    await advanceTimeBeyondVoting();
    await expect(templ.executeProposal(0))
      .to.be.revertedWithCustomError(templ, "ProposalNotPassed");

    await token.connect(lateJoiner).approve(await templ.getAddress(), ENTRY_FEE);
    await expect(templ.connect(lateJoiner).join()).to.not.be.reverted;
    expect(await templ.isMember(lateJoiner.address)).to.equal(true);
  });

  it("cleans up empty external reward tokens to free registry slots", async function () {
    const TokenFactory = await ethers.getContractFactory("TestToken");
    const lootToken = await TokenFactory.deploy("Loot", "LOOT", 18);
    const goldToken = await TokenFactory.deploy("Gold", "GLD", 18);
    const lootDonation = ethers.parseUnits("8", 18);
    const goldDonation = ethers.parseUnits("5", 18);

    // Register loot token and empty it out entirely
    await lootToken.mint(owner.address, lootDonation);
    await lootToken.transfer(await templ.getAddress(), lootDonation);

    await templ
      .connect(m1)
      .createProposalDisbandTreasury(lootToken.target, VOTING_PERIOD);
    await templ.connect(m2).vote(0, true);
    await templ.connect(m3).vote(0, true);
    await advanceTimeBeyondVoting();
    await templ.executeProposal(0);

    await templ.connect(m1).claimExternalReward(lootToken.target);
    await templ.connect(m2).claimExternalReward(lootToken.target);
    await templ.connect(m3).claimExternalReward(lootToken.target);
    await templ.connect(priest).claimExternalReward(lootToken.target);

    const lootState = await templ.getExternalRewardState(lootToken.target);
    expect(lootState.poolBalance).to.equal(0n);
    expect(lootState.remainder).to.equal(0n);

    // Register a second token so the cleanup path swaps array entries
    await goldToken.mint(owner.address, goldDonation);
    await goldToken.transfer(await templ.getAddress(), goldDonation);

    await templ
      .connect(m1)
      .createProposalDisbandTreasury(goldToken.target, VOTING_PERIOD);
    await templ.connect(m2).vote(1, true);
    await templ.connect(m3).vote(1, true);
    await advanceTimeBeyondVoting();
    await templ.executeProposal(1);

    const tokensBeforeCleanup = await templ.getExternalRewardTokens();
    expect(tokensBeforeCleanup).to.include.members([lootToken.target, goldToken.target]);

    // Propose and execute DAO cleanup for the settled loot token
    await templ
      .connect(m1)
      .createProposalCleanupExternalRewardToken(lootToken.target, VOTING_PERIOD, "Cleanup loot", "Free slot");
    const lootCleanupId = (await templ.proposalCount()) - 1n;
    await templ.connect(m2).vote(Number(lootCleanupId), true);
    await advanceTimeBeyondVoting();
    await templ.executeProposal(Number(lootCleanupId));

    const tokensAfterFirstCleanup = await templ.getExternalRewardTokens();
    expect(tokensAfterFirstCleanup).to.deep.equal([goldToken.target]);

    await templ.connect(m1).claimExternalReward(goldToken.target);
    await templ.connect(m2).claimExternalReward(goldToken.target);
    await templ.connect(m3).claimExternalReward(goldToken.target);
    await templ.connect(priest).claimExternalReward(goldToken.target);

    const goldState = await templ.getExternalRewardState(goldToken.target);
    expect(goldState.poolBalance).to.equal(0n);
    expect(goldState.remainder).to.equal(0n);

    // Propose and execute DAO cleanup for the settled gold token
    await templ
      .connect(m1)
      .createProposalCleanupExternalRewardToken(goldToken.target, VOTING_PERIOD, "Cleanup gold", "Free slot");
    const goldCleanupId = (await templ.proposalCount()) - 1n;
    await templ.connect(m2).vote(Number(goldCleanupId), true);
    await advanceTimeBeyondVoting();
    await templ.executeProposal(Number(goldCleanupId));

    const tokensAfterSecondCleanup = await templ.getExternalRewardTokens();
    expect(tokensAfterSecondCleanup.length).to.equal(0);

    // Ensure the freed slots can be reused by re-registering loot and gold
    await lootToken.mint(owner.address, lootDonation);
    await lootToken.transfer(await templ.getAddress(), lootDonation);

    await templ
      .connect(m1)
      .createProposalDisbandTreasury(lootToken.target, VOTING_PERIOD);
    const lootDisbandId = (await templ.proposalCount()) - 1n;
    await templ.connect(m2).vote(Number(lootDisbandId), true);
    await templ.connect(m3).vote(Number(lootDisbandId), true);
    await advanceTimeBeyondVoting();
    await templ.executeProposal(Number(lootDisbandId));

    await goldToken.mint(owner.address, goldDonation);
    await goldToken.transfer(await templ.getAddress(), goldDonation);

    await templ
      .connect(m1)
      .createProposalDisbandTreasury(goldToken.target, VOTING_PERIOD);
    const goldDisbandId = (await templ.proposalCount()) - 1n;
    await templ.connect(m2).vote(Number(goldDisbandId), true);
    await templ.connect(m3).vote(Number(goldDisbandId), true);
    await advanceTimeBeyondVoting();
    await templ.executeProposal(Number(goldDisbandId));

    const tokensFinal = await templ.getExternalRewardTokens();
    expect(tokensFinal).to.include.members([goldToken.target, lootToken.target]);
  });

  it("reverts cleanup while external rewards remain unsettled", async function () {
    const OtherToken = await ethers.getContractFactory("TestToken");
    const otherToken = await OtherToken.deploy("Loot", "LOOT", 18);
    const donation = ethers.parseUnits("8", 18);

    await otherToken.mint(owner.address, donation);
    await otherToken.transfer(await templ.getAddress(), donation);

    await templ
      .connect(m1)
      .createProposalDisbandTreasury(otherToken.target, VOTING_PERIOD);
    await templ.connect(m2).vote(0, true);
    await templ.connect(m3).vote(0, true);
    await advanceTimeBeyondVoting();
    await templ.executeProposal(0);

    await templ
      .connect(m1)
      .createProposalCleanupExternalRewardToken(otherToken.target, VOTING_PERIOD, "Cleanup unsettled", "");
    const cleanupId = (await templ.proposalCount()) - 1n;
    await templ.connect(m2).vote(Number(cleanupId), true);
    await advanceTimeBeyondVoting();
    await expect(templ.executeProposal(Number(cleanupId)))
      .to.be.revertedWithCustomError(templ, "ExternalRewardsNotSettled");
  });

  it("rejects cleanup attempts on the access token", async function () {
    const accessToken = await templ.accessToken();
    await templ
      .connect(m1)
      .createProposalCleanupExternalRewardToken(accessToken, VOTING_PERIOD, "Cleanup access token", "");
    const badCleanupId = (await templ.proposalCount()) - 1n;
    await templ.connect(m2).vote(Number(badCleanupId), true);
    await advanceTimeBeyondVoting();
    await expect(templ.executeProposal(Number(badCleanupId))).to.be.revertedWithCustomError(
      templ,
      "InvalidCallData"
    );
  });

  it("prevents legacy claims after cleanup when external rewards are re-registered", async function () {
    const TokenFactory = await ethers.getContractFactory("TestToken");
    const lootToken = await TokenFactory.deploy("Loot", "LOOT", 18);
    const initialDonation = ethers.parseUnits("8", 18);

    await lootToken.mint(owner.address, initialDonation);
    await lootToken.transfer(await templ.getAddress(), initialDonation);

    await templ
      .connect(m1)
      .createProposalDisbandTreasury(lootToken.target, VOTING_PERIOD);
    await templ.connect(m2).vote(0, true);
    await templ.connect(m3).vote(0, true);

    await advanceTimeBeyondVoting();
    await templ.executeProposal(0);

    const existingMembers = [priest, m1, m2, m3];
    for (const member of existingMembers) {
      await templ.connect(member).claimExternalReward(lootToken.target);
    }

    const clearedState = await templ.getExternalRewardState(lootToken.target);
    expect(clearedState.poolBalance).to.equal(0n);
    expect(clearedState.remainder).to.equal(0n);

    await templ
      .connect(m1)
      .createProposalCleanupExternalRewardToken(lootToken.target, VOTING_PERIOD, "Cleanup loot", "");
    const lootCleanupId2 = (await templ.proposalCount()) - 1n;
    await templ.connect(m2).vote(Number(lootCleanupId2), true);
    await advanceTimeBeyondVoting();
    await templ.executeProposal(Number(lootCleanupId2));

    for (const member of existingMembers) {
      expect(await templ.getClaimableExternalReward(member.address, lootToken.target)).to.equal(0n);
    }

    const newcomer = accounts[6];
    await mintToUsers(token, [newcomer], TOKEN_SUPPLY);
    await token.connect(newcomer).approve(await templ.getAddress(), ENTRY_FEE);
    await templ.connect(newcomer).join();

    const secondDonation = ethers.parseUnits("10", 18);
    await lootToken.mint(owner.address, secondDonation);
    await lootToken.transfer(await templ.getAddress(), secondDonation);

    await templ
      .connect(m1)
      .createProposalDisbandTreasury(lootToken.target, VOTING_PERIOD);
    const secondProposalId = Number((await templ.proposalCount()) - 1n);
    await templ.connect(m2).vote(secondProposalId, true);
    await templ.connect(m3).vote(secondProposalId, true);
    await templ.connect(newcomer).vote(secondProposalId, true);

    await advanceTimeBeyondVoting();
    await templ.executeProposal(secondProposalId);

    const memberCount = await templ.getMemberCount();
    const expectedShare = secondDonation / memberCount;
    const allMembers = [...existingMembers, newcomer];
    for (const member of allMembers) {
      const claimable = await templ.getClaimableExternalReward(member.address, lootToken.target);
      expect(claimable).to.equal(expectedShare);
    }

    for (const member of allMembers) {
      await templ.connect(member).claimExternalReward(lootToken.target);
    }

    const finalState = await templ.getExternalRewardState(lootToken.target);
    expect(finalState.poolBalance).to.equal(0n);
    expect(finalState.remainder).to.equal(0n);

    const tokens = await templ.getExternalRewardTokens();
    expect(tokens).to.deep.equal([lootToken.target]);
  });

  it("returns zero external rewards for non-members and unknown tokens", async function () {
    const unknownToken = accounts[6].address;

    expect(
      await templ.getClaimableExternalReward(owner.address, unknownToken)
    ).to.equal(0n);

    expect(
      await templ.getClaimableExternalReward(m1.address, unknownToken)
    ).to.equal(0n);
  });

  it("rolls remainder into the distribution when disbanding uneven amounts", async function () {
    const customEntryFee = ethers.parseUnits("110", 18);
    const { templ: unevenTempl, token: unevenToken, accounts: unevenAccounts } =
      await deployTempl({ entryFee: customEntryFee });
    const [unevenOwner, , u1, u2, u3, donor] = unevenAccounts;

    await mintToUsers(unevenToken, [u1, u2, u3, donor], TOKEN_SUPPLY);
    await joinMembers(unevenTempl, unevenToken, [u1, u2, u3], customEntryFee);

    const before1 = await unevenTempl.getClaimableMemberRewards(u1.address);
    const before2 = await unevenTempl.getClaimableMemberRewards(u2.address);
    const before3 = await unevenTempl.getClaimableMemberRewards(u3.address);

    const templAddress = await unevenTempl.getAddress();
    const poolBefore = await unevenTempl.memberPoolBalance();
    const remainderBefore = await unevenTempl.memberRewardRemainder();
    const memberCount = await unevenTempl.getMemberCount();

    await unevenToken
      .connect(donor)
      .transfer(templAddress, ethers.parseUnits("2", 18));

    const currentBalanceBefore = await unevenToken.balanceOf(templAddress);
    const amount = currentBalanceBefore - poolBefore;
    const totalRewards = amount + remainderBefore;
    const expectedIncrease = totalRewards / memberCount;
    const expectedRemainder = totalRewards % memberCount;

    await unevenTempl
      .connect(u1)
      .createProposalDisbandTreasury(unevenToken.target, VOTING_PERIOD);
    await unevenTempl.connect(u1).vote(0, true);
    await unevenTempl.connect(u2).vote(0, true);
    await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine");
    await unevenTempl.executeProposal(0);

    const after1 = await unevenTempl.getClaimableMemberRewards(u1.address);
    const after2 = await unevenTempl.getClaimableMemberRewards(u2.address);
    const after3 = await unevenTempl.getClaimableMemberRewards(u3.address);

    expect(after1 - before1).to.equal(expectedIncrease);
    expect(after2 - before2).to.equal(expectedIncrease);
    expect(after3 - before3).to.equal(expectedIncrease);

    expect(await unevenTempl.memberRewardRemainder()).to.equal(expectedRemainder);
    expect(await unevenTempl.treasuryBalance()).to.equal(0n);

    // Ensure new members start with the latest snapshot for external tokens
    await mintToUsers(unevenToken, [unevenOwner], TOKEN_SUPPLY);
    await joinMembers(unevenTempl, unevenToken, [unevenOwner], customEntryFee);
    expect(await unevenTempl.getClaimableExternalReward(unevenOwner.address, unevenToken.target)).to.equal(0n);
  });

  it("distributes donated ERC20 tokens into external claim balances", async function () {
    const OtherToken = await ethers.getContractFactory("TestToken");
    const otherToken = await OtherToken.deploy("Other", "OTH", 18);
    const donation = ethers.parseUnits("12", 18);
    await otherToken.mint(owner.address, donation);
    await otherToken.transfer(await templ.getAddress(), donation);

    await templ
      .connect(m1)
      .createProposalDisbandTreasury(otherToken.target, VOTING_PERIOD);
    await templ.connect(m1).vote(0, true);
    await templ.connect(m2).vote(0, true);
    await advanceTimeBeyondVoting();
    await templ.executeProposal(0);

    const tokens = await templ.getExternalRewardTokens();
    expect(tokens).to.include(otherToken.target);

    const claimable1 = await templ.getClaimableExternalReward(m1.address, otherToken.target);
    const claimable2 = await templ.getClaimableExternalReward(m2.address, otherToken.target);
    const claimable3 = await templ.getClaimableExternalReward(m3.address, otherToken.target);
    expect(claimable1).to.equal(claimable2);
    expect(claimable1).to.equal(claimable3);

    const before = await otherToken.balanceOf(m1.address);
    await templ.connect(m1).claimExternalReward(otherToken.target);
    const after = await otherToken.balanceOf(m1.address);
    expect(after - before).to.equal(claimable1);

    expect(await templ.getClaimableExternalReward(m1.address, otherToken.target)).to.equal(0n);
  });

  it("syncs external reward snapshots for new members", async function () {
    const OtherToken = await ethers.getContractFactory("TestToken");
    const otherToken = await OtherToken.deploy("External", "EXT", 18);
    const donation = ethers.parseUnits("9", 18);
    const newMember = accounts[5];

    await otherToken.mint(owner.address, donation);
    await otherToken.transfer(await templ.getAddress(), donation);

    await templ
      .connect(m1)
      .createProposalDisbandTreasury(otherToken.target, VOTING_PERIOD);
    await templ.connect(m1).vote(0, true);
    await templ.connect(m2).vote(0, true);
    await advanceTimeBeyondVoting();
    await templ.executeProposal(0);

    const rewardsBefore = await templ.getExternalRewardState(otherToken.target);
    expect(rewardsBefore.cumulativeRewards).to.be.gt(0n);

    await mintToUsers(token, [newMember], ENTRY_FEE * 2n);
    await joinMembers(templ, token, [newMember]);

    expect(
      await templ.getClaimableExternalReward(newMember.address, otherToken.target)
    ).to.equal(0n);
  });

  it("distributes donated ETH into external claim balances", async function () {
    const donation = ethers.parseUnits("9", 18);
    await owner.sendTransaction({ to: await templ.getAddress(), value: donation });

    await templ
      .connect(m2)
      .createProposalDisbandTreasury(ethers.ZeroAddress, VOTING_PERIOD);
    await templ.connect(m1).vote(0, true);
    await templ.connect(m2).vote(0, true);
    await advanceTimeBeyondVoting();
    await templ.executeProposal(0);

    const claimable = await templ.getClaimableExternalReward(m2.address, ethers.ZeroAddress);
    expect(claimable).to.be.gt(0n);

    const before = await ethers.provider.getBalance(m2.address);
    const tx = await templ.connect(m2).claimExternalReward(ethers.ZeroAddress);
    const receipt = await tx.wait();
    const gasUsed = receipt.gasUsed * receipt.gasPrice;
    const after = await ethers.provider.getBalance(m2.address);
    expect(after + gasUsed - before).to.equal(claimable);
  });
});
