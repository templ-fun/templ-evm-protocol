const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Sweep Member Remainder Reverts", function () {
  let templ;
  let token;
  let owner, priest, user1, user2;
  const ENTRY_FEE = ethers.parseUnits("100", 18);
  const TOKEN_SUPPLY = ethers.parseUnits("10000", 18);

  beforeEach(async function () {
    [owner, priest, user1, user2] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("TestToken");
    token = await Token.deploy("Test Token", "TEST", 18);
    await token.waitForDeployment();

    const TEMPL = await ethers.getContractFactory("TEMPL");
    templ = await TEMPL.deploy(
      priest.address,
      priest.address,
      await token.getAddress(),
      ENTRY_FEE,
      10,
      10
    );
    await templ.waitForDeployment();

    await token.mint(user1.address, TOKEN_SUPPLY);
    await token.mint(user2.address, TOKEN_SUPPLY);

    await token.connect(user1).approve(await templ.getAddress(), ENTRY_FEE);
    await templ.connect(user1).purchaseAccess();

    await token.connect(user2).approve(await templ.getAddress(), ENTRY_FEE);
    await templ.connect(user2).purchaseAccess();
  });

  it("should revert direct call with NotDAO", async function () {
    await expect(
      templ.connect(user1).sweepMemberRewardRemainderDAO(user1.address)
    ).to.be.revertedWithCustomError(templ, "NotDAO");
  });

  it("should revert proposal execution with InvalidRecipient", async function () {
    const iface = new ethers.Interface([
      "function sweepMemberRewardRemainderDAO(address)"
    ]);
    const callData = iface.encodeFunctionData(
      "sweepMemberRewardRemainderDAO",
      [ethers.ZeroAddress]
    );

    await templ.connect(user1).createProposal(
      "Bad sweep",
      "Zero recipient",
      callData,
      7 * 24 * 60 * 60
    );

    await templ.connect(user1).vote(0, true);
    await templ.connect(user2).vote(0, true);

    await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine");

    await expect(templ.executeProposal(0)).to.be.revertedWithCustomError(
      templ,
      "InvalidRecipient"
    );
  });

  it("should revert proposal execution with AmountZero when pool is empty", async function () {
    const iface = new ethers.Interface([
      "function sweepMemberRewardRemainderDAO(address)"
    ]);
    const callData = iface.encodeFunctionData(
      "sweepMemberRewardRemainderDAO",
      [user1.address]
    );

    await templ.connect(user1).createProposal(
      "Sweep once",
      "Drain pool",
      callData,
      7 * 24 * 60 * 60
    );
    await templ.connect(user1).vote(0, true);
    await templ.connect(user2).vote(0, true);
    await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine");
    await templ.executeProposal(0);
    expect(await templ.memberPoolBalance()).to.equal(0n);

    await templ.connect(user1).createProposal(
      "Sweep again",
      "No balance",
      callData,
      7 * 24 * 60 * 60
    );
    await templ.connect(user1).vote(1, true);
    await templ.connect(user2).vote(1, true);
    await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine");

    await expect(templ.executeProposal(1)).to.be.revertedWithCustomError(
      templ,
      "AmountZero"
    );
  });
});

