const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, purchaseAccess } = require("./utils/mintAndPurchase");

describe("Disband Treasury", function () {
  const ENTRY_FEE = ethers.parseUnits("100", 18);
  const TOKEN_SUPPLY = ethers.parseUnits("10000", 18);
  const VOTING_PERIOD = 7 * 24 * 60 * 60;

  let templ;
  let token;
  let accounts;
  let owner;
  let m1, m2, m3;

  beforeEach(async function () {
    ({ templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE }));
    [owner, , m1, m2, m3] = accounts;
    await mintToUsers(token, [m1, m2, m3], TOKEN_SUPPLY);
    await purchaseAccess(templ, token, [m1, m2, m3]);
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

    const before1 = await templ.getClaimablePoolAmount(m1.address);
    const before2 = await templ.getClaimablePoolAmount(m2.address);
    const before3 = await templ.getClaimablePoolAmount(m3.address);

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

    const after1 = await templ.getClaimablePoolAmount(m1.address);
    const after2 = await templ.getClaimablePoolAmount(m2.address);
    const after3 = await templ.getClaimablePoolAmount(m3.address);

    expect(after1 - before1).to.equal(perMember);
    expect(after2 - before2).to.equal(perMember);
    expect(after3 - before3).to.equal(perMember);

    // members can claim now without reverts
    await templ.connect(m1).claimMemberPool();
    await templ.connect(m2).claimMemberPool();
    await templ.connect(m3).claimMemberPool();
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
    const priest = accounts[1];
    await mintToUsers(token, [priest], TOKEN_SUPPLY);

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

  it("returns zero external rewards for non-members and unknown tokens", async function () {
    const unknownToken = accounts[6].address;

    expect(
      await templ.getClaimableExternalToken(owner.address, unknownToken)
    ).to.equal(0n);

    expect(
      await templ.getClaimableExternalToken(m1.address, unknownToken)
    ).to.equal(0n);
  });

  it("rolls remainder into the distribution when disbanding uneven amounts", async function () {
    const customEntryFee = ethers.parseUnits("110", 18);
    const { templ: unevenTempl, token: unevenToken, accounts: unevenAccounts } =
      await deployTempl({ entryFee: customEntryFee });
    const [unevenOwner, , u1, u2, u3, donor] = unevenAccounts;

    await mintToUsers(unevenToken, [u1, u2, u3, donor], TOKEN_SUPPLY);
    await purchaseAccess(unevenTempl, unevenToken, [u1, u2, u3], customEntryFee);

    const before1 = await unevenTempl.getClaimablePoolAmount(u1.address);
    const before2 = await unevenTempl.getClaimablePoolAmount(u2.address);
    const before3 = await unevenTempl.getClaimablePoolAmount(u3.address);

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

    const after1 = await unevenTempl.getClaimablePoolAmount(u1.address);
    const after2 = await unevenTempl.getClaimablePoolAmount(u2.address);
    const after3 = await unevenTempl.getClaimablePoolAmount(u3.address);

    expect(after1 - before1).to.equal(expectedIncrease);
    expect(after2 - before2).to.equal(expectedIncrease);
    expect(after3 - before3).to.equal(expectedIncrease);

    expect(await unevenTempl.memberRewardRemainder()).to.equal(expectedRemainder);
    expect(await unevenTempl.treasuryBalance()).to.equal(0n);

    // Ensure new members start with the latest snapshot for external tokens
    await mintToUsers(unevenToken, [unevenOwner], TOKEN_SUPPLY);
    await purchaseAccess(unevenTempl, unevenToken, [unevenOwner], customEntryFee);
    expect(await unevenTempl.getClaimableExternalToken(unevenOwner.address, unevenToken.target)).to.equal(0n);
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

    const claimable1 = await templ.getClaimableExternalToken(m1.address, otherToken.target);
    const claimable2 = await templ.getClaimableExternalToken(m2.address, otherToken.target);
    const claimable3 = await templ.getClaimableExternalToken(m3.address, otherToken.target);
    expect(claimable1).to.equal(claimable2);
    expect(claimable1).to.equal(claimable3);

    const before = await otherToken.balanceOf(m1.address);
    await templ.connect(m1).claimExternalToken(otherToken.target);
    const after = await otherToken.balanceOf(m1.address);
    expect(after - before).to.equal(claimable1);

    expect(await templ.getClaimableExternalToken(m1.address, otherToken.target)).to.equal(0n);
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
    await purchaseAccess(templ, token, [newMember]);

    expect(
      await templ.getClaimableExternalToken(newMember.address, otherToken.target)
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

    const claimable = await templ.getClaimableExternalToken(m2.address, ethers.ZeroAddress);
    expect(claimable).to.be.gt(0n);

    const before = await ethers.provider.getBalance(m2.address);
    const tx = await templ.connect(m2).claimExternalToken(ethers.ZeroAddress);
    const receipt = await tx.wait();
    const gasUsed = receipt.gasUsed * receipt.gasPrice;
    const after = await ethers.provider.getBalance(m2.address);
    expect(after + gasUsed - before).to.equal(claimable);
  });
});
