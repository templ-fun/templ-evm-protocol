const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, joinMembers } = require("./utils/mintAndPurchase");

describe("Remainder sweep flows", function () {
  it("allows the DAO to sweep external reward remainder dust", async function () {
    const entryFee = ethers.parseUnits("100", 18);
    const { templ, token, accounts, priest } = await deployTempl({ entryFee, priestIsDictator: true });
    const [, , member1, member2, recipient] = accounts;

    await mintToUsers(token, [member1, member2], entryFee * 2n);
    await joinMembers(templ, token, [member1, member2], entryFee);

    const RewardToken = await ethers.getContractFactory(
      "contracts/mocks/TestToken.sol:TestToken"
    );
    const rewardToken = await RewardToken.deploy("Reward", "RWD", 18);
    await rewardToken.waitForDeployment();

    const rewardAmount = ethers.parseUnits("5", 18);
    await rewardToken.mint(priest.address, rewardAmount);
    await rewardToken.connect(priest).transfer(await templ.getAddress(), rewardAmount);

    await templ.connect(priest).disbandTreasuryDAO(rewardToken.target);

    await templ.connect(member1).claimExternalReward(rewardToken.target);
    await templ.connect(member2).claimExternalReward(rewardToken.target);
    await templ.connect(priest).claimExternalReward(rewardToken.target);

    const [, , remainderBefore] = await templ.getExternalRewardState(rewardToken.target);
    expect(remainderBefore).to.be.gt(0n);

    await expect(
      templ.connect(priest).sweepExternalRewardRemainderDAO(rewardToken.target, recipient.address)
    )
      .to.emit(templ, "ExternalRewardRemainderSwept")
      .withArgs(rewardToken.target, recipient.address, remainderBefore);

    const [, , remainderAfter] = await templ.getExternalRewardState(rewardToken.target);
    expect(remainderAfter).to.equal(0n);
    expect(await rewardToken.balanceOf(recipient.address)).to.equal(remainderBefore);

    await expect(templ.connect(priest).cleanupExternalRewardToken(rewardToken.target)).to.not.be.reverted;
  });

  it("allows the DAO to sweep member pool remainder dust", async function () {
    const entryFee = ethers.parseUnits("1010", 18);
    const { templ, token, accounts, priest } = await deployTempl({
      entryFee,
      priestIsDictator: true,
      burnBps: 2900,
      treasuryBps: 2900,
      memberPoolBps: 3200,
    });
    const [, , member1, member2, member3, recipient] = accounts;

    await mintToUsers(token, [member1, member2, member3], entryFee * 2n);
    await joinMembers(templ, token, [member1, member2, member3], entryFee);

    const remainderBefore = await templ.memberRewardRemainder();
    expect(remainderBefore).to.be.gt(0n);
    const poolBefore = await templ.memberPoolBalance();

    await expect(templ.connect(priest).sweepMemberPoolRemainderDAO(recipient.address))
      .to.emit(templ, "MemberPoolRemainderSwept")
      .withArgs(recipient.address, remainderBefore);

    expect(await templ.memberRewardRemainder()).to.equal(0n);
    expect(await templ.memberPoolBalance()).to.equal(poolBefore - remainderBefore);
    expect(await token.balanceOf(recipient.address)).to.equal(remainderBefore);
  });
});
