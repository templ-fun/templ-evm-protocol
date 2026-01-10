const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, joinMembers } = require("./utils/mintAndPurchase");

describe("Prune inactive proposals edge cases", function () {
  const SHORT_PERIOD = 2 * 24 * 60 * 60;
  const LONG_PERIOD = 10 * 24 * 60 * 60;

  it("returns zero when no proposals exist and when maxRemovals is zero", async function () {
    const { templ, token, accounts } = await deployTempl();
    const [, , member1, member2] = accounts;

    expect(await templ.pruneInactiveProposals.staticCall(0)).to.equal(0n);
    expect(await templ.pruneInactiveProposals.staticCall(5)).to.equal(0n);
    await templ.pruneInactiveProposals(0);
    await templ.pruneInactiveProposals(5);

    const entryFee = await templ.entryFee();
    await mintToUsers(token, [member1, member2], entryFee * 5n);
    await joinMembers(templ, token, [member1, member2]);

    await templ.connect(member1).createProposalSetJoinPaused(false, SHORT_PERIOD, "A", "");
    await templ.connect(member2).createProposalSetJoinPaused(false, SHORT_PERIOD, "B", "");

    await ethers.provider.send("evm_increaseTime", [SHORT_PERIOD + 1]);
    await ethers.provider.send("evm_mine", []);

    expect(await templ.pruneInactiveProposals.staticCall(0)).to.equal(0n);
    await templ.pruneInactiveProposals(0);
    expect(await templ.pruneInactiveProposals.staticCall(10)).to.equal(2n);
  });

  it("does not remove active proposals", async function () {
    const { templ, token, accounts } = await deployTempl();
    const members = accounts.slice(2, 5);
    const entryFee = await templ.entryFee();

    await mintToUsers(token, members, entryFee * 5n);
    await joinMembers(templ, token, members);

    for (let i = 0; i < members.length; i += 1) {
      await templ
        .connect(members[i])
        .createProposalSetJoinPaused(false, LONG_PERIOD, `Active-${i}`, "Active");
    }

    expect(await templ.pruneInactiveProposals.staticCall(10)).to.equal(0n);
    await templ.pruneInactiveProposals(10);

    const active = await templ.getActiveProposals();
    expect(active.length).to.equal(members.length);
  });

  it("respects maxRemovals for expired proposals", async function () {
    const { templ, token, accounts } = await deployTempl();
    const members = accounts.slice(2, 7);
    const entryFee = await templ.entryFee();

    await mintToUsers(token, members, entryFee * 5n);
    await joinMembers(templ, token, members);

    for (let i = 0; i < members.length; i += 1) {
      await templ
        .connect(members[i])
        .createProposalSetJoinPaused(false, SHORT_PERIOD, `Stale-${i}`, "Stale");
    }

    await ethers.provider.send("evm_increaseTime", [SHORT_PERIOD + 1]);
    await ethers.provider.send("evm_mine", []);

    expect(await templ.pruneInactiveProposals.staticCall(2)).to.equal(2n);
    await templ.pruneInactiveProposals(2);

    expect(await templ.pruneInactiveProposals.staticCall(10)).to.equal(3n);
    await templ.pruneInactiveProposals(10);

    expect(await templ.pruneInactiveProposals.staticCall(10)).to.equal(0n);
  });

  it("prunes interleaved inactive proposals without skipping", async function () {
    const { templ, token, accounts } = await deployTempl();
    const [, , member1, member2, member3, member4] = accounts;
    const entryFee = await templ.entryFee();

    const members = [member1, member2, member3, member4];
    await mintToUsers(token, members, entryFee * 5n);
    await joinMembers(templ, token, members);

    await templ.connect(member1).createProposalSetJoinPaused(false, SHORT_PERIOD, "Short-1", "");
    await templ.connect(member2).createProposalSetJoinPaused(false, LONG_PERIOD, "Long-1", "");
    await templ.connect(member3).createProposalSetJoinPaused(false, SHORT_PERIOD, "Short-2", "");
    await templ.connect(member4).createProposalSetJoinPaused(false, LONG_PERIOD, "Long-2", "");

    await ethers.provider.send("evm_increaseTime", [SHORT_PERIOD + 1]);
    await ethers.provider.send("evm_mine", []);

    expect(await templ.pruneInactiveProposals.staticCall(5)).to.equal(2n);
    await templ.pruneInactiveProposals(5);
    expect(await templ.pruneInactiveProposals.staticCall(5)).to.equal(0n);

    const active = await templ.getActiveProposals();
    expect(active.length).to.equal(2);
  });
});
