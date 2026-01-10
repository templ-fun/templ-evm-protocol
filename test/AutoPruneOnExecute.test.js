const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, joinMembers } = require("./utils/mintAndPurchase");

describe("Auto tail prune on execute", function () {
  it("prunes up to k inactive proposals from the tail after execution", async function () {
    // Configure a valid post-quorum delay so quorum-reached proposals end quickly.
    const EXEC_DELAY = 60 * 60; // seconds
    const VOTING_PERIOD = 36 * 60 * 60; // pre-quorum period (min), ignored once quorum is reached
    const { templ, token, accounts } = await deployTempl({ executionDelay: EXEC_DELAY });

    const entryFee = await templ.entryFee();
    // Use 8 members so quorum is reached immediately at creation via proposer auto-YES.
    const members = accounts.slice(2, 10);
    await mintToUsers(token, members, entryFee * 10n);
    await joinMembers(templ, token, members);

    // Create more stale proposals than the auto-prune batch size (k=5)
    const STALE_COUNT = 8;
    for (let i = 0; i < STALE_COUNT; i += 1) {
      await templ
        .connect(members[i])
        .createProposalSetJoinPaused(false, VOTING_PERIOD, `Old-${i}`, `Old description ${i}`);
    }

    // Advance beyond the pre-quorum voting period so the proposals end without quorum.
    await ethers.provider.send("evm_increaseTime", [VOTING_PERIOD + 1]);
    await ethers.provider.send("evm_mine", []);

    // Create a fresh proposal we will execute to trigger auto-prune.
    const tx = await templ
      .connect(members[6])
      .createProposalSetJoinPaused(false, VOTING_PERIOD, "Live", "To execute");
    const receipt = await tx.wait();
    // Extract the proposal id from the ProposalCreated event (last arg is endTime; id is first indexed topic)
    const event = receipt.logs.map((l) => {
      try { return templ.interface.parseLog(l); } catch { return null; }
    }).find((e) => e && e.name === "ProposalCreated");
    const liveId = event?.args?.[0] ?? 6n; // fallback to expected id if parsing fails

    // Reach quorum by collecting two additional YES votes (3/9 >= 33%).
    await templ.connect(members[0]).vote(liveId, true);
    await templ.connect(members[1]).vote(liveId, true);

    // Wait the post-quorum delay then execute the live proposal
    const delay = Number(await templ.postQuorumVotingPeriod());
    await ethers.provider.send("evm_increaseTime", [delay + 1]);
    await ethers.provider.send("evm_mine", []);
    await templ.executeProposal(liveId);

    // Auto-prune removes up to k=5 from the tail. We started with 6 stale entries.
    // So only 1 inactive id should remain to be pruned manually.
    const remaining = await templ.pruneInactiveProposals.staticCall(100);
    // Expect only STALE_COUNT - k items to remain after auto-prune.
    expect(remaining).to.equal(BigInt(STALE_COUNT - 5));

    // Apply the manual prune and verify nothing else remains afterwards.
    await templ.pruneInactiveProposals(100);
    const remainingAgain = await templ.pruneInactiveProposals.staticCall(100);
    expect(remainingAgain).to.equal(0n);
  });

  it("caps tail scanning so older inactive proposals remain for manual pruning", async function () {
    const DAY = 24 * 60 * 60;
    const EXEC_DELAY = 60 * 60;
    const SHORT_PERIOD = 2 * DAY;
    const LONG_PERIOD = 10 * DAY;
    const STALE_COUNT = 6;
    const ACTIVE_TAIL_COUNT = 30;
    const { templ, token, accounts } = await deployTempl({ executionDelay: EXEC_DELAY });

    const entryFee = await templ.entryFee();
    const members = accounts.slice(2);
    const extraWallets = [];
    while (members.length < ACTIVE_TAIL_COUNT) {
      const wallet = ethers.Wallet.createRandom().connect(ethers.provider);
      extraWallets.push(wallet);
      members.push(wallet);
    }

    for (const wallet of extraWallets) {
      await accounts[0].sendTransaction({
        to: wallet.address,
        value: ethers.parseEther("1"),
      });
    }

    await mintToUsers(token, members, entryFee * 5n);
    await joinMembers(templ, token, members);

    for (let i = 0; i < STALE_COUNT; i += 1) {
      await templ
        .connect(members[i])
        .createProposalSetJoinPaused(false, SHORT_PERIOD, `Stale-${i}`, "Expires");
    }

    await ethers.provider.send("evm_increaseTime", [SHORT_PERIOD + 1]);
    await ethers.provider.send("evm_mine", []);

    for (let i = 0; i < ACTIVE_TAIL_COUNT; i += 1) {
      await templ
        .connect(members[i])
        .createProposalSetJoinPaused(false, LONG_PERIOD, `Live-${i}`, "Active");
    }

    const liveId = (await templ.proposalCount()) - 1n;
    for (let i = 0; i < 12; i += 1) {
      await templ.connect(members[i]).vote(liveId, true);
    }

    const delay = Number(await templ.postQuorumVotingPeriod());
    await ethers.provider.send("evm_increaseTime", [delay + 1]);
    await ethers.provider.send("evm_mine", []);
    await templ.executeProposal(liveId);

    const remaining = await templ.pruneInactiveProposals.staticCall(1000);
    expect(remaining).to.equal(BigInt(STALE_COUNT));

    await templ.pruneInactiveProposals(1000);
    const remainingAgain = await templ.pruneInactiveProposals.staticCall(1000);
    expect(remainingAgain).to.equal(0n);
  });
});
