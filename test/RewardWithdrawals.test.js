const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, purchaseAccess } = require("./utils/mintAndPurchase");

async function bootstrapTempl() {
  const entryFee = ethers.parseUnits("100", 18);
  const { templ, token, accounts, priest } = await deployTempl({ entryFee, priestIsDictator: true });
  const [owner, , member1, member2, member3] = accounts;

  await mintToUsers(token, [owner, member1, member2, member3], entryFee * 10n);
  await purchaseAccess(templ, token, [member1, member2, member3], entryFee);

  const members = [priest, member1, member2, member3];
  for (const member of members) {
    const claimable = await templ.getClaimablePoolAmount(member.address);
    if (claimable > 0n) {
      await templ.connect(member).claimMemberPool();
    }
    expect(await templ.getClaimablePoolAmount(member.address)).to.equal(0n);
  }

  expect(await templ.memberPoolBalance()).to.equal(0n);
  expect(await templ.memberRewardRemainder()).to.equal(0n);

  return { templ, token, owner, priest, members, entryFee };
}

describe("Reward withdrawal rounding", function () {
  it("allows members to withdraw their share after an uneven member pool disband", async function () {
    const { templ, token, owner, priest, members } = await bootstrapTempl();
    const templAddress = await templ.getAddress();
    const deposit = ethers.parseUnits("5", 18);

    const poolBefore = await templ.memberPoolBalance();
    const remainderBefore = await templ.memberRewardRemainder();
    await token.connect(owner).transfer(templAddress, deposit);
    await templ.connect(priest).disbandTreasuryDAO(await token.getAddress());

    const memberCount = BigInt(members.length);
    const poolAfter = await templ.memberPoolBalance();
    const remainderAfter = await templ.memberRewardRemainder();
    const poolIncrease = poolAfter - poolBefore;
    const expectedPerMember = (poolIncrease + remainderBefore - remainderAfter) / memberCount;

    expect(poolIncrease).to.be.gt(0n);
    expect(expectedPerMember).to.be.gt(0n);
    expect(remainderAfter).to.equal((poolIncrease + remainderBefore) % memberCount);

    let totalClaimed = 0n;
    for (const member of members) {
      const claimable = await templ.getClaimablePoolAmount(member.address);
      expect(claimable).to.equal(expectedPerMember);

      const beforeBalance = await token.balanceOf(member.address);
      await templ.connect(member).claimMemberPool();
      const afterBalance = await token.balanceOf(member.address);

      expect(afterBalance - beforeBalance).to.equal(claimable);
      totalClaimed += claimable;
      expect(await templ.getClaimablePoolAmount(member.address)).to.equal(0n);
    }

    const poolAfterClaims = await templ.memberPoolBalance();
    expect(poolAfterClaims).to.equal(remainderAfter);
    expect(totalClaimed + poolAfterClaims).to.equal(poolIncrease + remainderBefore);
  });

  it("rolls member pool remainders forward across multiple disbands", async function () {
    const { templ, token, owner, priest, members } = await bootstrapTempl();
    const templAddress = await templ.getAddress();
    const firstDeposit = ethers.parseUnits("5", 18);
    const secondDeposit = ethers.parseUnits("3", 18);

    const memberCount = BigInt(members.length);
    const poolStart = await templ.memberPoolBalance();
    const remainderStart = await templ.memberRewardRemainder();

    await token.connect(owner).transfer(templAddress, firstDeposit);
    await templ.connect(priest).disbandTreasuryDAO(await token.getAddress());
    const poolAfterFirst = await templ.memberPoolBalance();
    const remainderAfterFirst = await templ.memberRewardRemainder();
    const increaseFirst = poolAfterFirst - poolStart;
    const perMemberFirst = (increaseFirst + remainderStart - remainderAfterFirst) / memberCount;

    await token.connect(owner).transfer(templAddress, secondDeposit);
    await templ.connect(priest).disbandTreasuryDAO(await token.getAddress());
    const poolAfterSecond = await templ.memberPoolBalance();
    const remainderAfterSecond = await templ.memberRewardRemainder();
    const increaseSecond = poolAfterSecond - poolAfterFirst;
    const perMemberSecond = (increaseSecond + remainderAfterFirst - remainderAfterSecond) / memberCount;

    const expectedPerMember = perMemberFirst + perMemberSecond;
    expect(perMemberFirst).to.be.gt(0n);
    expect(perMemberSecond).to.be.gt(0n);
    expect(remainderAfterSecond).to.equal((increaseSecond + remainderAfterFirst) % memberCount);

    let totalClaimed = 0n;
    for (const member of members) {
      const claimable = await templ.getClaimablePoolAmount(member.address);
      expect(claimable).to.equal(expectedPerMember);

      const beforeBalance = await token.balanceOf(member.address);
      await templ.connect(member).claimMemberPool();
      const afterBalance = await token.balanceOf(member.address);

      expect(afterBalance - beforeBalance).to.equal(claimable);
      totalClaimed += claimable;
      expect(await templ.getClaimablePoolAmount(member.address)).to.equal(0n);
    }

    const poolAfter = await templ.memberPoolBalance();
    expect(poolAfter).to.equal(remainderAfterSecond);
    expect(totalClaimed + poolAfter).to.equal(increaseFirst + increaseSecond + remainderStart);
  });

  it("lets members withdraw uneven ERC20 external rewards after sequential disbands", async function () {
    const { templ, token, owner, priest, members } = await bootstrapTempl();
    const templAddress = await templ.getAddress();

    const RewardToken = await ethers.getContractFactory("contracts/mocks/TestToken.sol:TestToken");
    const rewardToken = await RewardToken.deploy("Reward", "RWD", 18);
    await rewardToken.waitForDeployment();

    const firstDeposit = ethers.parseUnits("5", 18);
    const secondDeposit = ethers.parseUnits("3", 18);
    await rewardToken.mint(owner.address, firstDeposit + secondDeposit);

    const memberCount = BigInt(members.length);
    const [poolStart, , remainderStart] = await templ.getExternalRewardState(rewardToken.target);

    await rewardToken.connect(owner).transfer(templAddress, firstDeposit);
    await templ.connect(priest).disbandTreasuryDAO(rewardToken.target);
    const [poolAfterFirst, , remainderAfterFirst] = await templ.getExternalRewardState(rewardToken.target);
    const increaseFirst = poolAfterFirst - poolStart;
    const perMemberFirst = (increaseFirst + remainderStart - remainderAfterFirst) / memberCount;

    await rewardToken.connect(owner).transfer(templAddress, secondDeposit);
    await templ.connect(priest).disbandTreasuryDAO(rewardToken.target);
    const [poolAfterSecond, , remainderAfterSecond] = await templ.getExternalRewardState(rewardToken.target);
    const increaseSecond = poolAfterSecond - poolAfterFirst;
    const perMemberSecond = (increaseSecond + remainderAfterFirst - remainderAfterSecond) / memberCount;

    const expectedPerMember = perMemberFirst + perMemberSecond;
    expect(perMemberFirst).to.be.gt(0n);
    expect(perMemberSecond).to.be.gt(0n);
    expect(remainderAfterSecond).to.equal((increaseSecond + remainderAfterFirst) % memberCount);

    let totalClaimed = 0n;
    for (const member of members) {
      const claimable = await templ.getClaimableExternalToken(member.address, rewardToken.target);
      expect(claimable).to.equal(expectedPerMember);

      const beforeBalance = await rewardToken.balanceOf(member.address);
      await templ.connect(member).claimExternalToken(rewardToken.target);
      const afterBalance = await rewardToken.balanceOf(member.address);

      expect(afterBalance - beforeBalance).to.equal(claimable);
      totalClaimed += claimable;
      expect(await templ.getClaimableExternalToken(member.address, rewardToken.target)).to.equal(0n);
    }

    const [poolAfterClaims, , remainderAfterClaims] = await templ.getExternalRewardState(rewardToken.target);
    expect(poolAfterClaims).to.equal(remainderAfterSecond);
    expect(remainderAfterClaims).to.equal(remainderAfterSecond);
    expect(totalClaimed + poolAfterClaims).to.equal(increaseFirst + increaseSecond + remainderStart);
  });

  it("allows members to claim uneven ETH external rewards without failures", async function () {
    const { templ, owner, priest, members } = await bootstrapTempl();
    const templAddress = await templ.getAddress();
    const deposit = ethers.parseUnits("5", 18);

    const [poolBefore, , remainderBefore] = await templ.getExternalRewardState(ethers.ZeroAddress);
    await owner.sendTransaction({ to: templAddress, value: deposit });
    await templ.connect(priest).disbandTreasuryDAO(ethers.ZeroAddress);

    const memberCount = BigInt(members.length);
    const [poolAfter, , remainderAfter] = await templ.getExternalRewardState(ethers.ZeroAddress);
    const poolIncrease = poolAfter - poolBefore;
    const expectedPerMember = (poolIncrease + remainderBefore - remainderAfter) / memberCount;

    expect(poolIncrease).to.be.gt(0n);
    expect(expectedPerMember).to.be.gt(0n);
    expect(remainderAfter).to.equal((poolIncrease + remainderBefore) % memberCount);

    let totalClaimed = 0n;
    for (const member of members) {
      const claimable = await templ.getClaimableExternalToken(member.address, ethers.ZeroAddress);
      expect(claimable).to.equal(expectedPerMember);
      const contractBalanceBefore = await ethers.provider.getBalance(templAddress);
      await templ.connect(member).claimExternalToken(ethers.ZeroAddress);
      const contractBalanceAfter = await ethers.provider.getBalance(templAddress);

      expect(contractBalanceBefore - contractBalanceAfter).to.equal(claimable);
      totalClaimed += claimable;
      expect(await templ.getClaimableExternalToken(member.address, ethers.ZeroAddress)).to.equal(0n);
    }

    const [poolFinal, , remainderFinal] = await templ.getExternalRewardState(ethers.ZeroAddress);
    expect(poolFinal).to.equal(remainderAfter);
    expect(remainderFinal).to.equal(remainderAfter);
    expect(totalClaimed + poolFinal).to.equal(poolIncrease + remainderBefore);
  });
});
