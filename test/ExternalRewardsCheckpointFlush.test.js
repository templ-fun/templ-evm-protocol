const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTemplModules } = require("./utils/modules");
const { attachTemplInterface } = require("./utils/templ");

describe("External rewards: checkpoint updates and remainder flush", function () {
  it("updates latest checkpoint in the same block and flushes remainders", async function () {
    const accounts = await ethers.getSigners();
    const [, priest] = accounts;
    const Token = await ethers.getContractFactory("contracts/mocks/TestToken.sol:TestToken");
    const access = await Token.deploy("Access", "ACC", 18);
    await access.waitForDeployment();

    const modules = await deployTemplModules();
    const Harness = await ethers.getContractFactory("contracts/mocks/TemplHarness.sol:TemplHarness");
    let templ = await Harness.deploy(
      priest.address,
      priest.address,
      access.target,
      1000n,
      3000,
      3000,
      3000,
      1000,
      3300,
      36 * 60 * 60,
      "0x000000000000000000000000000000000000dEaD",
      false,
      0,
      "Harness",
      "Harness",
      "https://logo",
      0,
      0,
      modules.membershipModule,
      modules.treasuryModule,
      modules.governanceModule
    );
    await templ.waitForDeployment();
    templ = await attachTemplInterface(templ);

    const reward = await Token.deploy("Reward", "RWD", 18);
    await reward.waitForDeployment();
    const reward2 = await Token.deploy("Reward2", "RW2", 18);
    await reward2.waitForDeployment();

    // Seed a checkpoint, then update in same block and confirm last entry is mutated
    await templ.harnessResetExternalRewards(reward.target, 10n);
    await templ.harnessUpdateCheckpointSameBlock(reward.target, 42n);
    const latest = await templ.harnessGetLatestCheckpoint(reward.target);
    expect(latest[2]).to.equal(42n);

    // Flush remainders when no members: no-op
    await templ.harnessSeedExternalRemainder(reward.target, 5n, 42n);
    await templ.harnessClearMembers();
    await templ.harnessFlushExternalRemainders();

    // Create two members and seed a remainder; per-member = 6 / 2 = 3
    const entryFee = 1000n;
    const [,, m1, m2] = accounts;
    await (await access.mint(m1.address, entryFee)).wait();
    await (await access.mint(m2.address, entryFee)).wait();
    await (await access.connect(m1).approve(templ.target, entryFee)).wait();
    await (await access.connect(m2).approve(templ.target, entryFee)).wait();
    await (await templ.connect(m1).join()).wait();
    await (await templ.connect(m2).join()).wait();

    // Use a freshly registered token for flush so enumeration contains it
    await templ.harnessRegisterExternalToken(reward2.target);
    await templ.harnessSeedExternalRemainder(reward2.target, 6n, 42n);
    await templ.harnessFlushExternalRemainders();
    const latest2 = await templ.harnessGetLatestCheckpoint(reward2.target);
    // cumulative increased by 3
    expect(latest2[2]).to.equal(45n);
  });
});
