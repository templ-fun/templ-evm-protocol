const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTemplModules } = require("./utils/modules");
const { attachTemplInterface } = require("./utils/templ");

describe("Param update events withArgs", function () {
  const ENTRY_FEE = ethers.parseUnits("100", 18);
  const DAY = 24 * 60 * 60;

  it("emits PostQuorumVotingPeriodUpdated and BurnAddressUpdated with exact args (onlyDAO)", async function () {
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

    const beforeDelay = await templ.postQuorumVotingPeriod();
    const newDelay = 5 * DAY;
    await expect(templ.daoSetPostQuorumVotingPeriod(newDelay))
      .to.emit(templ, "PostQuorumVotingPeriodUpdated")
      .withArgs(beforeDelay, BigInt(newDelay));

    const beforeBurn = await templ.burnAddress();
    const newBurn = ethers.getAddress("0x00000000000000000000000000000000000000ba");
    await expect(templ.daoSetBurnAddress(newBurn))
      .to.emit(templ, "BurnAddressUpdated")
      .withArgs(beforeBurn, newBurn);
  });
});
