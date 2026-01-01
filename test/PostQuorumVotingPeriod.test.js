const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, joinMembers } = require("./utils/mintAndPurchase");

const DAY = 24 * 60 * 60;
const MIN_POST_QUORUM = 60 * 60;
const MAX_POST_QUORUM = 30 * DAY;
const ENTRY_FEE = ethers.parseUnits("100", 18);

describe("Post-quorum voting period bounds", function () {
  it("rejects out-of-range DAO updates and accepts valid values", async function () {
    const { templ, priest } = await deployTempl({ entryFee: ENTRY_FEE, priestIsDictator: true });

    await expect(
      templ.connect(priest).setPostQuorumVotingPeriodDAO(MIN_POST_QUORUM - 1)
    ).to.be.revertedWithCustomError(templ, "InvalidCallData");
    await expect(
      templ.connect(priest).setPostQuorumVotingPeriodDAO(MAX_POST_QUORUM + 1)
    ).to.be.revertedWithCustomError(templ, "InvalidCallData");

    await expect(
      templ.connect(priest).setPostQuorumVotingPeriodDAO(MIN_POST_QUORUM)
    ).to.emit(templ, "PostQuorumVotingPeriodUpdated");
    expect(await templ.postQuorumVotingPeriod()).to.equal(BigInt(MIN_POST_QUORUM));
  });

  it("reverts proposals that attempt to set invalid post-quorum periods", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, , proposer, voter] = accounts;

    await mintToUsers(token, [proposer, voter], ENTRY_FEE * 3n);
    await joinMembers(templ, token, [proposer, voter], ENTRY_FEE);

    await templ
      .connect(proposer)
      .createProposalSetPostQuorumVotingPeriod(MIN_POST_QUORUM - 1, 7 * DAY, "Bad delay", "");
    const proposalId = (await templ.proposalCount()) - 1n;

    await templ.connect(voter).vote(proposalId, true);
    await ethers.provider.send("evm_increaseTime", [8 * DAY]);
    await ethers.provider.send("evm_mine", []);

    await expect(templ.executeProposal(proposalId))
      .to.be.revertedWithCustomError(templ, "InvalidCallData");
  });
});
