const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, purchaseAccess } = require("./utils/mintAndPurchase");
const {
  encodeWithdrawTreasuryDAO,
  encodeWithdrawAllTreasuryDAO,
} = require("./utils/callDataBuilders");

describe("Treasury withdrawals for arbitrary assets", function () {
  let templ;
  let token;
  let otherToken;
  let accounts;
  let owner, member1, member2;
  const ENTRY_FEE = ethers.parseUnits("100", 18);
  const DONATED_AMOUNT = ethers.parseUnits("50", 18);

  beforeEach(async function () {
    ({ templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE }));
    [owner, , member1, member2] = accounts;

    await mintToUsers(token, [member1, member2], ENTRY_FEE * 10n);
    await purchaseAccess(templ, token, [member1, member2]);

    const OtherToken = await ethers.getContractFactory("TestToken");
    otherToken = await OtherToken.deploy("Other", "OTH", 18);
    // Donate ERC20 and ETH by transferring directly to the contract
    await otherToken.mint(owner.address, DONATED_AMOUNT);
    await otherToken.transfer(await templ.getAddress(), DONATED_AMOUNT);
    await owner.sendTransaction({ to: await templ.getAddress(), value: DONATED_AMOUNT });
  });

  it("should withdraw donated ERC20 tokens", async function () {
    await templ
      .connect(member1)
      .createProposalWithdrawTreasury(
        "Withdraw ERC20",
        "test",
        otherToken.target,
        member1.address,
        DONATED_AMOUNT,
        "withdraw donated ERC20",
        7 * 24 * 60 * 60
      );

    await templ.connect(member1).vote(0, true);
    await templ.connect(member2).vote(0, true);

    await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine");

    const before = await otherToken.balanceOf(member1.address);
    await templ.executeProposal(0);
    expect(await otherToken.balanceOf(member1.address)).to.equal(before + DONATED_AMOUNT);
  });

  it("should withdraw donated ETH", async function () {
    await templ
      .connect(member1)
      .createProposalWithdrawTreasury(
        "Withdraw ETH",
        "test",
        ethers.ZeroAddress,
        member2.address,
        DONATED_AMOUNT,
        "withdraw donated ETH",
        7 * 24 * 60 * 60
      );

    await templ.connect(member1).vote(0, true);
    await templ.connect(member2).vote(0, true);

    await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine");

    const before = await ethers.provider.getBalance(member2.address);
    await templ.executeProposal(0);
    const after = await ethers.provider.getBalance(member2.address);
    expect(after - before).to.equal(DONATED_AMOUNT);
  });

  it("should withdraw all donated ETH", async function () {
    await templ
      .connect(member1)
      .createProposalWithdrawAllTreasury(
        "Withdraw All ETH",
        "test",
        ethers.ZeroAddress,
        member1.address,
        "withdraw all donated ETH",
        7 * 24 * 60 * 60
      );

    await templ.connect(member1).vote(0, true);
    await templ.connect(member2).vote(0, true);

    await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine");

    const before = await ethers.provider.getBalance(member1.address);
    await templ.executeProposal(0);
    const after = await ethers.provider.getBalance(member1.address);
    expect(after - before).to.equal(DONATED_AMOUNT);
    expect(await ethers.provider.getBalance(await templ.getAddress())).to.equal(0);
  });

  it("should withdraw all donated ERC20 tokens", async function () {
    await templ
      .connect(member1)
      .createProposalWithdrawAllTreasury(
        "Withdraw All ERC20",
        "test",
        otherToken.target,
        member2.address,
        "withdraw all donated ERC20",
        7 * 24 * 60 * 60
      );

    await templ.connect(member1).vote(0, true);
    await templ.connect(member2).vote(0, true);

    await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine");

    const before = await otherToken.balanceOf(member2.address);
    await templ.executeProposal(0);
    expect(await otherToken.balanceOf(member2.address)).to.equal(
      before + DONATED_AMOUNT
    );
    expect(await otherToken.balanceOf(await templ.getAddress())).to.equal(0);
  });

  it("should withdraw donated accessToken beyond tracked treasuryBalance while preserving member pool", async function () {
    // At this point, two members have purchased access. The contract holds:
    // - accessToken balance = 60% * 2 = 120 (30% pool x2 + 30% treasury x2)
    // - memberPoolBalance = 30% * 2 = 60
    // - treasuryBalance (tracked) = 30% * 2 = 60

    const templAddress = await templ.getAddress();
    const thirtyPercent = (ENTRY_FEE * 30n) / 100n;

    // Donate extra accessToken directly to the contract to simulate treasury donations
    const donation = thirtyPercent * 5n / 3n; // 50 tokens if ENTRY_FEE=100
    await token.mint(owner.address, donation);
    await token.transfer(templAddress, donation);

    const poolBefore = await templ.memberPoolBalance();
    const trackedTreasuryBefore = await templ.treasuryBalance();

    // Available = current balance - pool
    const currentBal = await token.balanceOf(templAddress);
    const available = currentBal - poolBefore; // includes donations
    // Sanity: available > trackedTreasuryBefore
    expect(available).to.be.gt(trackedTreasuryBefore);

    // Withdraw an amount larger than tracked treasury but <= available
    const withdrawAmount = trackedTreasuryBefore + (donation / 2n);

    await templ
      .connect(member1)
      .createProposalWithdrawTreasury(
        "Withdraw donated accessToken",
        "test",
        token.target,
        member1.address,
        withdrawAmount,
        "use donations",
        7 * 24 * 60 * 60
      );

    await templ.connect(member1).vote(0, true);
    await templ.connect(member2).vote(0, true);
    await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine");

    const beforeRecipient = await token.balanceOf(member1.address);
    await templ.executeProposal(0);
    const afterRecipient = await token.balanceOf(member1.address);

    expect(afterRecipient - beforeRecipient).to.equal(withdrawAmount);

    // Tracked treasuryBalance only reduced by portion covered by fees
    const trackedTreasuryAfter = await templ.treasuryBalance();
    expect(trackedTreasuryAfter).to.equal(0n);

    // Member pool remains intact
    expect(await templ.memberPoolBalance()).to.equal(poolBefore);

    // UI-facing treasury reflects remaining available (donation leftover)
    const info = await templ.getTreasuryInfo();
    const currentAfter = await token.balanceOf(templAddress);
    const expectedAvailable = currentAfter - poolBefore;
    expect(info.treasury).to.equal(expectedAvailable);
  });

  it("should withdrawAll accessToken including donations while preserving member pool", async function () {
    const templAddress = await templ.getAddress();

    // Donate accessToken
    const donate = (ENTRY_FEE * 25n) / 100n; // 25 tokens
    await token.mint(owner.address, donate);
    await token.transfer(templAddress, donate);

    const poolBefore = await templ.memberPoolBalance();

    // Create withdrawAll for accessToken
    await templ
      .connect(member1)
      .createProposalWithdrawAllTreasury(
        "Drain available accessToken",
        "includes donations",
        token.target,
        member2.address,
        "all accessToken available",
        7 * 24 * 60 * 60
      );

    await templ.connect(member1).vote(0, true);
    await templ.connect(member2).vote(0, true);
    await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine");

    const currBefore = await token.balanceOf(templAddress);
    const availableBefore = currBefore - poolBefore;
    const recipientBefore = await token.balanceOf(member2.address);

    await templ.executeProposal(0);

    // Member 2 receives all available (fees + donations), pool stays intact
    const recipientAfter = await token.balanceOf(member2.address);
    expect(recipientAfter - recipientBefore).to.equal(availableBefore);
    const currAfter = await token.balanceOf(templAddress);
    expect(currAfter).to.equal(poolBefore);

    // UI-facing treasury now zero
    const infoAfter = await templ.getTreasuryInfo();
    expect(infoAfter.treasury).to.equal(0n);
  });
});
