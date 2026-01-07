const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, joinMembers } = require("./utils/mintAndPurchase");
const { deployTemplModules } = require("./utils/modules");
const { attachTemplInterface } = require("./utils/templ");

const DAY = 24 * 60 * 60;
const MIN_POST_QUORUM = 60 * 60;
const MAX_POST_QUORUM = 30 * DAY;
const ENTRY_FEE = ethers.parseUnits("100", 18);

describe("Post-quorum voting period bounds", function () {
  it("rejects out-of-range DAO updates and accepts valid values", async function () {
    const [, priest, protocol] = await ethers.getSigners();
    const AccessToken = await ethers.getContractFactory("contracts/mocks/TestToken.sol:TestToken");
    const accessToken = await AccessToken.deploy("Access", "ACC", 18);
    await accessToken.waitForDeployment();
    const Harness = await ethers.getContractFactory(
      "contracts/mocks/DaoCallerHarness.sol:DaoCallerHarness"
    );
    const modules = await deployTemplModules();
    let templ = await Harness.deploy(
      priest.address,
      protocol.address,
      accessToken.target,
      ENTRY_FEE,
      modules.membershipModule,
      modules.treasuryModule,
      modules.governanceModule,
      modules.councilModule
    );
    await templ.waitForDeployment();
    templ = await attachTemplInterface(templ);

    await expect(
      templ.daoSetPostQuorumVotingPeriod(MIN_POST_QUORUM - 1)
    ).to.be.revertedWithCustomError(templ, "InvalidCallData");
    await expect(
      templ.daoSetPostQuorumVotingPeriod(MAX_POST_QUORUM + 1)
    ).to.be.revertedWithCustomError(templ, "InvalidCallData");

    await expect(
      templ.daoSetPostQuorumVotingPeriod(MIN_POST_QUORUM)
    ).to.emit(templ, "PostQuorumVotingPeriodUpdated");
    expect(await templ.postQuorumVotingPeriod()).to.equal(BigInt(MIN_POST_QUORUM));
  });

  it("reverts proposals that attempt to set invalid post-quorum periods", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, , proposer, voter] = accounts;

    await mintToUsers(token, [proposer, voter], ENTRY_FEE * 3n);
    await joinMembers(templ, token, [proposer, voter], ENTRY_FEE);

    await expect(
      templ
        .connect(proposer)
        .createProposalSetPostQuorumVotingPeriod(MIN_POST_QUORUM - 1, 7 * DAY, "Bad delay", "")
    ).to.be.revertedWithCustomError(templ, "InvalidCallData");
  });
});
