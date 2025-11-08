const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, joinMembers } = require("./utils/mintAndPurchase");

describe("Treasury ETH insufficient balance reverts", function () {
  const ENTRY_FEE = ethers.parseUnits("100", 18);
  const DAY = 24 * 60 * 60;
  const VOTING_PERIOD = 7 * DAY;

  it("withdraw ETH with zero balance reverts InsufficientTreasuryBalance", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, , member, voter] = accounts;
    await mintToUsers(token, [member, voter], ENTRY_FEE * 3n);
    await joinMembers(templ, token, [member, voter]);

    await templ.connect(member).createProposalWithdrawTreasury(
      ethers.ZeroAddress,
      member.address,
      1n,
      VOTING_PERIOD
    );
    await templ.connect(voter).vote(0, true);
    await ethers.provider.send("evm_increaseTime", [VOTING_PERIOD + DAY]);
    await ethers.provider.send("evm_mine", []);

    await expect(templ.executeProposal(0)).to.be.revertedWithCustomError(
      templ,
      "InsufficientTreasuryBalance"
    );
  });
});
