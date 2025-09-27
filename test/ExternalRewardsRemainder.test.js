const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, purchaseAccess } = require("./utils/mintAndPurchase");

describe("External reward remainders", function () {
  it("do not leak to members who joined after the remainder accrued", async function () {
    const [owner, protocolRecipient, member1, member2, member3, lateMember] = await ethers.getSigners();

    const AccessToken = await ethers.getContractFactory(
      "contracts/mocks/TestToken.sol:TestToken"
    );
    const accessToken = await AccessToken.deploy("Membership", "MEM", 18);
    await accessToken.waitForDeployment();

    const RewardToken = await ethers.getContractFactory(
      "contracts/mocks/TestToken.sol:TestToken"
    );
    const rewardToken = await RewardToken.deploy("Reward", "RWD", 18);
    await rewardToken.waitForDeployment();

    const entryFee = ethers.parseUnits("100", 18);

    const Harness = await ethers.getContractFactory(
      "contracts/mocks/DaoCallerHarness.sol:DaoCallerHarness"
    );
    const templ = await Harness.deploy(
      owner.address,
      protocolRecipient.address,
      accessToken.target,
      entryFee
    );
    await templ.waitForDeployment();

    const initialMembers = [member1, member2, member3];
    await mintToUsers(accessToken, [...initialMembers, lateMember], entryFee * 5n);
    await purchaseAccess(templ, accessToken, initialMembers, entryFee);

    const tenTokens = ethers.parseUnits("10", 18);
    await rewardToken.mint(owner.address, ethers.parseUnits("100", 18));
    await rewardToken.connect(owner).transfer(templ.target, tenTokens);
    await templ.connect(owner).daoDisband(rewardToken.target);

    await purchaseAccess(templ, accessToken, [lateMember], entryFee);

    const sevenTokens = ethers.parseUnits("7", 18);
    await rewardToken.connect(owner).transfer(templ.target, sevenTokens);
    await templ.connect(owner).daoDisband(rewardToken.target);

    const claimableLate = await templ.getClaimableExternalToken(lateMember.address, rewardToken.target);

    const totalMembers = await templ.getMemberCount();
    const expected = sevenTokens / totalMembers;
    expect(claimableLate).to.equal(expected);
  });

  it("allows members to claim ERC20 rewards routed through disband", async function () {
    const entryFee = ethers.parseUnits("100", 18);
    const { templ, token, accounts, priest } = await deployTempl({ entryFee, priestIsDictator: true });
    const [, , member1, member2] = accounts;

    await mintToUsers(token, [member1, member2], entryFee * 3n);
    await purchaseAccess(templ, token, [member1, member2], entryFee);

    const RewardToken = await ethers.getContractFactory(
      "contracts/mocks/TestToken.sol:TestToken"
    );
    const rewardToken = await RewardToken.deploy("Reward", "RWD", 18);
    await rewardToken.waitForDeployment();

    const rewardAmount = ethers.parseUnits("12", 18);
    await rewardToken.mint(priest.address, rewardAmount);
    await rewardToken.connect(priest).transfer(await templ.getAddress(), rewardAmount);

    await templ.connect(priest).disbandTreasuryDAO(rewardToken.target);

    const claimable = await templ.getClaimableExternalToken(member1.address, rewardToken.target);
    expect(claimable).to.be.gt(0n);

    const before = await rewardToken.balanceOf(member1.address);
    await expect(templ.connect(member1).claimExternalToken(rewardToken.target))
      .to.emit(templ, "ExternalRewardClaimed")
      .withArgs(rewardToken.target, member1.address, claimable);
    const after = await rewardToken.balanceOf(member1.address);
    expect(after - before).to.equal(claimable);
  });
});
