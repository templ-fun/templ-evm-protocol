const { expect } = require("chai");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const { ethers } = require("hardhat");
const { mintToUsers, joinMembers } = require("./utils/mintAndPurchase");
const { deployTemplModules } = require("./utils/modules");
const { attachTemplInterface } = require("./utils/templ");

describe("TemplTreasury onlyDAO council and remainder paths", function () {
  const ENTRY_FEE = 1010n;

  let templ;
  let token;
  let accounts;

  beforeEach(async function () {
    accounts = await ethers.getSigners();
    const [, priest, protocol] = accounts;

    const AccessToken = await ethers.getContractFactory("contracts/mocks/TestToken.sol:TestToken");
    token = await AccessToken.deploy("Access", "ACC", 18);
    await token.waitForDeployment();

    const Harness = await ethers.getContractFactory(
      "contracts/mocks/DaoCallerHarness.sol:DaoCallerHarness"
    );
    const modules = await deployTemplModules();
    templ = await Harness.deploy(
      priest.address,
      protocol.address,
      token.target,
      ENTRY_FEE,
      modules.membershipModule,
      modules.treasuryModule,
      modules.governanceModule,
      modules.councilModule
    );
    await templ.waitForDeployment();
    templ = await attachTemplInterface(templ);
  });

  it("updates council and threshold settings via onlyDAO wrappers", async function () {
    const [, , , member1, member2] = accounts;
    await mintToUsers(token, [member1, member2], ENTRY_FEE * 10n);
    await joinMembers(templ, token, [member1, member2]);

    await templ.daoAddCouncilMember(member1.address);
    expect(await templ.councilMembers(member1.address)).to.equal(true);
    expect(await templ.councilMemberCount()).to.equal(2n);

    await templ.daoSetCouncilMode(true);
    expect(await templ.councilModeEnabled()).to.equal(true);
    await templ.daoSetCouncilMode(false);
    expect(await templ.councilModeEnabled()).to.equal(false);

    await templ.daoSetYesVoteThreshold(6000);
    expect(await templ.yesVoteThresholdBps()).to.equal(6000n);

    await templ.daoSetInstantQuorum(9000);
    expect(await templ.instantQuorumBps()).to.equal(9000n);

    await templ.daoRemoveCouncilMember(member1.address);
    expect(await templ.councilMembers(member1.address)).to.equal(false);
    expect(await templ.councilMemberCount()).to.equal(1n);

    await templ.daoChangePriest(member2.address);
    expect(await templ.priest()).to.equal(member2.address);
  });

  it("sweeps member pool remainder and disbands treasury via onlyDAO", async function () {
    const [, , , member1, member2, recipient] = accounts;
    await mintToUsers(token, [member1, member2], ENTRY_FEE * 10n);
    await joinMembers(templ, token, [member1, member2]);

    const remainder = await templ.memberRewardRemainder();
    expect(remainder).to.be.gt(0n);

    const recipientBefore = await token.balanceOf(recipient.address);
    await expect(templ.daoSweepMemberPoolRemainder(recipient.address))
      .to.emit(templ, "MemberPoolRemainderSwept")
      .withArgs(recipient.address, remainder);
    expect(await token.balanceOf(recipient.address)).to.equal(recipientBefore + remainder);

    const memberPoolBefore = await templ.memberPoolBalance();
    const accessToken = await templ.accessToken();
    await expect(templ.daoDisband(accessToken))
      .to.emit(templ, "TreasuryDisbanded")
      .withArgs(0, accessToken, anyValue, anyValue, anyValue);
    expect(await templ.treasuryBalance()).to.equal(0n);
    expect(await templ.memberPoolBalance()).to.be.gt(memberPoolBefore);
  });
});
