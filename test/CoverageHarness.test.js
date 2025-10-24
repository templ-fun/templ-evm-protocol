const { expect } = require("chai");
const { ethers } = require("hardhat");
const { mintToUsers, joinMembers } = require("./utils/mintAndPurchase");
const { deployTemplModules } = require("./utils/modules");
const { attachTemplInterface } = require("./utils/templ");

describe("TemplHarness coverage helpers", function () {
  let harness;
  let token;
  let priest;
  let protocol;

  let modules;

  beforeEach(async function () {
    const signers = await ethers.getSigners();
    [, priest, protocol] = signers;
    const Token = await ethers.getContractFactory("TestToken");
    token = await Token.deploy("Test Token", "TEST", 18);
    modules = await deployTemplModules();
    const Harness = await ethers.getContractFactory("TemplHarness");
    harness = await Harness.deploy(
      priest.address,
      protocol.address,
      token.target,
      1_000_000n,
      3000,
      3000,
      3000,
      1000,
      3300,
      7 * 24 * 60 * 60,
      ethers.ZeroAddress,
      false,
      0,
      "Harness",
      "Coverage harness",
      "https://templ.fun/harness.png",
      0,
      0,
      modules.membershipModule,
      modules.treasuryModule,
      modules.governanceModule
    );
    await harness.waitForDeployment();
    harness = await attachTemplInterface(harness);
  });

  it("reverts when deploying with a zero entry fee", async function () {
    const Harness = await ethers.getContractFactory("TemplHarness");
    await expect(
      Harness.deploy(
        priest.address,
        protocol.address,
        token.target,
        0,
        3000,
        3000,
        3000,
        1000,
        3300,
        7 * 24 * 60 * 60,
        ethers.ZeroAddress,
        false,
        0,
        "Harness",
        "Coverage harness",
        "https://templ.fun/harness.png",
        0,
        0,
        modules.membershipModule,
        modules.treasuryModule,
        modules.governanceModule
      )
    ).to.be.revertedWithCustomError(Harness, "AmountZero");
  });

  it("initializes the max member cap when supplied", async function () {
    const Harness = await ethers.getContractFactory("TemplHarness");
    let capped = await Harness.deploy(
      priest.address,
      protocol.address,
      token.target,
      1_000_000n,
      3000,
      3000,
      3000,
      1000,
      3300,
      7 * 24 * 60 * 60,
      ethers.ZeroAddress,
      false,
      7,
      "Harness",
      "Coverage harness",
      "https://templ.fun/harness.png",
      0,
      0,
      modules.membershipModule,
      modules.treasuryModule,
      modules.governanceModule
    );
    await capped.waitForDeployment();
    capped = await attachTemplInterface(capped);
    expect(await capped.maxMembers()).to.equal(7n);
  });

  it("returns false when snapshot sequence is zero", async function () {
    const voter = priest.address;
    await harness.harnessSetMember(voter, 5, 1_000, true, 3);
    expect(await harness.harnessJoinedAfterSnapshot(voter, 0)).to.equal(false);
  });

  it("returns false when member joined at snapshot sequence", async function () {
    const voter = priest.address;
    await harness.harnessSetMember(voter, 10, 2_000, true, 7);
    expect(await harness.harnessJoinedAfterSnapshot(voter, 7)).to.equal(false);
  });

  it("detects joins when the sequence increases after the snapshot", async function () {
    const voter = priest.address;
    await harness.harnessSetMember(voter, 15, 5_000, true, 8);
    expect(await harness.harnessJoinedAfterSnapshot(voter, 7)).to.equal(true);
  });

  it("returns cumulative rewards baseline when no checkpoints exist", async function () {
    const member = priest.address;
    await harness.harnessSetMember(member, 1, 100, true, 1);
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
    await harness.harnessSetMember(member, 50, 4_000, true, 5);
    const tokenKey = ethers.Wallet.createRandom().address;
    await harness.harnessResetExternalRewards(tokenKey, 0);
    await harness.harnessPushCheckpoint(tokenKey, 50, 5_000, 10);
    expect(await harness.harnessExternalBaseline(tokenKey, member)).to.equal(0);
  });

  it("handles checkpoint timestamps at or before member join time", async function () {
    const member = priest.address;
    await harness.harnessSetMember(member, 50, 6_000, true, 5);
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

  it("rolls external remainders forward at disband time", async function () {
    const signers = await ethers.getSigners();
    const [,, , memberA, memberB] = signers;
    const entryFee = await harness.entryFee();
    await mintToUsers(token, [memberA, memberB], entryFee);
    await joinMembers(harness, token, [memberA, memberB], entryFee);

    const RewardToken = await ethers.getContractFactory("contracts/mocks/TestToken.sol:TestToken");
    const reward = await RewardToken.deploy("Reward", "RWD", 18);
    await reward.waitForDeployment();

    const rewardAddr = reward.target;
    await harness.harnessSeedExternalRemainder(rewardAddr, 10, 5);
    await reward.mint(await harness.getAddress(), 2n);
    await harness.harnessDisbandTreasury(rewardAddr);

    const [, cumulative, remainder] = await harness.getExternalRewardState(rewardAddr);
    // Members: priest + memberA + memberB = 3. (10 + 2) / 3 = 4 per member, 0 remainder
    expect(cumulative).to.equal(9); // was 5, plus 4 per-member added
    expect(remainder).to.equal(0n);
  });

  it("ignores inactive ids when removing proposals for coverage", async function () {
    await expect(harness.harnessRemoveActiveProposal(999)).to.not.be.reverted;
  });

  // Disbanding with no members is covered elsewhere (reverts NoMembers)

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
    await harness.harnessSetMember(priest.address, 0, 0, false, 0);
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
