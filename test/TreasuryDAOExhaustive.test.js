const { expect } = require("chai");
const { ethers } = require("hardhat");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, joinMembers } = require("./utils/mintAndPurchase");

describe("TemplTreasury onlyDAO exhaustive coverage", function () {
  const ENTRY_FEE = ethers.parseUnits("100", 18);
  const DAY = 24 * 60 * 60;

  async function enableDictatorship(templ, token, member) {
    await mintToUsers(token, [member], ENTRY_FEE * 2n);
    await joinMembers(templ, token, [member]);
    await templ.connect(member).createProposalSetDictatorship(true, 7 * DAY, "Enable", "");
    await templ.connect(member).vote(0, true);
    await ethers.provider.send("evm_increaseTime", [7 * DAY + 1]);
    await ethers.provider.send("evm_mine", []);
    await templ.executeProposal(0);
  }

  it("calls all treasury DAO setters and actions directly under dictatorship", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, priest, member, recipient] = accounts;
    await enableDictatorship(templ, token, member);

    // Prepare balances for withdrawals/disbands
    await token.mint(recipient.address, ENTRY_FEE * 10n);
    // Transfer some access tokens into templ as treasury (beyond join accounting)
    await token.connect(recipient).transfer(await templ.getAddress(), ENTRY_FEE);
    // Fund ETH treasury
    await priest.sendTransaction({ to: await templ.getAddress(), value: ethers.parseEther("1") });

    // Pause/unpause
    await expect(templ.connect(priest).setJoinPausedDAO(true)).to.emit(templ, "JoinPauseUpdated").withArgs(true);
    await expect(templ.connect(priest).setJoinPausedDAO(false)).to.emit(templ, "JoinPauseUpdated").withArgs(false);

    // Max members
    await expect(templ.connect(priest).setMaxMembersDAO(5)).to.emit(templ, "MaxMembersUpdated").withArgs(5);

    // Quorum and delays, burn, pre-quorum default
    await expect(templ.connect(priest).setQuorumBpsDAO(4000))
      .to.emit(templ, "QuorumBpsUpdated").withArgs(3300n, 4000n);
    await expect(templ.connect(priest).setPostQuorumVotingPeriodDAO(2 * DAY))
      .to.emit(templ, "PostQuorumVotingPeriodUpdated").withArgs(anyValue, 2n * 24n * 60n * 60n);
    const newBurn = ethers.getAddress("0x00000000000000000000000000000000000000b1");
    await expect(templ.connect(priest).setBurnAddressDAO(newBurn))
      .to.emit(templ, "BurnAddressUpdated").withArgs(anyValue, newBurn);
    await templ.connect(priest).setPreQuorumVotingPeriodDAO(36 * 60 * 60); // at min, event asserted elsewhere

    // Metadata
    await expect(
      templ.connect(priest).setTemplMetadataDAO("Meta", "Desc", "https://logo")
    ).to.emit(templ, "TemplMetadataUpdated").withArgs("Meta", "Desc", "https://logo");

    // Proposal fee + referral share
    await templ.connect(priest).setProposalCreationFeeBpsDAO(250);
    await templ.connect(priest).setReferralShareBpsDAO(1500);

    // Update config (entryFee only, no split)
    await templ.connect(priest).updateConfigDAO(ENTRY_FEE + 10n, false, 0, 0, 0);
    expect(await templ.entryFee()).to.equal(ENTRY_FEE + 10n);

    // Entry fee curve update
    const staticCurve = { primary: { style: 0, rateBps: 0, length: 0 }, additionalSegments: [] };
    await expect(templ.connect(priest).setEntryFeeCurveDAO(staticCurve, 0))
      .to.emit(templ, "EntryFeeCurveUpdated");

    // Disband treasury to pool (access token), then cleanup external token after adding and settling pool
    const Other = await ethers.getContractFactory("contracts/mocks/TestToken.sol:TestToken");
    const other = await Other.deploy("Other", "OTH", 18);
    await other.waitForDeployment();
    // donate other token and disband -> external pool track
    await other.mint(priest.address, ethers.parseUnits("10", 18));
    await other.connect(priest).transfer(await templ.getAddress(), ethers.parseUnits("10", 18));
    await templ.connect(priest).disbandTreasuryDAO(other.target);
    // Claim external reward to reduce pool and then cleanup only after pool is 0
    // We will zero pool by trying to cleanup and expect revert, then distribute remainder (if any) by adding a member then claim
    await expect(templ.connect(priest).cleanupExternalRewardToken(other.target))
      .to.be.revertedWithCustomError(templ, "ExternalRewardsNotSettled");
    // Add another member to flush potential remainder paths and claim
    const [, , , , joiner] = accounts;
    await mintToUsers(token, [joiner], ENTRY_FEE * 2n);
    await token.connect(joiner).approve(await templ.getAddress(), await templ.entryFee());
    await templ.connect(joiner).join();
    const claimablePriest = await templ.getClaimableExternalReward(priest.address, other.target);
    if (claimablePriest > 0n) {
      await templ.connect(priest).claimExternalReward(other.target);
    }
    const claimableJoiner = await templ.getClaimableExternalReward(joiner.address, other.target);
    if (claimableJoiner > 0n) {
      await templ.connect(joiner).claimExternalReward(other.target);
    }
    // Pool and remainder should now be 0 or minimal; attempt cleanup (if still not 0, skip)
    const state = await templ.getExternalRewardState(other.target);
    if (state.poolBalance === 0n && state.remainder === 0n) {
      await templ.connect(priest).cleanupExternalRewardToken(other.target);
    }

    // Withdrawals
    // ERC20
    const beforeBal = await token.balanceOf(recipient.address);
    await templ.connect(priest).withdrawTreasuryDAO(await token.getAddress(), recipient.address, 10n);
    expect(await token.balanceOf(recipient.address)).to.equal(beforeBal + 10n);
    // ETH
    const recipEthBefore = await ethers.provider.getBalance(recipient.address);
    await templ.connect(priest).withdrawTreasuryDAO(ethers.ZeroAddress, recipient.address, 1n);
    expect(await ethers.provider.getBalance(recipient.address)).to.equal(recipEthBefore + 1n);

    // BatchDAO OK then revert path (already tested elsewhere) – run a small OK batch here
    const Target = await ethers.getContractFactory("contracts/mocks/ExternalCallTarget.sol:ExternalCallTarget");
    const target = await Target.deploy();
    await target.waitForDeployment();
    const setNum = target.interface.encodeFunctionData("setNumber", [123]);
    await templ.connect(priest).batchDAO([target.target], [0], [setNum]);
    expect(await target.storedValue()).to.equal(123n);
  });
});

