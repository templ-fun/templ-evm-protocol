const { expect } = require("chai");
const { ethers } = require("hardhat");

const ENTRY_FEE = ethers.parseUnits("100", 18);

async function deployHarness(entryFee = ENTRY_FEE) {
  const accounts = await ethers.getSigners();
  const [, priest] = accounts;

  const Token = await ethers.getContractFactory("contracts/mocks/TestToken.sol:TestToken");
  const token = await Token.deploy("Test", "TEST", 18);
  await token.waitForDeployment();

  const Harness = await ethers.getContractFactory("contracts/mocks/DaoCallerHarness.sol:DaoCallerHarness");
  const templ = await Harness.deploy(priest.address, priest.address, token.target, entryFee);
  await templ.waitForDeployment();

  return { accounts, token, templ };
}

describe("WrapperCoverage (onlyDAO externals)", function () {
  it("covers withdraw wrappers via self-call", async function () {
    const { accounts, token, templ } = await deployHarness();
    const [owner, , member, recipient] = accounts;

    await token.mint(member.address, ENTRY_FEE);
    await token.connect(member).approve(templ.target, ENTRY_FEE);
    await templ.connect(member).purchaseAccess();

    const amount = (ENTRY_FEE * 30n) / 100n;
    const before = await token.balanceOf(recipient.address);
    await templ.daoWithdraw(token.target, recipient.address, amount, "payout");
    expect(await token.balanceOf(recipient.address)).to.equal(before + amount);

    const Other = await ethers.getContractFactory("contracts/mocks/TestToken.sol:TestToken");
    const other = await Other.deploy("Other", "OTH", 18);
    await other.mint(owner.address, 1000n);
    await other.transfer(templ.target, 777n);
    const before2 = await other.balanceOf(recipient.address);
    await templ.daoWithdraw(other.target, recipient.address, 777n, "drain");
    expect(await other.balanceOf(recipient.address)).to.equal(before2 + 777n);

    await templ.daoChangePriest(recipient.address);
    expect(await templ.priest()).to.equal(recipient.address);

    expect(await templ.priestIsDictator()).to.equal(false);
    await templ.daoSetDictatorship(true);
    expect(await templ.priestIsDictator()).to.equal(true);
    await templ.daoSetDictatorship(false);
    expect(await templ.priestIsDictator()).to.equal(false);
    await expect(templ.daoSetDictatorship(false)).to.be.revertedWithCustomError(
      templ,
      "DictatorshipUnchanged"
    );
  });

  it("covers update + pause + disband wrappers via self-call", async function () {
    const { accounts, token, templ } = await deployHarness();
    const [owner, , m1, m2] = accounts;

    await templ.daoUpdate(ethers.ZeroAddress, 0n, false, 0, 0, 0);
    expect(await templ.entryFee()).to.equal(ENTRY_FEE);

    await templ.daoPause(true);
    expect(await templ.paused()).to.equal(true);
    await templ.daoPause(false);
    expect(await templ.paused()).to.equal(false);

    await token.mint(m1.address, ENTRY_FEE);
    await token.connect(m1).approve(templ.target, ENTRY_FEE);
    await templ.connect(m1).purchaseAccess();
    await token.mint(m2.address, ENTRY_FEE);
    await token.connect(m2).approve(templ.target, ENTRY_FEE);
    await templ.connect(m2).purchaseAccess();

    const treasuryBefore = await templ.treasuryBalance();
    const poolBefore = await templ.memberPoolBalance();
    await templ.daoDisband(token.target);
    expect(await templ.treasuryBalance()).to.equal(0n);
    expect(await templ.memberPoolBalance()).to.equal(poolBefore + treasuryBefore);
  });

  it("guards priest updates, config changes, and disband preconditions", async function () {
    const { accounts, token, templ } = await deployHarness();
    const [owner, , member, secondMember] = accounts;

    await expect(templ.daoChangePriest(ethers.ZeroAddress)).to.be.revertedWithCustomError(
      templ,
      "InvalidRecipient"
    );

    const Other = await ethers.getContractFactory("contracts/mocks/TestToken.sol:TestToken");
    const other = await Other.deploy("Other", "OTH", 18);
    await other.waitForDeployment();

    await expect(
      templ.daoUpdate(other.target, 0n, false, 0, 0, 0)
    ).to.be.revertedWithCustomError(templ, "TokenChangeDisabled");

    await expect(
      templ.daoUpdate(ethers.ZeroAddress, 5n, false, 0, 0, 0)
    ).to.be.revertedWithCustomError(templ, "EntryFeeTooSmall");

    await expect(
      templ.daoUpdate(ethers.ZeroAddress, 15n, false, 0, 0, 0)
    ).to.be.revertedWithCustomError(templ, "InvalidEntryFee");

    await expect(templ.daoDisband(token.target)).to.be.revertedWithCustomError(
      templ,
      "NoTreasuryFunds"
    );

    await token.mint(member.address, ENTRY_FEE);
    await token.connect(member).approve(templ.target, ENTRY_FEE);
    await templ.connect(member).purchaseAccess();
    await token.mint(secondMember.address, ENTRY_FEE);
    await token.connect(secondMember).approve(templ.target, ENTRY_FEE);
    await templ.connect(secondMember).purchaseAccess();

    await templ.daoDisband(token.target);
    await expect(
      templ.daoWithdraw(token.target, owner.address, 1n, "pool-locked")
    ).to.be.revertedWithCustomError(templ, "InsufficientTreasuryBalance");

    const Extra = await ethers.getContractFactory("contracts/mocks/TestToken.sol:TestToken");
    const extra = await Extra.deploy("Reserve", "RSV", 18);
    await extra.mint(owner.address, 10n);
    await extra.transfer(templ.target, 10n);

    await templ.daoDisband(extra.target);
    await expect(
      templ.daoWithdraw(extra.target, owner.address, 10n, "reserved")
    ).to.be.revertedWithCustomError(templ, "InsufficientTreasuryBalance");

    await owner.sendTransaction({ to: templ.target, value: ethers.parseUnits("1", 18) });
    await templ.daoDisband(ethers.ZeroAddress);
    await expect(
      templ.daoWithdraw(ethers.ZeroAddress, owner.address, ethers.parseUnits("1", 18), "reserved-eth")
    ).to.be.revertedWithCustomError(templ, "InsufficientTreasuryBalance");
  });

  it("covers membership cap wrappers and home link updates", async function () {
    const { accounts, token, templ } = await deployHarness();
    const [, , memberA, memberB, memberC] = accounts;

    await token.mint(memberA.address, ENTRY_FEE);
    await token.connect(memberA).approve(templ.target, ENTRY_FEE);
    await templ.connect(memberA).purchaseAccess();
    await token.mint(memberB.address, ENTRY_FEE);
    await token.connect(memberB).approve(templ.target, ENTRY_FEE);
    await templ.connect(memberB).purchaseAccess();

    await expect(templ.daoSetMaxMembers(1)).to.be.revertedWithCustomError(
      templ,
      "MemberLimitTooLow"
    );

    await templ.daoSetMaxMembers(3);
    expect(await templ.MAX_MEMBERS()).to.equal(3n);
    expect(await templ.paused()).to.equal(true);

    await templ.daoPause(false);
    expect(await templ.paused()).to.equal(false);
    expect(await templ.MAX_MEMBERS()).to.equal(3n);

    await token.mint(memberC.address, ENTRY_FEE);
    await token.connect(memberC).approve(templ.target, ENTRY_FEE);
    await expect(templ.connect(memberC).purchaseAccess())
      .to.be.revertedWithCustomError(templ, "MemberLimitReached");

    const link = "https://example.templ";
    await templ.daoSetHomeLink(link);
    expect(await templ.templHomeLink()).to.equal(link);

    // Same link should short-circuit without emitting events but still succeed
    await templ.daoSetHomeLink(link);
    expect(await templ.templHomeLink()).to.equal(link);
  });
});
