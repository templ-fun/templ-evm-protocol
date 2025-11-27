const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTemplModules, deployTemplDeployer } = require("./utils/modules");
const { getTemplAt } = require("./utils/templ");

describe("TemplFactory.safeDeployFor", function () {
  const ENTRY_FEE = ethers.parseUnits("100", 18);
  const PROBE = 100_000n; // mirrors SAFE_DEPLOY_PROBE_AMOUNT

  async function deployFactory(modules, templDeployer, deployer, protocolRecipient, protocolBps = 1_000) {
    const Factory = await ethers.getContractFactory("TemplFactory");
    const factory = await Factory.deploy(
      deployer.address,
      protocolRecipient.address,
      protocolBps,
      modules.membershipModule,
      modules.treasuryModule,
      modules.governanceModule,
      modules.councilModule,
      templDeployer
    );
    await factory.waitForDeployment();
    return factory;
  }

  async function deployTestToken() {
    const Token = await ethers.getContractFactory("contracts/mocks/TestToken.sol:TestToken");
    const token = await Token.deploy("Test", "TEST", 18);
    await token.waitForDeployment();
    return token;
  }

  async function deployFOTToken() {
    const Token = await ethers.getContractFactory("contracts/mocks/FeeOnTransferToken.sol:FeeOnTransferToken");
    const token = await Token.deploy("FOT", "FOT", 100); // 1% fee
    await token.waitForDeployment();
    return token;
  }

  let modules;
  let templDeployer;
  beforeEach(async function () {
    modules = await deployTemplModules();
    templDeployer = await deployTemplDeployer();
  });

  it("reverts with NonVanillaToken for fee-on-transfer tokens", async function () {
    const [deployer, protocolRecipient, priest] = await ethers.getSigners();
    const factory = await deployFactory(modules, templDeployer, deployer, protocolRecipient, 1_000);
    const fot = await deployFOTToken();

    // approve factory for the probe
    await fot.connect(deployer).approve(await factory.getAddress(), PROBE);

    await expect(
      factory.safeDeployFor(
        priest.address,
        await fot.getAddress(),
        ENTRY_FEE,
        "Safe FOT",
        "Should fail",
        "https://templ.fun/fot.png",
        0,
        0
      )
    ).to.be.revertedWithCustomError(factory, "NonVanillaToken");
  });

  it("deploys successfully for vanilla ERC-20 tokens", async function () {
    const [deployer, protocolRecipient, priest] = await ethers.getSigners();
    const factory = await deployFactory(modules, templDeployer, deployer, protocolRecipient, 1_000);
    const token = await deployTestToken();

    // fund deployer and approve factory for the probe
    await token.mint(deployer.address, PROBE * 10n);
    await token.connect(deployer).approve(await factory.getAddress(), PROBE);

    const templAddress = await factory.safeDeployFor.staticCall(
      priest.address,
      await token.getAddress(),
      ENTRY_FEE,
      "Safe Vanilla",
      "Should pass",
      "https://templ.fun/vanilla.png",
      0,
      0
    );
    await factory.safeDeployFor(
      priest.address,
      await token.getAddress(),
      ENTRY_FEE,
      "Safe Vanilla",
      "Should pass",
      "https://templ.fun/vanilla.png",
      0,
      0
    );

    const templ = await getTemplAt(templAddress, ethers.provider);
    expect(await templ.priest()).to.equal(priest.address);
  });
});
