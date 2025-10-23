const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTemplModules } = require("./utils/modules");
const { attachTemplInterface } = require("./utils/templ");

const ENTRY_FEE = ethers.parseUnits("100", 18);

async function deployHarness(entryFee = ENTRY_FEE) {
  const accounts = await ethers.getSigners();
  const [, priest] = accounts;

  const Token = await ethers.getContractFactory("contracts/mocks/TestToken.sol:TestToken");
  const token = await Token.deploy("Test", "TEST", 18);
  await token.waitForDeployment();

  const modules = await deployTemplModules();
  const Harness = await ethers.getContractFactory("contracts/mocks/DaoCallerHarness.sol:DaoCallerHarness");
  let templ = await Harness.deploy(
    priest.address,
    priest.address,
    token.target,
    entryFee,
    modules.membershipModule,
    modules.treasuryModule,
    modules.governanceModule
  );
  await templ.waitForDeployment();
  templ = await attachTemplInterface(templ);

  return { accounts, token, templ };
}

describe("WrapperCoverage (onlyDAO externals)", function () {
  it("covers withdraw wrappers via self-call", async function () {
    const { accounts, token, templ } = await deployHarness();
    const [owner, , member, recipient] = accounts;

    await token.mint(member.address, ENTRY_FEE);
    await token.connect(member).approve(templ.target, ENTRY_FEE);
    await templ.connect(member).join();

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

    await templ.daoUpdate(0n, false, 0, 0, 0);
    expect(await templ.entryFee()).to.equal(ENTRY_FEE);

    await templ.daoPause(true);
    expect(await templ.joinPaused()).to.equal(true);
    await templ.daoPause(false);
    expect(await templ.joinPaused()).to.equal(false);

    await token.mint(m1.address, ENTRY_FEE);
    await token.connect(m1).approve(templ.target, ENTRY_FEE);
    await templ.connect(m1).join();
    await token.mint(m2.address, ENTRY_FEE);
    await token.connect(m2).approve(templ.target, ENTRY_FEE);
    await templ.connect(m2).join();

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

    // Token changes are ignored (immutable access token); call proceeds without revert
    await expect(templ.daoUpdate(0n, false, 0, 0, 0)).to.not.be.reverted;
    expect(await templ.accessToken()).to.equal(await token.getAddress());

    await expect(
      templ.daoUpdate(5n, false, 0, 0, 0)
    ).to.be.revertedWithCustomError(templ, "EntryFeeTooSmall");

    await expect(
      templ.daoUpdate(15n, false, 0, 0, 0)
    ).to.be.revertedWithCustomError(templ, "InvalidEntryFee");

    await expect(templ.daoDisband(token.target)).to.be.revertedWithCustomError(
      templ,
      "NoTreasuryFunds"
    );

    await token.mint(member.address, ENTRY_FEE);
    await token.connect(member).approve(templ.target, ENTRY_FEE);
    await templ.connect(member).join();
    await token.mint(secondMember.address, ENTRY_FEE);
  await token.connect(secondMember).approve(templ.target, ENTRY_FEE);
  await templ.connect(secondMember).join();

  // Donate additional access tokens so disband has funds even if treasury accounting is zeroed.
  await token.mint(templ.target, ENTRY_FEE);

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
    await templ.connect(memberA).join();
    await token.mint(memberB.address, ENTRY_FEE);
    await token.connect(memberB).approve(templ.target, ENTRY_FEE);
    await templ.connect(memberB).join();

    await expect(templ.daoSetMaxMembers(1)).to.be.revertedWithCustomError(
      templ,
      "MemberLimitTooLow"
    );

    await templ.daoSetMaxMembers(3);
    expect(await templ.maxMembers()).to.equal(3n);
    expect(await templ.joinPaused()).to.equal(true);

    await templ.daoPause(false);
    expect(await templ.joinPaused()).to.equal(false);
    expect(await templ.maxMembers()).to.equal(3n);

    await token.mint(memberC.address, ENTRY_FEE);
    await token.connect(memberC).approve(templ.target, ENTRY_FEE);
    await expect(templ.connect(memberC).join())
      .to.be.revertedWithCustomError(templ, "MemberLimitReached");

    const metadata = {
      name: "Example Templ",
      description: "Example description",
      logo: "https://example.templ/logo.png"
    };
    await templ.daoSetMetadata(metadata.name, metadata.description, metadata.logo);
    expect(await templ.templName()).to.equal(metadata.name);
    expect(await templ.templDescription()).to.equal(metadata.description);
    expect(await templ.templLogoLink()).to.equal(metadata.logo);

    // Same metadata should no-op but still succeed
    await templ.daoSetMetadata(metadata.name, metadata.description, metadata.logo);
    expect(await templ.templLogoLink()).to.equal(metadata.logo);
  });

  it("permits dictator priests to call DAO functions directly", async function () {
    const { accounts, token, templ } = await deployHarness();
    const [, priest, member, newPriest] = accounts;

    await templ.daoSetDictatorship(true);

    await expect(templ.connect(priest).setJoinPausedDAO(true)).to.not.be.reverted;
    await expect(templ.connect(priest).setJoinPausedDAO(false)).to.not.be.reverted;

    await expect(templ.connect(priest).setMaxMembersDAO(5)).to.not.be.reverted;
    await expect(
      templ.connect(priest).setTemplMetadataDAO(
        "Dictator Templ",
        "Dictator description",
        "https://dictator.templ/logo.png"
      )
    ).to.emit(templ, "TemplMetadataUpdated");

    await token.mint(member.address, ENTRY_FEE);
    await token.connect(member).approve(templ.target, ENTRY_FEE);
    await templ.connect(member).join();

    await expect(templ.connect(priest).disbandTreasuryDAO(token.target)).to.not.be.reverted;

    await expect(templ.connect(priest).changePriestDAO(newPriest.address)).to.not.be.reverted;
  });

  it("covers proposal fee and referral wrappers via self-call", async function () {
    const { templ } = await deployHarness();

    // Proposal fee bps
    expect(await templ.proposalCreationFeeBps()).to.equal(500n);
    await templ.daoSetProposalFee(750);
    expect(await templ.proposalCreationFeeBps()).to.equal(750n);

    // Referral share bps
    expect(await templ.referralShareBps()).to.equal(0n);
    await templ.daoSetReferralShare(1200);
    expect(await templ.referralShareBps()).to.equal(1200n);
  });

  it("covers curve + cleanup wrappers (DAO calls)", async function () {
    const { templ, token, accounts } = await deployHarness();
    const [, priest, member] = accounts;

    // Enable dictatorship so priest can call onlyDAO externals
    await templ.daoSetDictatorship(true);

    // setEntryFeeCurveDAO via direct call
    const newCurve = { primary: { style: 2, rateBps: 12000, length: 0 }, additionalSegments: [] };
    const baseBefore = await templ.baseEntryFee();
    await expect(templ.connect(priest).setEntryFeeCurveDAO(newCurve, 0)).to.emit(templ, "EntryFeeCurveUpdated");
    // base remains unchanged when baseEntryFee is zero
    expect(await templ.baseEntryFee()).to.equal(baseBefore);

    // cleanupExternalRewardToken should revert for access token, still covers function path
    await expect(
      templ.connect(priest).cleanupExternalRewardToken(await token.getAddress())
    ).to.be.revertedWithCustomError(templ, "InvalidCallData");
  });
});
