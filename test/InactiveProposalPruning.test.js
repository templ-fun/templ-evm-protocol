const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, joinMembers } = require("./utils/mintAndPurchase");

describe("Inactive proposal pruning", function () {
  const ENTRY_FEE = ethers.parseUnits("100", 18);

  it("removes inactive proposals even when newer ones are still active", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, , member1, member2, member3] = accounts;

    await mintToUsers(token, [member1, member2, member3], ENTRY_FEE * 5n);
    await joinMembers(templ, token, [member1, member2, member3]);

    const shortPeriod = 2 * 24 * 60 * 60;
    const longPeriod = 20 * 24 * 60 * 60;

    await templ
      .connect(member1)
      .createProposalSetBurnAddress("0x00000000000000000000000000000000000000d1", shortPeriod, "short", "");
    await templ
      .connect(member2)
      .createProposalSetBurnAddress("0x00000000000000000000000000000000000000d2", longPeriod, "long", "");

    await ethers.provider.send("evm_increaseTime", [shortPeriod + 1]);
    await ethers.provider.send("evm_mine", []);

    const removed = await templ.pruneInactiveProposals.staticCall(1);
    expect(removed).to.equal(1n);
    await templ.pruneInactiveProposals(1);
  });
});
