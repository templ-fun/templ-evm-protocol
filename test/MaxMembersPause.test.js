const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, joinMembers } = require("./utils/mintAndPurchase");

describe("Max Members Pause Handling", function () {
  const ENTRY_FEE = ethers.parseUnits("100", 18);
  const MAX_MEMBERS = 3n;
  const VOTING_PERIOD = 7 * 24 * 60 * 60;

  let templ;
  let token;
  let accounts;
  let priest;
  let m1;
  let m2;

  const EXECUTION_DELAY = 2;

  beforeEach(async function () {
    ({ templ, token, accounts } = await deployTempl({
      entryFee: ENTRY_FEE,
      maxMembers: Number(MAX_MEMBERS),
      executionDelay: EXECUTION_DELAY,
    }));

    [, priest, m1, m2] = accounts;

    await mintToUsers(token, [m1, m2], ENTRY_FEE * 5n);
    await joinMembers(templ, token, [m1, m2]);

    expect(await templ.joinPaused()).to.equal(true);
    expect(await templ.maxMembers()).to.equal(MAX_MEMBERS);
  });

  it("retains the membership cap when unpausing after reaching the limit", async function () {
    await templ.connect(m1).createProposalSetJoinPaused(false, VOTING_PERIOD);
    await templ.connect(priest).vote(0, true);

    await ethers.provider.send("evm_increaseTime", [EXECUTION_DELAY + 1]);
    await ethers.provider.send("evm_mine", []);

    await templ.executeProposal(0);

    expect(await templ.joinPaused()).to.equal(false);
    expect(await templ.maxMembers()).to.equal(MAX_MEMBERS);
  });
});
