const { expect } = require("chai");
const { ethers } = require("hardhat");
const { mintToUsers, joinMembers } = require("./utils/mintAndPurchase");

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

    await harness.harnessForceFeeCurve(0, 0, ethers.parseUnits("1", 18));
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
    await joinMembers(harness, token, [memberA, memberB], entryFee);

    const tokenKey = ethers.Wallet.createRandom().address;
    await harness.harnessSeedExternalRemainder(tokenKey, 10, 5);

    await harness.harnessFlushExternalRemainders();

    const [, cumulative, remainder] = await harness.getExternalRewardState(tokenKey);
    expect(cumulative).to.equal(8);
    expect(remainder).to.equal(1);

    const latest = await harness.harnessGetLatestCheckpoint(tokenKey);
    expect(latest[2]).to.equal(8);

    await joinMembers(harness, token, [memberC], entryFee);
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

  it("returns zero total joins when the membership counter resets", async function () {
    await harness.harnessClearMembers();
    expect(await harness.totalJoins()).to.equal(0n);
  });

  it("does not duplicate tokens when seeding remainders repeatedly", async function () {
    const tokenKey = ethers.Wallet.createRandom().address;
    await harness.harnessSeedExternalRemainder(tokenKey, 3, 1);
    await harness.harnessSeedExternalRemainder(tokenKey, 7, 2);
    const tokens = await harness.getExternalRewardTokens();
    const occurrences = tokens.filter((addr) => addr === tokenKey);
    expect(occurrences.length).to.equal(1);
  });

  it("permits new joins when the member list is empty", async function () {
    const [, priest, , member] = await ethers.getSigners();
    const entryFee = await harness.entryFee();
    await harness.harnessClearMembers();
    await harness.harnessSetMember(priest.address, 0, 0, false);
    await mintToUsers(token, [member], entryFee);
    await joinMembers(harness, token, [member], entryFee);
    expect(await harness.isMember(member.address)).to.equal(true);
  });

  it("caps external reward token registration", async function () {
    const limit = 256;
    for (let i = 0; i < limit; i++) {
      const tokenKey = ethers.Wallet.createRandom().address;
      await harness.harnessRegisterExternalToken(tokenKey);
    }
    const overflowToken = ethers.Wallet.createRandom().address;
    await expect(harness.harnessRegisterExternalToken(overflowToken))
      .to.be.revertedWithCustomError(harness, "ExternalRewardLimitReached");
  });

  it("ignores cleanup requests for unknown external reward tokens", async function () {
    const unknown = ethers.Wallet.createRandom().address;
    await expect(harness.harnessRemoveExternalToken(unknown)).to.not.be.reverted;
  });

  it("removes active proposals via the swap path", async function () {
    const [, memberA, memberB] = await ethers.getSigners();
    const entryFee = await harness.entryFee();
    await mintToUsers(token, [memberA, memberB], entryFee);
    await joinMembers(harness, token, [memberA, memberB], entryFee);

    await harness
      .connect(memberA)
      .createProposalSetJoinPaused(false, 7 * 24 * 60 * 60, "Swap-1", "First proposal");
    await harness
      .connect(memberB)
      .createProposalSetJoinPaused(false, 7 * 24 * 60 * 60, "Swap-2", "Second proposal");

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
