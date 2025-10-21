const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTemplModules } = require("./utils/modules");
const { attachTemplInterface } = require("./utils/templ");

describe("Treasury harness withdrawals", function () {
  it("covers withdraw branches through self-call", async function () {
    const [owner, priest, protocol, recipient] = await ethers.getSigners();

    const AccessToken = await ethers.getContractFactory(
      "contracts/mocks/TestToken.sol:TestToken"
    );
    const accessToken = await AccessToken.deploy("Access", "ACC", 18);
    await accessToken.waitForDeployment();

    const Harness = await ethers.getContractFactory(
      "contracts/mocks/DaoCallerHarness.sol:DaoCallerHarness"
    );
    const modules = await deployTemplModules();
    let harness = await Harness.deploy(
      priest.address,
      protocol.address,
      accessToken.target,
      1_000_000n,
      modules.membershipModule,
      modules.treasuryModule,
      modules.governanceModule
    );
    await harness.waitForDeployment();
    harness = await attachTemplInterface(harness);

    const accessAmount = ethers.parseUnits("5", 18);
    await accessToken.mint(await harness.getAddress(), accessAmount);
    await harness.daoWithdraw(accessToken.target, recipient.address, accessAmount, "access");
    expect(await accessToken.balanceOf(recipient.address)).to.equal(accessAmount);

    const ethAmount = ethers.parseUnits("1", 18);
    await owner.sendTransaction({ to: await harness.getAddress(), value: ethAmount });
    const ethBefore = await ethers.provider.getBalance(recipient.address);
    const tx = await harness.daoWithdraw(ethers.ZeroAddress, recipient.address, ethAmount, "eth");
    await tx.wait();
    const ethAfter = await ethers.provider.getBalance(recipient.address);
    expect(ethAfter - ethBefore).to.equal(ethAmount);

    const RewardToken = await ethers.getContractFactory(
      "contracts/mocks/TestToken.sol:TestToken"
    );
    const rewardToken = await RewardToken.deploy("Reward", "RWD", 18);
    await rewardToken.waitForDeployment();
    await rewardToken.mint(await harness.getAddress(), accessAmount);
    await harness.daoWithdraw(rewardToken.target, recipient.address, accessAmount, "reward");
    expect(await rewardToken.balanceOf(recipient.address)).to.equal(accessAmount);
  });
});
