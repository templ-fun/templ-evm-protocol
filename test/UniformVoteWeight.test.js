const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers } = require("./utils/mintAndPurchase");
const { encodeSetPausedDAO } = require("./utils/callDataBuilders");

describe("Uniform vote weight (no priest bonus)", function () {
  let templ;
  let token;
  let owner, priest, member1, member2;
  let accounts;
  const ENTRY_FEE = ethers.parseUnits("100", 18);
  const TOKEN_SUPPLY = ethers.parseUnits("10000", 18);

  beforeEach(async function () {
    ({ templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE }));
    [owner, priest, member1, member2] = accounts;

    await mintToUsers(token, [priest, member1, member2], TOKEN_SUPPLY);
  });

  it("returns 1 for members and 0 for non-members", async function () {
    // Before joining
    expect(await templ.getVoteWeight(priest.address)).to.equal(0);
    expect(await templ.getVoteWeight(member1.address)).to.equal(0);

    // Join
    await token.connect(priest).approve(await templ.getAddress(), ENTRY_FEE);
    await templ.connect(priest).purchaseAccess();
    await token.connect(member1).approve(await templ.getAddress(), ENTRY_FEE);
    await templ.connect(member1).purchaseAccess();

    expect(await templ.getVoteWeight(priest.address)).to.equal(1);
    expect(await templ.getVoteWeight(member1.address)).to.equal(1);
    expect(await templ.getVoteWeight(member2.address)).to.equal(0);
  });

  it("counts one vote per member and ties fail", async function () {
    await token.connect(priest).approve(await templ.getAddress(), ENTRY_FEE);
    await templ.connect(priest).purchaseAccess();
    await token.connect(member1).approve(await templ.getAddress(), ENTRY_FEE);
    await templ.connect(member1).purchaseAccess();

    const callData = encodeSetPausedDAO(true);
    await templ.connect(priest).createProposal(
      "Test Proposal",
      "No weighting",
      callData,
      7 * 24 * 60 * 60
    );

    await ethers.provider.send("evm_increaseTime", [10]);
    await ethers.provider.send("evm_mine");

    await templ.connect(priest).vote(0, true);
    await templ.connect(member1).vote(0, false);

    const proposal = await templ.getProposal(0);
    expect(proposal.yesVotes).to.equal(1);
    expect(proposal.noVotes).to.equal(1);
    expect(proposal.passed).to.be.false;
  });
});

