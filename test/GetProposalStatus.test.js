const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, purchaseAccess } = require("./utils/mintAndPurchase");

describe("getProposal passed status coverage", function () {
  const ENTRY_FEE = ethers.parseUnits("100", 18);
  const VOTING_PERIOD = 7 * 24 * 60 * 60;

  it("returns true for quorum-exempt proposals after the voting period", async function () {
    const { templ, token, priest } = await deployTempl({ entryFee: ENTRY_FEE });
    const accessToken = await templ.accessToken();

    await mintToUsers(token, [priest], ENTRY_FEE * 2n);
    await purchaseAccess(templ, token, [priest]);

    await templ
      .connect(priest)
      .createProposalDisbandTreasury(accessToken, VOTING_PERIOD);

    await ethers.provider.send("evm_increaseTime", [VOTING_PERIOD + 1]);
    await ethers.provider.send("evm_mine", []);

    const proposal = await templ.getProposal(0);
    expect(proposal.passed).to.equal(true);
  });

  it("returns false whenever quorum has not been reached", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, , m1, m2, m3, m4] = accounts;

    await mintToUsers(token, [m1, m2, m3, m4], ENTRY_FEE * 5n);
    await purchaseAccess(templ, token, [m1, m2, m3, m4]);

    await templ
      .connect(m1)
      .createProposalSetPaused(false, VOTING_PERIOD);

    const proposal = await templ.getProposal(0);
    expect(proposal.passed).to.equal(false);
  });

  it("returns true once quorum delay has elapsed", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, , m1, m2] = accounts;

    await mintToUsers(token, [m1, m2], ENTRY_FEE * 5n);
    await purchaseAccess(templ, token, [m1, m2]);

    await templ
      .connect(m1)
      .createProposalSetPaused(false, VOTING_PERIOD);
    await templ.connect(m2).vote(0, true);

    const delay = Number(await templ.executionDelayAfterQuorum());
    await ethers.provider.send("evm_increaseTime", [delay + 1]);
    await ethers.provider.send("evm_mine", []);

    const proposal = await templ.getProposal(0);
    expect(proposal.passed).to.equal(true);
  });
});
