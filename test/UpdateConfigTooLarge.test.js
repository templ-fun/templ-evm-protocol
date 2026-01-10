const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, joinMembers } = require("./utils/mintAndPurchase");

describe("updateConfigDAO entry fee too large", function () {
  it("reverts on execution when new entry fee exceeds MAX_ENTRY_FEE", async function () {
    const { templ, token, accounts } = await deployTempl();
    const [, , proposer, voter] = accounts;
    await mintToUsers(token, [proposer, voter], ethers.parseUnits("1000000", 18));
    await joinMembers(templ, token, [proposer, voter]);

    // Construct an amount greater than 2^128-1 but divisible by 10
    const TOO_LARGE = ((1n << 128n) - 1n) + (10n - (((1n << 128n) - 1n) % 10n));

    await templ.connect(proposer).createProposalUpdateConfig(
      TOO_LARGE,
      0,
      0,
      0,
      false,
      7 * 24 * 60 * 60,
      "Update config",
      "Exceeds max entry fee"
    );
    await templ.connect(voter).vote(0, true);
    await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine", []);
    await expect(templ.executeProposal(0)).to.be.revertedWithCustomError(templ, "EntryFeeTooLarge");
  });
});
