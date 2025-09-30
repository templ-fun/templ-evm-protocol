const { expect } = require("chai");
const { ethers } = require("hardhat");
const { mintToUsers, purchaseAccess } = require("./utils/mintAndPurchase");

describe("TemplHarness coverage helpers", function () {
  let harness;
  let token;
  let priest;
  let protocol;

  beforeEach(async function () {
    const signers = await ethers.getSigners();
    [, priest, protocol] = signers;
    const Token = await ethers.getContractFactory("TestToken");
    token = await Token.deploy("Test Token", "TEST", 18);
    const Harness = await ethers.getContractFactory("TemplHarness");
    harness = await Harness.deploy(
      priest.address,
      protocol.address,
      token.target,
      1_000_000n,
      30,
      30,
      30,
      10,
      33,
      7 * 24 * 60 * 60,
      ethers.ZeroAddress,
      false,
      0,
      ""
    );
  });

  it("reverts when deploying with a zero entry fee", async function () {
    const Harness = await ethers.getContractFactory("TemplHarness");
    await expect(
      Harness.deploy(
        priest.address,
        protocol.address,
        token.target,
        0,
        30,
        30,
        30,
        10,
        33,
        7 * 24 * 60 * 60,
        ethers.ZeroAddress,
        false,
        0,
        ""
      )
    ).to.be.revertedWithCustomError(Harness, "AmountZero");
  });

  it("initializes the max member cap when supplied", async function () {
    const Harness = await ethers.getContractFactory("TemplHarness");
    const capped = await Harness.deploy(
      priest.address,
      protocol.address,
      token.target,
      1_000_000n,
      30,
      30,
      30,
      10,
      33,
      7 * 24 * 60 * 60,
      ethers.ZeroAddress,
      false,
      7,
      ""
    );
    expect(await capped.MAX_MEMBERS()).to.equal(7n);
  });

  it("returns false when snapshot block is zero", async function () {
    const voter = priest.address;
    await harness.harnessSetMember(voter, 5, 1_000, true);
    expect(await harness.harnessJoinedAfterSnapshot(voter, 0, 0)).to.equal(false);
  });

  it("detects joins after snapshot timestamp in same block", async function () {
    const voter = priest.address;
    await harness.harnessSetMember(voter, 10, 2_000, true);
    expect(await harness.harnessJoinedAfterSnapshot(voter, 10, 1_500)).to.equal(true);
  });

  it("detects joins when the member block exceeds the snapshot block", async function () {
    const voter = priest.address;
    await harness.harnessSetMember(voter, 15, 5_000, true);
    expect(await harness.harnessJoinedAfterSnapshot(voter, 10, 4_000)).to.equal(true);
  });

  it("returns cumulative rewards baseline when no checkpoints exist", async function () {
    const member = priest.address;
    await harness.harnessSetMember(member, 1, 100, true);
    const tokenKey = ethers.ZeroAddress;
    await harness.harnessResetExternalRewards(tokenKey, 123);
    expect(await harness.harnessExternalBaseline(tokenKey, member)).to.equal(123);
    const raw = await harness.harnessGetLatestCheckpoint(tokenKey);
    expect(raw[0]).to.equal(0);
    expect(raw[1]).to.equal(0);
    expect(raw[2]).to.equal(0);
  });

  it("handles checkpoint timestamps before member join time", async function () {
    const member = priest.address;
    await harness.harnessSetMember(member, 50, 4_000, true);
    const tokenKey = ethers.Wallet.createRandom().address;
    await harness.harnessResetExternalRewards(tokenKey, 0);
    await harness.harnessPushCheckpoint(tokenKey, 50, 5_000, 10);
    expect(await harness.harnessExternalBaseline(tokenKey, member)).to.equal(0);
  });

  it("handles checkpoint timestamps at or before member join time", async function () {
    const member = priest.address;
    await harness.harnessSetMember(member, 50, 6_000, true);
    const tokenKey = ethers.Wallet.createRandom().address;
    await harness.harnessResetExternalRewards(tokenKey, 0);
    await harness.harnessPushCheckpoint(tokenKey, 50, 5_000, 10);
    expect(await harness.harnessExternalBaseline(tokenKey, member)).to.equal(10);
  });

  it("updates checkpoint values when new data arrives in the same block", async function () {
    const tokenKey = ethers.Wallet.createRandom().address;
    await harness.harnessResetExternalRewards(tokenKey, 5);
    await harness.harnessUpdateCheckpointSameBlock(tokenKey, 42);
    const [, , cumulative] = await harness.harnessGetLatestCheckpoint(tokenKey);
    expect(cumulative).to.equal(42);
  });

  it("flushes seeded external remainders across existing members", async function () {
    const signers = await ethers.getSigners();
    const [,, , memberA, memberB, memberC] = signers;
    const entryFee = await harness.entryFee();
    await mintToUsers(token, [memberA, memberB, memberC], entryFee);
    await purchaseAccess(harness, token, [memberA, memberB], entryFee);

    const tokenKey = ethers.Wallet.createRandom().address;
    await harness.harnessSeedExternalRemainder(tokenKey, 10, 5);

    await harness.harnessFlushExternalRemainders();

    const [, cumulative, remainder] = await harness.getExternalRewardState(tokenKey);
    expect(cumulative).to.equal(8);
    expect(remainder).to.equal(1);

    const latest = await harness.harnessGetLatestCheckpoint(tokenKey);
    expect(latest[2]).to.equal(8);

    await purchaseAccess(harness, token, [memberC], entryFee);
  });

  it("ignores inactive ids when removing proposals for coverage", async function () {
    await expect(harness.harnessRemoveActiveProposal(999)).to.not.be.reverted;
  });

  it("returns early when flushing with no members", async function () {
    const tokenKey = ethers.Wallet.createRandom().address;
    await harness.harnessClearMembers();
    await harness.harnessSeedExternalRemainder(tokenKey, 5, 0);
    await harness.harnessFlushExternalRemainders();
    const [, cumulative, remainder] = await harness.getExternalRewardState(tokenKey);
    expect(cumulative).to.equal(0);
    expect(remainder).to.equal(5n);
  });

  it("returns zero total purchases when the membership counter resets", async function () {
    await harness.harnessClearMembers();
    expect(await harness.totalPurchases()).to.equal(0n);
  });

  it("does not duplicate tokens when seeding remainders repeatedly", async function () {
    const tokenKey = ethers.Wallet.createRandom().address;
    await harness.harnessSeedExternalRemainder(tokenKey, 3, 1);
    await harness.harnessSeedExternalRemainder(tokenKey, 7, 2);
    const tokens = await harness.getExternalRewardTokens();
    const occurrences = tokens.filter((addr) => addr === tokenKey);
    expect(occurrences.length).to.equal(1);
  });

  it("permits entry purchases when the member list is empty", async function () {
    const [, priest, , member] = await ethers.getSigners();
    const entryFee = await harness.entryFee();
    await harness.harnessClearMembers();
    await harness.harnessSetMember(priest.address, 0, 0, false);
    await mintToUsers(token, [member], entryFee);
    await purchaseAccess(harness, token, [member], entryFee);
    expect(await harness.hasAccess(member.address)).to.equal(true);
  });

  it("finalizes disband failure when quorum is not maintained", async function () {
    await harness.harnessFinalizeDisbandFailure(false, 0, 0, 0, true);
    expect(await harness.activeDisbandJoinLocks()).to.equal(0n);
  });

  it("keeps the disband lock when quorum remains after execution", async function () {
    await harness.harnessFinalizeDisbandFailure(true, 5, 5, 1, true);
    expect(await harness.activeDisbandJoinLocks()).to.equal(1n);
  });

  it("clears the disband lock when invoked without an active lock", async function () {
    await harness.harnessFinalizeDisbandFailure(true, 3, 3, 0, false);
    expect(await harness.activeDisbandJoinLocks()).to.equal(0n);
  });

  it("returns early when lock ids are empty despite an active count", async function () {
    await harness.harnessConfigureDisbandLocks(1, [], true);
    await harness.harnessRefreshDisbandLocks();
    expect(await harness.activeDisbandJoinLocks()).to.equal(1n);
  });

  it("invokes release when a tracked proposal already cleared its lock", async function () {
    await harness.harnessConfigureDisbandLocks(1, [0], false);
    await harness.harnessRefreshDisbandLocks();
    expect(await harness.activeDisbandJoinLocks()).to.equal(1n);
  });

  it("clears disband locks when an expired proposal remains marked", async function () {
    await harness.harnessConfigureDisbandLocks(1, [1], true);
    await harness.harnessRefreshDisbandLocks();
    expect(await harness.activeDisbandJoinLocks()).to.equal(0n);
  });

  it("swaps lock indices when releasing a non-tail entry", async function () {
    await harness.harnessConfigureDisbandLocks(2, [1, 2], true);
    await harness.harnessReleaseDisbandLock(1);
    expect(await harness.activeDisbandJoinLocks()).to.equal(1n);
  });

  it("falls back to the base refresh implementation", async function () {
    await expect(harness.harnessCallBaseRefresh()).to.not.be.reverted;
  });

  it("removes active proposals via the swap path", async function () {
    const [, memberA, memberB] = await ethers.getSigners();
    const entryFee = await harness.entryFee();
    await mintToUsers(token, [memberA, memberB], entryFee);
    await purchaseAccess(harness, token, [memberA, memberB], entryFee);

    await harness
      .connect(memberA)
      .createProposalSetPaused(false, 7 * 24 * 60 * 60, "Swap-1", "First proposal");
    await harness
      .connect(memberB)
      .createProposalSetPaused(false, 7 * 24 * 60 * 60, "Swap-2", "Second proposal");

    const before = await harness.getActiveProposals();
    expect(before.length).to.equal(2);

    await harness.harnessRemoveActiveProposal(before[0]);

    const after = await harness.getActiveProposals();
    expect(after.length).to.equal(1);
  });

  it("reverts disbanding when there are no members", async function () {
    const accessToken = await harness.accessToken();
    await harness.harnessClearMembers();
    await expect(harness.harnessDisbandTreasury(accessToken)).to.be.revertedWithCustomError(
      harness,
      "NoMembers"
    );
  });
});
