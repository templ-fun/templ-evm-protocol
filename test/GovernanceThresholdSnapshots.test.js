const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, joinMembers } = require("./utils/mintAndPurchase");

describe("Governance threshold snapshots", function () {
  const ENTRY_FEE = ethers.parseUnits("100", 18);
  const LONG_VOTING_PERIOD = 20 * 24 * 60 * 60;
  const WEEK = 7 * 24 * 60 * 60;

  it("keeps quorum threshold fixed for existing proposals", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, , member1, member2, member3] = accounts;

    await mintToUsers(token, [member1, member2, member3], ENTRY_FEE * 5n);
    await joinMembers(templ, token, [member1, member2, member3]);

    const originalQuorum = await templ.quorumBps();
    const burnAddressA = "0x00000000000000000000000000000000000000c2";
    await templ
      .connect(member1)
      .createProposalSetBurnAddress(burnAddressA, LONG_VOTING_PERIOD, "burn", "");
    const proposalId = (await templ.proposalCount()) - 1n;
    const proposalSnapshot = await templ.proposals(proposalId);
    expect(proposalSnapshot.quorumBpsSnapshot).to.equal(originalQuorum);

    await templ.connect(member2).createProposalSetQuorumBps(9_000, WEEK, "raise quorum", "");
    const configId = (await templ.proposalCount()) - 1n;
    await templ.connect(member3).vote(configId, true);

    const delay = Number(await templ.postQuorumVotingPeriod());
    await ethers.provider.send("evm_increaseTime", [delay + 1]);
    await ethers.provider.send("evm_mine", []);
    await templ.executeProposal(configId);
    expect(await templ.quorumBps()).to.equal(9_000n);
    expect(proposalSnapshot.quorumBpsSnapshot).to.not.equal(await templ.quorumBps());

    await templ.connect(member2).vote(proposalId, true);
    const wouldFailUnderNewQuorum =
      2n * 10_000n < 9_000n * proposalSnapshot.eligibleVoters;
    expect(wouldFailUnderNewQuorum).to.equal(true);

    await ethers.provider.send("evm_increaseTime", [delay + 1]);
    await ethers.provider.send("evm_mine", []);
    await templ.executeProposal(proposalId);
    expect(await templ.burnAddress()).to.equal(burnAddressA);
  });

  it("keeps YES vote threshold fixed for existing proposals", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, , member1, member2, member3] = accounts;

    await mintToUsers(token, [member1, member2, member3], ENTRY_FEE * 5n);
    await joinMembers(templ, token, [member1, member2, member3]);

    const originalYesThreshold = await templ.yesVoteThresholdBps();
    const burnAddressB = "0x00000000000000000000000000000000000000c3";
    await templ
      .connect(member1)
      .createProposalSetBurnAddress(burnAddressB, LONG_VOTING_PERIOD, "burn", "");
    const proposalId = (await templ.proposalCount()) - 1n;
    const proposalSnapshot = await templ.proposals(proposalId);
    expect(proposalSnapshot.yesVoteThresholdBpsSnapshot).to.equal(originalYesThreshold);

    await templ.connect(member2).createProposalSetYesVoteThreshold(9_000, WEEK, "raise yes", "");
    const configId = (await templ.proposalCount()) - 1n;
    await templ.connect(member3).vote(configId, true);

    const delay = Number(await templ.postQuorumVotingPeriod());
    await ethers.provider.send("evm_increaseTime", [delay + 1]);
    await ethers.provider.send("evm_mine", []);
    await templ.executeProposal(configId);
    expect(await templ.yesVoteThresholdBps()).to.equal(9_000n);
    expect(proposalSnapshot.yesVoteThresholdBpsSnapshot).to.not.equal(await templ.yesVoteThresholdBps());

    await templ.connect(member2).vote(proposalId, true);
    await templ.connect(member3).vote(proposalId, false);
    const updatedProposal = await templ.proposals(proposalId);
    const totalVotes = updatedProposal.yesVotes + updatedProposal.noVotes;
    const wouldFailUnderNewThreshold =
      updatedProposal.yesVotes * 10_000n < 9_000n * totalVotes;
    expect(wouldFailUnderNewThreshold).to.equal(true);

    await ethers.provider.send("evm_increaseTime", [delay + 1]);
    await ethers.provider.send("evm_mine", []);
    await templ.executeProposal(proposalId);
    expect(await templ.burnAddress()).to.equal(ethers.getAddress(burnAddressB));
  });
});
