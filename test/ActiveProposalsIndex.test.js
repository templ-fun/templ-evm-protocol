const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, joinMembers } = require("./utils/mintAndPurchase");

describe("Active proposal indexing", function () {
  it("prunes inactive proposals to keep the active set small", async function () {
    const votingPeriod = 7 * 24 * 60 * 60;
    const { templ, token, accounts } = await deployTempl({ executionDelay: 60 * 60 });
    const entryFee = await templ.entryFee();
    const members = accounts.slice(2, 6);

    await mintToUsers(token, members, entryFee * 5n);
    await joinMembers(templ, token, members, entryFee);

    await templ.pruneInactiveProposals(0);

    for (let i = 0; i < 3; i += 1) {
      await templ
        .connect(members[i])
        .createProposalSetJoinPaused(false, votingPeriod, `Pause-${i}`, `Description ${i}`);
    }

    const activeIds = await templ.getActiveProposals();
    expect(activeIds.length).to.equal(3);

    await ethers.provider.send("evm_increaseTime", [votingPeriod + 1]);
    await ethers.provider.send("evm_mine", []);

    const stillActive = await templ.getActiveProposals();
    expect(stillActive.length).to.equal(0);

    const removed = await templ.pruneInactiveProposals.staticCall(10);
    expect(removed).to.equal(3n);
    await templ.pruneInactiveProposals(10);

    const removedAgain = await templ.pruneInactiveProposals.staticCall(10);
    expect(removedAgain).to.equal(0n);
  });

  it("stops pruning when the latest proposal is still active", async function () {
    const votingPeriod = 7 * 24 * 60 * 60;
    const { templ, token, accounts } = await deployTempl({ executionDelay: 60 * 60 });
    const entryFee = await templ.entryFee();
    const members = accounts.slice(2, 4);

    await mintToUsers(token, members, entryFee * 2n);
    await joinMembers(templ, token, members, entryFee);

    await templ
      .connect(members[0])
      .createProposalSetJoinPaused(false, votingPeriod, "Live", "Still active");

    const attempt = await templ.pruneInactiveProposals.staticCall(5);
    expect(attempt).to.equal(0n);
    await templ.pruneInactiveProposals(5);
  });
});
