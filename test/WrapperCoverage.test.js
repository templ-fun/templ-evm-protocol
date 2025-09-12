const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("WrapperCoverage (onlyDAO externals)", function () {
  const ENTRY_FEE = ethers.parseUnits("100", 18);

  it("covers withdraw wrappers via self-call", async function () {
    const accounts = await ethers.getSigners();
    const [owner, priest, member, recipient] = accounts;

    const Token = await ethers.getContractFactory("contracts/mocks/TestToken.sol:TestToken");
    const token = await Token.deploy("Test", "TEST", 18);
    await token.waitForDeployment();

    const Harness = await ethers.getContractFactory("contracts/mocks/DaoCallerHarness.sol:DaoCallerHarness");
    const templ = await Harness.deploy(priest.address, priest.address, token.target, ENTRY_FEE);
    await templ.waitForDeployment();

    // Fund member and perform purchase to seed treasury
    await token.mint(member.address, ENTRY_FEE);
    await token.connect(member).approve(templ.target, ENTRY_FEE);
    await templ.connect(member).purchaseAccess();

    // withdraw part of treasury in access token
    const amount = (ENTRY_FEE * 30n) / 100n; // 30% in treasury
    const before = await token.balanceOf(recipient.address);
    await templ.daoWithdraw(token.target, recipient.address, amount, "payout");
    expect(await token.balanceOf(recipient.address)).to.equal(before + amount);

    // donate other ERC20 and withdraw full via withdrawTreasuryDAO
    const Other = await ethers.getContractFactory("contracts/mocks/TestToken.sol:TestToken");
    const other = await Other.deploy("Other", "OTH", 18);
    await other.mint(owner.address, 1000n);
    await other.transfer(templ.target, 777n);
    const before2 = await other.balanceOf(recipient.address);
    await templ.daoWithdraw(other.target, recipient.address, 777n, "drain");
    expect(await other.balanceOf(recipient.address)).to.equal(before2 + 777n);
  });

  it("covers update + pause + disband wrappers via self-call", async function () {
    const accounts = await ethers.getSigners();
    const [owner, priest, m1, m2] = accounts;

    const Token = await ethers.getContractFactory("contracts/mocks/TestToken.sol:TestToken");
    const token = await Token.deploy("Test", "TEST", 18);
    await token.waitForDeployment();

    const Harness = await ethers.getContractFactory("contracts/mocks/DaoCallerHarness.sol:DaoCallerHarness");
    const templ = await Harness.deploy(priest.address, priest.address, token.target, ENTRY_FEE);
    await templ.waitForDeployment();

    // hit update wrapper with no-op change
    await templ.daoUpdate(ethers.ZeroAddress, 0n);
    expect(await templ.entryFee()).to.equal(ENTRY_FEE);

    // pause/unpause
    await templ.daoPause(true);
    expect(await templ.paused()).to.equal(true);
    await templ.daoPause(false);
    expect(await templ.paused()).to.equal(false);

    // seed treasury with two members then disband to pool
    await token.mint(m1.address, ENTRY_FEE);
    await token.connect(m1).approve(templ.target, ENTRY_FEE);
    await templ.connect(m1).purchaseAccess();
    await token.mint(m2.address, ENTRY_FEE);
    await token.connect(m2).approve(templ.target, ENTRY_FEE);
    await templ.connect(m2).purchaseAccess();

    const treasuryBefore = await templ.treasuryBalance();
    const poolBefore = await templ.memberPoolBalance();
    await templ.daoDisband();
    expect(await templ.treasuryBalance()).to.equal(0n);
    expect(await templ.memberPoolBalance()).to.equal(poolBefore + treasuryBefore);
  });

});
