const { expect } = require("chai");
const { ethers } = require("hardhat");

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
      ethers.ZeroAddress
    );
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
});
