const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTemplModules } = require("./utils/modules");
const { attachTemplInterface } = require("./utils/templ");

describe("External reward enumeration limits + cleanup edge cases", function () {
  it("reaches max external reward tokens and reverts on further registrations", async function () {
    const accounts = await ethers.getSigners();
    const [, priest] = accounts;

    const modules = await deployTemplModules();
    const Harness = await ethers.getContractFactory("contracts/mocks/TemplHarness.sol:TemplHarness");
    // Use a synthetic access token address (not interacted with in this test)
    const accessAddr = ethers.getAddress("0x000000000000000000000000000000000000acc0");
    let templ = await Harness.deploy(
      priest.address,
      priest.address,
      accessAddr,
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

    const MAX = 256; // matches MAX_EXTERNAL_REWARD_TOKENS
    const seen = new Set();
    for (let i = 0; i < MAX; i += 1) {
      let addr;
      do {
        addr = ethers.Wallet.createRandom().address;
      } while (seen.has(addr));
      seen.add(addr);
      await templ.harnessRegisterExternalToken(addr);
    }
    expect((await templ.getExternalRewardTokens()).length).to.equal(MAX);

    const extra = ethers.Wallet.createRandom().address;
    await expect(templ.harnessRegisterExternalToken(extra))
      .to.be.revertedWithCustomError(templ, "ExternalRewardLimitReached");
  });

  it("cleanupExternalRewardToken reverts for access token, non-existent token, and unsettled pools", async function () {
    const { ethers: hEthers } = require("hardhat");
    const accounts = await hEthers.getSigners();
    const [deployer, priest] = accounts;
    const Token = await hEthers.getContractFactory("contracts/mocks/TestToken.sol:TestToken");
    const access = await Token.deploy("Access", "ACC", 18);
    await access.waitForDeployment();
    const reward = await Token.deploy("Reward", "RWD", 18);
    await reward.waitForDeployment();

    const modules = await deployTemplModules();
    const Harness = await hEthers.getContractFactory("contracts/mocks/TemplHarness.sol:TemplHarness");
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
      true,
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

    // access token cleanup should revert
    await expect(templ.connect(priest).cleanupExternalRewardToken(access.target))
      .to.be.revertedWithCustomError(templ, "InvalidCallData");

    // non-existent token cleanup should revert
    const other = await Token.deploy("Other", "OTH", 18);
    await other.waitForDeployment();
    await expect(templ.connect(priest).cleanupExternalRewardToken(other.target))
      .to.be.revertedWithCustomError(templ, "InvalidCallData");

    // Register reward token and create a non-zero remainder to make it unsettled
    await templ.harnessRegisterExternalToken(reward.target);
    await templ.harnessSeedExternalRemainder(reward.target, 1n, 0n);
    await expect(templ.connect(priest).cleanupExternalRewardToken(reward.target))
      .to.be.revertedWithCustomError(templ, "ExternalRewardsNotSettled");
  });

  it("removes external tokens by swapping with last index", async function () {
    const accounts = await ethers.getSigners();
    const [, priest] = accounts;
    const modules = await deployTemplModules();
    const Harness = await ethers.getContractFactory("contracts/mocks/TemplHarness.sol:TemplHarness");
    const accessAddr = ethers.getAddress("0x000000000000000000000000000000000000acc1");
    let templ = await Harness.deploy(
      priest.address,
      priest.address,
      accessAddr,
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
    const a = ethers.getAddress("0x2000000000000000000000000000000000000001");
    const b = ethers.getAddress("0x2000000000000000000000000000000000000002");
    const c = ethers.getAddress("0x2000000000000000000000000000000000000003");
    await templ.harnessRegisterExternalToken(a);
    await templ.harnessRegisterExternalToken(b);
    await templ.harnessRegisterExternalToken(c);
    expect((await templ.getExternalRewardTokens()).length).to.equal(3);

    await templ.harnessRemoveExternalToken(b);
    const list = await templ.getExternalRewardTokens();
    expect(list.length).to.equal(2);
    expect(list.includes(b)).to.equal(false);
    expect(list.includes(a)).to.equal(true);
    expect(list.includes(c)).to.equal(true);
  });
});
