const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, joinMembers } = require("./utils/mintAndPurchase");

describe("Fee extremes (proposal + referral)", function () {
  const ENTRY_FEE = ethers.parseUnits("100", 18);
  const BPS = 10_000n;

  it("proposal fee 0: no token pull on create", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE, proposalFeeBps: 0 });
    const [, , proposer, voter] = accounts;
    await mintToUsers(token, [proposer, voter], ENTRY_FEE * 5n);
    await joinMembers(templ, token, [proposer, voter]);

    const treasuryBefore = await templ.treasuryBalance();
    const proposerBefore = await token.balanceOf(proposer.address);

    await templ.connect(proposer).createProposalSetJoinPaused(true, 7 * 24 * 60 * 60, "Pause", "No fee");

    expect(await templ.treasuryBalance()).to.equal(treasuryBefore);
    expect(await token.balanceOf(proposer.address)).to.equal(proposerBefore);
  });

  it("proposal fee 100%: pulls full entry fee on create", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE, proposalFeeBps: 10_000 });
    const [, , proposer, voter] = accounts;
    await mintToUsers(token, [proposer, voter], ENTRY_FEE * 5n);
    await joinMembers(templ, token, [proposer, voter]);

    await token.connect(proposer).approve(await templ.getAddress(), ENTRY_FEE);
    const treasuryBefore = await templ.treasuryBalance();
    const proposerBefore = await token.balanceOf(proposer.address);

    await templ.connect(proposer).createProposalSetJoinPaused(true, 7 * 24 * 60 * 60, "Pause", "Max fee");

    expect(await templ.treasuryBalance()).to.equal(treasuryBefore + ENTRY_FEE);
    expect(await token.balanceOf(proposer.address)).to.equal(proposerBefore - ENTRY_FEE);
  });

  it("recalculates proposal fees after entry fee updates", async function () {
    const feeBps = 500;
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE, proposalFeeBps: feeBps });
    const [, , proposer, voter] = accounts;
    await mintToUsers(token, [proposer, voter], ENTRY_FEE * 10n);
    await joinMembers(templ, token, [proposer, voter]);

    const templAddress = await templ.getAddress();
    await token.connect(proposer).approve(templAddress, ethers.MaxUint256);

    const oldEntryFee = await templ.entryFee();
    const newEntryFee = oldEntryFee * 2n;

    await templ
      .connect(proposer)
      .createProposalUpdateConfig(newEntryFee, 0, 0, 0, false, 7 * 24 * 60 * 60, "Raise fee", "");
    const updateId = (await templ.proposalCount()) - 1n;
    await templ.connect(voter).vote(updateId, true);
    const delay = Number(await templ.postQuorumVotingPeriod());
    await ethers.provider.send("evm_increaseTime", [delay + 1]);
    await ethers.provider.send("evm_mine", []);
    await templ.executeProposal(updateId);
    expect(await templ.entryFee()).to.equal(newEntryFee);

    const treasuryBefore = await templ.treasuryBalance();
    const proposerBefore = await token.balanceOf(proposer.address);

    await templ
      .connect(proposer)
      .createProposalSetJoinPaused(true, 7 * 24 * 60 * 60, "Pause", "Fee uses new entry");

    const expectedFee = (newEntryFee * BigInt(feeBps)) / BPS;
    expect(await templ.treasuryBalance()).to.equal(treasuryBefore + expectedFee);
    expect(await token.balanceOf(proposer.address)).to.equal(proposerBefore - expectedFee);
  });

  it("referral share 0: pays nothing to referrer and credits full pool", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE, referralShareBps: 0 });
    const [, , referrer, newcomer] = accounts;
    await mintToUsers(token, [referrer, newcomer], ENTRY_FEE * 5n);
    await joinMembers(templ, token, [referrer]);

    const poolBefore = await templ.memberPoolBalance();
    const refBefore = await token.balanceOf(referrer.address);
    const memberPoolBps = await templ.memberPoolBps();
    const expectedMemberPool = (ENTRY_FEE * memberPoolBps) / BPS;

    await token.connect(newcomer).approve(await templ.getAddress(), ENTRY_FEE);
    const receipt = await (await templ.connect(newcomer).joinWithReferral(referrer.address)).wait();
    const referralEvent = receipt.logs
      .map((l)=>{try{return templ.interface.parseLog(l);}catch(_){return null;}})
      .find((log)=>log && log.name === "ReferralRewardPaid");
    expect(referralEvent).to.equal(undefined);

    expect(await templ.memberPoolBalance()).to.equal(poolBefore + expectedMemberPool);
    expect(await token.balanceOf(referrer.address)).to.equal(refBefore);
  });

  it("referral share 100%: pays entire pool to referrer", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE, referralShareBps: 10_000 });
    const [, , referrer, newcomer] = accounts;
    await mintToUsers(token, [referrer, newcomer], ENTRY_FEE * 5n);
    await joinMembers(templ, token, [referrer]);

    const poolBefore = await templ.memberPoolBalance();
    const refBefore = await token.balanceOf(referrer.address);
    const memberPoolBps = await templ.memberPoolBps();
    const expectedMemberPool = (ENTRY_FEE * memberPoolBps) / BPS;

    await token.connect(newcomer).approve(await templ.getAddress(), ENTRY_FEE);
    const receipt = await (await templ.connect(newcomer).joinWithReferral(referrer.address)).wait();
    const referralEvent = receipt.logs
      .map((l)=>{try{return templ.interface.parseLog(l);}catch(_){return null;}})
      .find((log)=>log && log.name === "ReferralRewardPaid");
    expect(referralEvent?.args?.amount).to.equal(expectedMemberPool);

    // Entire pool paid to referrer; pool increment is zero
    expect(await templ.memberPoolBalance()).to.equal(poolBefore);
    expect(await token.balanceOf(referrer.address)).to.equal(refBefore + expectedMemberPool);
  });
});
