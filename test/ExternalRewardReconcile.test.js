const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");

const ENTRY_FEE = ethers.parseUnits("100", 18);

describe("External reward token reconciliation", function () {
  it("registers external reward tokens via DAO and is idempotent", async function () {
    const { templ, priest } = await deployTempl({ entryFee: ENTRY_FEE, priestIsDictator: true });

    const RewardToken = await ethers.getContractFactory("contracts/mocks/TestToken.sol:TestToken");
    const reward = await RewardToken.deploy("Reward", "RWD", 18);
    await reward.waitForDeployment();

    const before = await templ.getExternalRewardTokens();
    expect(before).to.not.include(reward.target);

    await templ.connect(priest).reconcileExternalRewardTokenDAO(reward.target);
    const after = await templ.getExternalRewardTokens();
    expect(after).to.include(reward.target);

    const lengthAfter = after.length;
    await templ.connect(priest).reconcileExternalRewardTokenDAO(reward.target);
    const afterRepeat = await templ.getExternalRewardTokens();
    expect(afterRepeat.length).to.equal(lengthAfter);
  });

  it("reverts when reconciling the access token", async function () {
    const { templ, priest, token } = await deployTempl({ entryFee: ENTRY_FEE, priestIsDictator: true });

    await expect(
      templ.connect(priest).reconcileExternalRewardTokenDAO(await token.getAddress())
    ).to.be.revertedWithCustomError(templ, "InvalidCallData");
  });
});
