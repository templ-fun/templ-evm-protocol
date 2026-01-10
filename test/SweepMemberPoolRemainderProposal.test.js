const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, joinMembers } = require("./utils/mintAndPurchase");

describe("Sweep member pool remainder proposal", function () {
  const ENTRY_FEE = 1010n;
  const VOTING_PERIOD = 7 * 24 * 60 * 60;
  const EXEC_DELAY = 60 * 60;

  it("executes a sweep via governance action", async function () {
    const { templ, token, accounts } = await deployTempl({
      entryFee: ENTRY_FEE,
      executionDelay: EXEC_DELAY,
    });
    const [, , member1, member2, recipient] = accounts;

    await mintToUsers(token, [member1, member2], ENTRY_FEE * 10n);
    await joinMembers(templ, token, [member1, member2]);

    const remainder = await templ.memberRewardRemainder();
    expect(remainder).to.be.gt(0n);

    await templ
      .connect(member1)
      .createProposalSweepMemberPoolRemainder(
        recipient.address,
        VOTING_PERIOD,
        "Sweep remainder",
        "Flush rounding dust"
      );

    const proposalId = (await templ.proposalCount()) - 1n;
    const delay = Number(await templ.postQuorumVotingPeriod());
    await ethers.provider.send("evm_increaseTime", [delay + 1]);
    await ethers.provider.send("evm_mine", []);

    const recipientBefore = await token.balanceOf(recipient.address);
    await expect(templ.executeProposal(proposalId))
      .to.emit(templ, "MemberPoolRemainderSwept")
      .withArgs(recipient.address, remainder);
    expect(await token.balanceOf(recipient.address)).to.equal(recipientBefore + remainder);
  });

  it("reverts when no remainder exists", async function () {
    const entryFee = 1000n;
    const { templ, token, accounts } = await deployTempl({
      entryFee,
      executionDelay: EXEC_DELAY,
    });
    const [, , member1, member2, recipient] = accounts;

    await mintToUsers(token, [member1, member2], entryFee * 10n);
    await joinMembers(templ, token, [member1, member2]);

    expect(await templ.memberRewardRemainder()).to.equal(0n);

    await templ
      .connect(member1)
      .createProposalSweepMemberPoolRemainder(
        recipient.address,
        VOTING_PERIOD,
        "Sweep remainder",
        "No remainder"
      );

    const proposalId = (await templ.proposalCount()) - 1n;
    const delay = Number(await templ.postQuorumVotingPeriod());
    await ethers.provider.send("evm_increaseTime", [delay + 1]);
    await ethers.provider.send("evm_mine", []);

    await expect(templ.executeProposal(proposalId))
      .to.be.revertedWithCustomError(templ, "NoRewardsToClaim");
  });
});
