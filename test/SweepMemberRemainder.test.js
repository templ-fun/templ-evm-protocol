const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, purchaseAccess } = require("./utils/mintAndPurchase");

describe("Sweep Member Remainder", function () {
  let templ;
  let token;
  let owner, priest, user1, user2;
  let accounts;
  const ENTRY_FEE = ethers.parseUnits("100", 18);
  const TOKEN_SUPPLY = ethers.parseUnits("10000", 18);

  beforeEach(async function () {
    ({ templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE }));
    [owner, priest, user1, user2] = accounts;

    await mintToUsers(token, [user1, user2], TOKEN_SUPPLY);

    await purchaseAccess(templ, token, [user1, user2]);
  });

  it("should sweep remaining member pool balance to recipient", async function () {
    const extraMembers = accounts.slice(4, 10);
    await mintToUsers(token, extraMembers, TOKEN_SUPPLY);
    await purchaseAccess(templ, token, extraMembers);

    const allMembers = [user1, user2, ...extraMembers];
    for (const member of allMembers.slice(0, -1)) {
      await templ.connect(member).claimMemberPool();
    }

    const remainder = await templ.memberPoolBalance();
    expect(remainder).to.be.gt(0n);

    const recipient = accounts[10];
    const before = await token.balanceOf(recipient.address);

    const callData = templ.interface.encodeFunctionData(
      "sweepMemberRewardRemainderDAO",
      [recipient.address]
    );

    await templ.connect(user1).createProposal(
      "Sweep remainder",
      "transfer leftover pool",
      callData,
      7 * 24 * 60 * 60
    );

    await templ.connect(user1).vote(0, true);
    await templ.connect(user2).vote(0, true);

    await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine");

    await templ.executeProposal(0);

    const after = await token.balanceOf(recipient.address);
    expect(after - before).to.equal(remainder);
    expect(await templ.memberPoolBalance()).to.equal(0n);
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

