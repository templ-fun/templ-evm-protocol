const { expect } = require("chai");
const { ethers } = require("hardhat");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const { deployTemplModules } = require("./utils/modules");
const { attachTemplInterface } = require("./utils/templ");

describe("TemplTreasury onlyDAO exhaustive coverage", function () {
  const ENTRY_FEE = ethers.parseUnits("100", 18);
  const DAY = 24 * 60 * 60;

  it("calls all treasury DAO setters and actions via onlyDAO self-call", async function () {
    const [, priest, protocol, recipient] = await ethers.getSigners();
    const AccessToken = await ethers.getContractFactory("contracts/mocks/TestToken.sol:TestToken");
    const token = await AccessToken.deploy("Access", "ACC", 18);
    await token.waitForDeployment();
    const Harness = await ethers.getContractFactory(
      "contracts/mocks/DaoCallerHarness.sol:DaoCallerHarness"
    );
    const modules = await deployTemplModules();
    let templ = await Harness.deploy(
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

    // Prepare balances for withdrawals/disbands
    await token.mint(recipient.address, ENTRY_FEE * 10n);
    // Transfer some access tokens into templ as treasury (beyond join accounting)
    await token.connect(recipient).transfer(await templ.getAddress(), ENTRY_FEE);
    // Fund ETH treasury
    await priest.sendTransaction({ to: await templ.getAddress(), value: ethers.parseEther("1") });

    // Pause/unpause
    await expect(templ.daoPause(true)).to.emit(templ, "JoinPauseUpdated").withArgs(true);
    await expect(templ.daoPause(false)).to.emit(templ, "JoinPauseUpdated").withArgs(false);

    // Max members
    await expect(templ.daoSetMaxMembers(5)).to.emit(templ, "MaxMembersUpdated").withArgs(5);

    // Quorum and delays, burn, pre-quorum default
    await expect(templ.daoSetQuorum(4000))
      .to.emit(templ, "QuorumBpsUpdated").withArgs(3300n, 4000n);
    await expect(templ.daoSetPostQuorumVotingPeriod(2 * DAY))
      .to.emit(templ, "PostQuorumVotingPeriodUpdated").withArgs(anyValue, 2n * 24n * 60n * 60n);
    const newBurn = ethers.getAddress("0x00000000000000000000000000000000000000b1");
    await expect(templ.daoSetBurnAddress(newBurn))
      .to.emit(templ, "BurnAddressUpdated").withArgs(anyValue, newBurn);
    await templ.daoSetPreQuorumVotingPeriod(36 * 60 * 60); // at min, event asserted elsewhere

    // Metadata
    await expect(templ.daoSetMetadata("Meta", "Desc", "https://logo"))
      .to.emit(templ, "TemplMetadataUpdated")
      .withArgs("Meta", "Desc", "https://logo");

    // Proposal fee + referral share
    await templ.daoSetProposalFee(250);
    await templ.daoSetReferralShare(1500);

    // Update config (entryFee only, no split)
    await templ.daoUpdate(ENTRY_FEE + 10n, false, 0, 0, 0);
    expect(await templ.entryFee()).to.equal(ENTRY_FEE + 10n);

    // Entry fee curve update
    const staticCurve = { primary: { style: 0, rateBps: 0, length: 0 }, additionalSegments: [] };
    await expect(templ.daoSetEntryFeeCurve(staticCurve, 0)).to.emit(templ, "EntryFeeCurveUpdated");

    // Withdrawals
    // ERC20
    const beforeBal = await token.balanceOf(recipient.address);
    await templ.daoWithdraw(await token.getAddress(), recipient.address, 10n);
    expect(await token.balanceOf(recipient.address)).to.equal(beforeBal + 10n);
    // ETH
    const recipEthBefore = await ethers.provider.getBalance(recipient.address);
    await templ.daoWithdraw(ethers.ZeroAddress, recipient.address, 1n);
    expect(await ethers.provider.getBalance(recipient.address)).to.equal(recipEthBefore + 1n);

    // BatchDAO OK then revert path (already tested elsewhere) – run a small OK batch here
    const Target = await ethers.getContractFactory("contracts/mocks/ExternalCallTarget.sol:ExternalCallTarget");
    const target = await Target.deploy();
    await target.waitForDeployment();
    const setNum = target.interface.encodeFunctionData("setNumber", [123]);
    await templ.daoBatch([target.target], [0], [setNum]);
    expect(await target.storedValue()).to.equal(123n);
  });
});
