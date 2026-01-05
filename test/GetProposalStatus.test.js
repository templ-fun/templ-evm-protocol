const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, joinMembers } = require("./utils/mintAndPurchase");

describe("getProposal passed status coverage", function () {
  const ENTRY_FEE = ethers.parseUnits("100", 18);
  const VOTING_PERIOD = 7 * 24 * 60 * 60;

  it("returns true for quorum-exempt proposals after the voting period", async function () {
    const { templ, token, priest } = await deployTempl({ entryFee: ENTRY_FEE });
    const accessToken = await templ.accessToken();

    await templ
      .connect(priest)
      .createProposalDisbandTreasury(accessToken, VOTING_PERIOD);

    await ethers.provider.send("evm_increaseTime", [VOTING_PERIOD + 1]);
    await ethers.provider.send("evm_mine", []);

    const proposal = await templ.getProposal(0);
    expect(proposal.passed).to.equal(true);
  });

  it("requires quorum for council member disbands when council mode is disabled", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE, councilMode: false });
    const [, , member1, member2, member3] = accounts;
    const accessToken = await templ.accessToken();

    await mintToUsers(token, [member1, member2, member3], ENTRY_FEE * 5n);
    await joinMembers(templ, token, [member1, member2, member3]);

    await templ.connect(member1).createProposalAddCouncilMember(member1.address, VOTING_PERIOD, "Add council", "");
    let proposalId = (await templ.proposalCount()) - 1n;
    await templ.connect(member2).vote(proposalId, true);
    const delay = Number(await templ.postQuorumVotingPeriod());
    await ethers.provider.send("evm_increaseTime", [delay + 1]);
    await ethers.provider.send("evm_mine", []);
    await templ.executeProposal(proposalId);

    await templ.connect(member1).createProposalDisbandTreasury(accessToken, VOTING_PERIOD);
    proposalId = (await templ.proposalCount()) - 1n;
    const disbandProposal = await templ.proposals(proposalId);
    expect(disbandProposal.quorumExempt).to.equal(false);

    await ethers.provider.send("evm_increaseTime", [VOTING_PERIOD + 1]);
    await ethers.provider.send("evm_mine", []);

    const proposal = await templ.getProposal(proposalId);
    expect(proposal.passed).to.equal(false);
    const snapshots = await templ.getProposalSnapshots(proposalId);
    expect(snapshots[5]).to.equal(0n);
  });

  it("treats council disbands as quorum-exempt when council mode is enabled", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE, councilMode: true });
    const [, priest, member1, member2] = accounts;
    const accessToken = await templ.accessToken();

    await mintToUsers(token, [member1, member2], ENTRY_FEE * 5n);
    await joinMembers(templ, token, [member1, member2]);

    await templ.connect(member1).createProposalAddCouncilMember(member1.address, VOTING_PERIOD, "Add council", "");
    let proposalId = (await templ.proposalCount()) - 1n;
    await templ.connect(priest).vote(proposalId, true);
    const delay = Number(await templ.postQuorumVotingPeriod());
    await ethers.provider.send("evm_increaseTime", [delay + 1]);
    await ethers.provider.send("evm_mine", []);
    await templ.executeProposal(proposalId);

    await templ.connect(member1).createProposalDisbandTreasury(accessToken, VOTING_PERIOD);
    proposalId = (await templ.proposalCount()) - 1n;
    const disbandProposal = await templ.proposals(proposalId);
    expect(disbandProposal.quorumExempt).to.equal(true);

    await ethers.provider.send("evm_increaseTime", [VOTING_PERIOD + 1]);
    await ethers.provider.send("evm_mine", []);

    const proposal = await templ.getProposal(proposalId);
    expect(proposal.passed).to.equal(true);
  });

  it("returns false whenever quorum has not been reached", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, , m1, m2, m3, m4] = accounts;

    await mintToUsers(token, [m1, m2, m3, m4], ENTRY_FEE * 5n);
    await joinMembers(templ, token, [m1, m2, m3, m4]);

    await templ
      .connect(m1)
      .createProposalSetJoinPaused(false, VOTING_PERIOD);

    const proposal = await templ.getProposal(0);
    expect(proposal.passed).to.equal(false);
  });

  it("returns true once quorum delay has elapsed", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, , m1, m2] = accounts;

    await mintToUsers(token, [m1, m2], ENTRY_FEE * 5n);
    await joinMembers(templ, token, [m1, m2]);

    await templ
      .connect(m1)
      .createProposalSetJoinPaused(false, VOTING_PERIOD);
    await templ.connect(m2).vote(0, true);

  const delay = Number(await templ.postQuorumVotingPeriod());
    await ethers.provider.send("evm_increaseTime", [delay + 1]);
    await ethers.provider.send("evm_mine", []);

    const proposal = await templ.getProposal(0);
    expect(proposal.passed).to.equal(true);
  });
});
