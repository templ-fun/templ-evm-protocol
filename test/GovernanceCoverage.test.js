const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, purchaseAccess } = require("./utils/mintAndPurchase");

const DAY = 24 * 60 * 60;
const VOTING_PERIOD = 7 * DAY;
const ENTRY_FEE = ethers.parseUnits("100", 18);

describe("Governance coverage gaps", function () {
  it("enforces membership and handles proposal parameter branches", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, priest, member, secondMember, thirdMember, fourthMember, outsider] = accounts;

    await mintToUsers(
      token,
      [priest, member, secondMember, thirdMember, fourthMember],
      ENTRY_FEE * 4n
    );
    await purchaseAccess(templ, token, [
      priest,
      member,
      secondMember,
      thirdMember,
      fourthMember
    ]);

    await expect(
      templ.connect(outsider).createProposalSetPaused(true, VOTING_PERIOD)
    ).to.be.revertedWithCustomError(templ, "NotMember");

    await expect(
      templ
        .connect(outsider)
        .createProposalUpdateConfig(0, 0, 0, 0, false, VOTING_PERIOD)
    ).to.be.revertedWithCustomError(templ, "NotMember");

    await expect(
      templ
        .connect(outsider)
        .createProposalWithdrawTreasury(
          await token.getAddress(),
          outsider.address,
          1n,
          "test",
          VOTING_PERIOD
        )
    ).to.be.revertedWithCustomError(templ, "NotMember");

    await expect(
      templ
        .connect(outsider)
        .createProposalDisbandTreasury(await token.getAddress(), VOTING_PERIOD)
    ).to.be.revertedWithCustomError(templ, "NotMember");

    await expect(
      templ
        .connect(outsider)
        .createProposalChangePriest(member.address, VOTING_PERIOD)
    ).to.be.revertedWithCustomError(templ, "NotMember");

    await templ
      .connect(priest)
      .createProposalDisbandTreasury(await token.getAddress(), VOTING_PERIOD);
    const priestId = (await templ.proposalCount()) - 1n;
    const priestProposal = await templ.proposals(priestId);
    expect(priestProposal.quorumExempt).to.equal(true);

    // Successful creation with zero entry fee and updateFeeSplit false exercises the skipped branches
    await templ.connect(member).createProposalSetPaused(false, VOTING_PERIOD);
    await expect(
      templ.connect(member).createProposalSetPaused(true, VOTING_PERIOD)
    ).to.be.revertedWithCustomError(templ, "ActiveProposalExists");

    await templ
      .connect(secondMember)
      .createProposalUpdateConfig(0, 0, 0, 0, false, VOTING_PERIOD);

    const createdAfterUpdate = (await templ.proposalCount()) - 1n;
    const stored = await templ.proposals(createdAfterUpdate);
    expect(stored.newEntryFee).to.equal(0n);
    expect(stored.updateFeeSplit).to.equal(false);

    await templ
      .connect(thirdMember)
      .createProposalUpdateConfig(0, 20, 20, 50, true, VOTING_PERIOD);

    await templ
      .connect(fourthMember)
      .createProposalDisbandTreasury(await token.getAddress(), VOTING_PERIOD);
    const disbandId = (await templ.proposalCount()) - 1n;
    const disbandProposal = await templ.proposals(disbandId);
    expect(disbandProposal.quorumExempt).to.equal(false);

    await expect(
      templ
        .connect(member)
        .createProposalChangePriest(ethers.ZeroAddress, VOTING_PERIOD)
    ).to.be.revertedWithCustomError(templ, "InvalidRecipient");
  });

  it("clears active proposals once earlier windows expire", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, , member] = accounts;

    await mintToUsers(token, [member], ENTRY_FEE * 3n);
    await purchaseAccess(templ, token, [member]);

    await templ.connect(member).createProposalSetPaused(false, VOTING_PERIOD);
    const firstId = await templ.activeProposalId(member.address);
    expect(firstId).to.equal(0n);

    await ethers.provider.send("evm_increaseTime", [VOTING_PERIOD + DAY]);
    await ethers.provider.send("evm_mine", []);

    await templ
      .connect(member)
      .createProposalUpdateConfig(0, 0, 0, 0, false, VOTING_PERIOD);
    const secondId = await templ.activeProposalId(member.address);
    expect(secondId).to.equal(1n);
  });

  it("covers vote transitions including re-votes and quorum changes", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, priest, memberA, memberB, memberC, lateJoiner] = accounts;

    await mintToUsers(token, [priest, memberA, memberB, memberC, lateJoiner], ENTRY_FEE * 5n);
    await purchaseAccess(templ, token, [priest, memberA, memberB, memberC]);

    await templ.connect(memberA).createProposalSetPaused(true, VOTING_PERIOD);

    await templ.connect(memberB).vote(0, false);
    await templ.connect(memberC).vote(0, true);
    await templ.connect(memberC).vote(0, true);
    await templ.connect(memberC).vote(0, false);
    await templ.connect(memberC).vote(0, true);

    await purchaseAccess(templ, token, [lateJoiner]);
    await expect(templ.connect(lateJoiner).vote(0, true)).to.be.revertedWithCustomError(
      templ,
      "JoinedAfterProposal"
    );
  });

  it("blocks executing quorum-exempt proposals before the timer elapses", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, priest, voter] = accounts;

    await mintToUsers(token, [priest, voter], ENTRY_FEE * 4n);
    await purchaseAccess(templ, token, [priest, voter]);

    await templ
      .connect(priest)
      .createProposalDisbandTreasury(await token.getAddress(), VOTING_PERIOD);

    await expect(templ.executeProposal(0)).to.be.revertedWithCustomError(
      templ,
      "VotingNotEnded"
    );

    await ethers.provider.send("evm_increaseTime", [VOTING_PERIOD + DAY]);
    await ethers.provider.send("evm_mine", []);

    await templ.executeProposal(0);
  });

  it("exercises proposal cleanup and view edge cases", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, priest, voter] = accounts;

    await mintToUsers(token, [priest, voter], ENTRY_FEE * 4n);
    await purchaseAccess(templ, token, [priest, voter]);

    await templ
      .connect(priest)
      .createProposalDisbandTreasury(await token.getAddress(), VOTING_PERIOD);

    await ethers.provider.send("evm_increaseTime", [VOTING_PERIOD + 1]);
    await ethers.provider.send("evm_mine", []);

    await templ.connect(priest).createProposalSetPaused(false, VOTING_PERIOD);

    await templ.executeProposal(0);
    expect(await templ.hasActiveProposal(priest.address)).to.equal(true);

    await templ.connect(voter).vote(1, true);
    const delay = Number(await templ.executionDelayAfterQuorum());
    await ethers.provider.send("evm_increaseTime", [delay + 1]);
    await ethers.provider.send("evm_mine", []);
    await templ.executeProposal(1);
    expect(await templ.hasActiveProposal(priest.address)).to.equal(false);

    await expect(templ.getProposal(999n)).to.be.revertedWithCustomError(
      templ,
      "InvalidProposal"
    );
    await expect(
      templ.hasVoted(999n, priest.address)
    ).to.be.revertedWithCustomError(templ, "InvalidProposal");

    const active = await templ.getActiveProposals();
    expect(active.length).to.equal(0);

    const paged = await templ.getActiveProposalsPaginated(5, 10);
    expect(paged.proposalIds.length).to.equal(0);
    expect(paged.hasMore).to.equal(false);
  });

  it("rejects pagination requests with invalid limits", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, , member] = accounts;

    await mintToUsers(token, [member], ENTRY_FEE * 2n);
    await purchaseAccess(templ, token, [member]);

    await templ.connect(member).createProposalSetPaused(false, VOTING_PERIOD);

    await expect(templ.getActiveProposalsPaginated(0, 0)).to.be.revertedWithCustomError(
      templ,
      "LimitOutOfRange"
    );

    await expect(templ.getActiveProposalsPaginated(0, 101)).to.be.revertedWithCustomError(
      templ,
      "LimitOutOfRange"
    );
  });

  it("reports hasMore as false when remaining proposals are inactive", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, , member, voter] = accounts;

    await mintToUsers(token, [member, voter], ENTRY_FEE * 4n);
    await purchaseAccess(templ, token, [member, voter]);

    await templ.connect(member).createProposalSetPaused(false, VOTING_PERIOD);
    await templ.connect(voter).vote(0, true);
    const delay = Number(await templ.executionDelayAfterQuorum());
    await ethers.provider.send("evm_increaseTime", [delay + 1]);
    await ethers.provider.send("evm_mine", []);
    await templ.executeProposal(0);

    const paged = await templ.getActiveProposalsPaginated(0, 1);
    expect(paged.hasMore).to.equal(false);
  });
});
