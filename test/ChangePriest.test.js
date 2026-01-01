const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, joinMembers } = require("./utils/mintAndPurchase");

describe("ChangePriest governance action", function () {
  const ENTRY_FEE = ethers.parseUnits("100", 18);

  it("allows members to change the priest via proposal", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, oldPriest, member1, member2, newPriest] = accounts;

    // Fund and onboard members (new priest must be a member)
    await mintToUsers(token, [member1, member2, newPriest], ENTRY_FEE * 10n);
    await joinMembers(templ, token, [member1, member2, newPriest]);

    // Sanity: initial priest is deploy-time arg
    expect(await templ.priest()).to.equal(oldPriest.address);

    // Propose change to new priest
    await templ.connect(member1).createProposalChangePriest(newPriest.address, 7 * 24 * 60 * 60);

    // Vote yes by both members
    await templ.connect(member1).vote(0, true);
    await templ.connect(member2).vote(0, true);

    // Advance time and execute
    await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine");
    await templ.executeProposal(0);

    // Priest updated
    expect(await templ.priest()).to.equal(newPriest.address);
  });

  it("reverts when changePriestDAO is called externally", async function () {
    const { templ, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, , member] = accounts;

    await expect(
      templ.connect(member).changePriestDAO(member.address)
    ).to.be.revertedWithCustomError(templ, "NotDAO");
  });
});
