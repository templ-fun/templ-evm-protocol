const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, purchaseAccess } = require("./utils/mintAndPurchase");
const { encodeWithdrawTreasuryDAO } = require("./utils/callDataBuilders");

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
    const callData = encodeWithdrawTreasuryDAO(
      otherToken.target,
      member1.address,
      DONATED_AMOUNT,
      "withdraw donated ERC20"
    );

    await templ
      .connect(member1)
      .createProposal("Withdraw ERC20", "test", callData, 7 * 24 * 60 * 60);

    await templ.connect(member1).vote(0, true);
    await templ.connect(member2).vote(0, true);

    await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine");

    const before = await otherToken.balanceOf(member1.address);
    await templ.executeProposal(0);
    expect(await otherToken.balanceOf(member1.address)).to.equal(before + DONATED_AMOUNT);
  });

  it("should withdraw donated ETH", async function () {
    const callData = encodeWithdrawTreasuryDAO(
      ethers.ZeroAddress,
      member2.address,
      DONATED_AMOUNT,
      "withdraw donated ETH"
    );

    await templ
      .connect(member1)
      .createProposal("Withdraw ETH", "test", callData, 7 * 24 * 60 * 60);

    await templ.connect(member1).vote(0, true);
    await templ.connect(member2).vote(0, true);

    await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine");

    const before = await ethers.provider.getBalance(member2.address);
    await templ.executeProposal(0);
    const after = await ethers.provider.getBalance(member2.address);
    expect(after - before).to.equal(DONATED_AMOUNT);
  });
});
