const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, joinMembers } = require("./utils/mintAndPurchase");

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
    await joinMembers(templ, token, [
      member,
      secondMember,
      thirdMember,
      fourthMember
    ]);

    await expect(
      templ.connect(outsider).createProposalSetJoinPaused(true, VOTING_PERIOD)
    ).to.be.revertedWithCustomError(templ, "NotMember");

    await expect(
      templ
        .connect(outsider)
      .createProposalUpdateConfig(
        ethers.ZeroAddress,
        0,
        0,
        0,
        0,
        false,
        VOTING_PERIOD
      )
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
    await templ.connect(member).createProposalSetJoinPaused(false, VOTING_PERIOD);
    await expect(
      templ.connect(member).createProposalSetJoinPaused(true, VOTING_PERIOD)
    ).to.be.revertedWithCustomError(templ, "ActiveProposalExists");

    await templ
      .connect(secondMember)
      .createProposalUpdateConfig(
        ethers.ZeroAddress,
        0,
        0,
        0,
        0,
        false,
        VOTING_PERIOD
      );

    const createdAfterUpdate = (await templ.proposalCount()) - 1n;
    const stored = await templ.proposals(createdAfterUpdate);
    expect(stored.newEntryFee).to.equal(0n);
    expect(stored.updateFeeSplit).to.equal(false);

    await templ
      .connect(thirdMember)
      .createProposalUpdateConfig(
        ethers.ZeroAddress,
        0,
        2000,
        2000,
        5000,
        true,
        VOTING_PERIOD
      );

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

  it("allows governance to set member limits", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, , memberA, memberB, memberC, outsider] = accounts;

    await mintToUsers(token, [memberA, memberB, memberC], ENTRY_FEE * 5n);
    await joinMembers(templ, token, [memberA, memberB]);

    await expect(
      templ.connect(outsider).createProposalSetMaxMembers(4, VOTING_PERIOD)
    ).to.be.revertedWithCustomError(templ, "NotMember");

    await expect(
      templ.connect(memberA).createProposalSetMaxMembers(1, VOTING_PERIOD)
    ).to.be.revertedWithCustomError(templ, "MemberLimitTooLow");

    await templ.connect(memberA).createProposalSetMaxMembers(4, VOTING_PERIOD);
    const proposalId = (await templ.proposalCount()) - 1n;

    await templ.connect(memberB).vote(proposalId, true);
    const delay = Number(await templ.executionDelayAfterQuorum());
    await ethers.provider.send("evm_increaseTime", [delay + 1]);
    await ethers.provider.send("evm_mine", []);

    await templ.executeProposal(proposalId);
    expect(await templ.MAX_MEMBERS()).to.equal(4n);

    await joinMembers(templ, token, [memberC]);
    expect(await templ.totalJoins()).to.equal(3n);
    expect(await templ.joinPaused()).to.equal(true);
  });

  it("allows governance to update templ metadata", async function () {
    const initialMeta = {
      name: "Genesis Templ",
      description: "Initial description",
      logo: "https://start.templ/logo.png"
    };
    const updatedMeta = {
      name: "Upgraded Templ",
      description: "New mission and vibe",
      logo: "https://new.templ/logo.png"
    };
    const { templ, token, accounts } = await deployTempl({
      entryFee: ENTRY_FEE,
      name: initialMeta.name,
      description: initialMeta.description,
      logoLink: initialMeta.logo
    });
    const [, , memberA, memberB] = accounts;

    await mintToUsers(token, [memberA, memberB], ENTRY_FEE * 4n);
    await joinMembers(templ, token, [memberA, memberB]);

    expect(await templ.templName()).to.equal(initialMeta.name);
    expect(await templ.templDescription()).to.equal(initialMeta.description);
    expect(await templ.templLogoLink()).to.equal(initialMeta.logo);

    await templ
      .connect(memberA)
      .createProposalUpdateMetadata(
        updatedMeta.name,
        updatedMeta.description,
        updatedMeta.logo,
        VOTING_PERIOD,
        "Update metadata",
        "Set new templ metadata"
      );
    const proposalId = (await templ.proposalCount()) - 1n;

    await templ.connect(memberB).vote(proposalId, true);
    const delay = Number(await templ.executionDelayAfterQuorum());
    await ethers.provider.send("evm_increaseTime", [delay + 1]);
    await ethers.provider.send("evm_mine", []);

    await templ.executeProposal(proposalId);
    expect(await templ.templName()).to.equal(updatedMeta.name);
    expect(await templ.templDescription()).to.equal(updatedMeta.description);
    expect(await templ.templLogoLink()).to.equal(updatedMeta.logo);
  });

  it("configures proposal fees and referral shares via governance", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, , memberA, memberB] = accounts;

    await mintToUsers(token, [memberA, memberB], ENTRY_FEE * 6n);
    await joinMembers(templ, token, [memberA, memberB]);

    await token.connect(memberA).approve(await templ.getAddress(), ENTRY_FEE * 10n);

    await templ
      .connect(memberA)
      .createProposalSetProposalFeeBps(500, VOTING_PERIOD, "Set proposal fee", "Increase proposal cost");
    const proposalFeeId = (await templ.proposalCount()) - 1n;
    await templ.connect(memberB).vote(proposalFeeId, true);
    const delay = Number(await templ.executionDelayAfterQuorum());
    await ethers.provider.send("evm_increaseTime", [delay + 1]);
    await ethers.provider.send("evm_mine", []);
    await templ.executeProposal(proposalFeeId);
    expect(await templ.proposalCreationFeeBps()).to.equal(500n);

    await templ
      .connect(memberA)
      .createProposalSetReferralShareBps(1_500, VOTING_PERIOD, "Set referral", "Enable referrals");
    const referralProposalId = (await templ.proposalCount()) - 1n;
    await templ.connect(memberB).vote(referralProposalId, true);
    await ethers.provider.send("evm_increaseTime", [delay + 1]);
    await ethers.provider.send("evm_mine", []);
    await templ.executeProposal(referralProposalId);
    expect(await templ.referralShareBps()).to.equal(1_500n);
  });

  it("clears active proposals once earlier windows expire", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, , member] = accounts;

    await mintToUsers(token, [member], ENTRY_FEE * 3n);
    await joinMembers(templ, token, [member]);

    await templ.connect(member).createProposalSetJoinPaused(false, VOTING_PERIOD);
    const firstId = await templ.activeProposalId(member.address);
    expect(firstId).to.equal(0n);

    await ethers.provider.send("evm_increaseTime", [VOTING_PERIOD + DAY]);
    await ethers.provider.send("evm_mine", []);

    await templ
      .connect(member)
      .createProposalUpdateConfig(
        ethers.ZeroAddress,
        0,
        0,
        0,
        0,
        false,
        VOTING_PERIOD
      );
    const secondId = await templ.activeProposalId(member.address);
    expect(secondId).to.equal(1n);
  });

  it("covers vote transitions including re-votes and quorum changes", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, priest, memberA, memberB, memberC, lateJoiner] = accounts;

    await mintToUsers(token, [priest, memberA, memberB, memberC, lateJoiner], ENTRY_FEE * 5n);
    await joinMembers(templ, token, [memberA, memberB, memberC]);

    await templ.connect(memberA).createProposalSetJoinPaused(true, VOTING_PERIOD);

    await templ.connect(memberB).vote(0, false);
    await templ.connect(memberC).vote(0, true);
    await templ.connect(memberC).vote(0, true);
    await templ.connect(memberC).vote(0, false);
    await templ.connect(memberC).vote(0, true);

    await joinMembers(templ, token, [lateJoiner]);
    await expect(templ.connect(lateJoiner).vote(0, true)).to.be.revertedWithCustomError(
      templ,
      "JoinedAfterProposal"
    );
  });

  it("blocks executing quorum-exempt proposals before the timer elapses", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, priest, voter] = accounts;

    await mintToUsers(token, [priest, voter], ENTRY_FEE * 4n);
    await joinMembers(templ, token, [voter]);

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
    await joinMembers(templ, token, [voter]);

    await templ
      .connect(priest)
      .createProposalDisbandTreasury(await token.getAddress(), VOTING_PERIOD);

    await ethers.provider.send("evm_increaseTime", [VOTING_PERIOD + 1]);
    await ethers.provider.send("evm_mine", []);

    await templ.connect(priest).createProposalSetJoinPaused(false, VOTING_PERIOD);

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
    await joinMembers(templ, token, [member]);

    await templ.connect(member).createProposalSetJoinPaused(false, VOTING_PERIOD);

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
    await joinMembers(templ, token, [member, voter]);

    await templ.connect(member).createProposalSetJoinPaused(false, VOTING_PERIOD);
    await templ.connect(voter).vote(0, true);
    const delay = Number(await templ.executionDelayAfterQuorum());
    await ethers.provider.send("evm_increaseTime", [delay + 1]);
    await ethers.provider.send("evm_mine", []);
    await templ.executeProposal(0);

    const paged = await templ.getActiveProposalsPaginated(0, 1);
    expect(paged.hasMore).to.equal(false);
  });

  it("reverts voting when the proposal id does not exist", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, , member] = accounts;

    await mintToUsers(token, [member], ENTRY_FEE * 2n);
    await joinMembers(templ, token, [member]);

    await expect(templ.connect(member).vote(5, true)).to.be.revertedWithCustomError(
      templ,
      "InvalidProposal"
    );
  });

  it("reverts proposal snapshot lookups for invalid ids", async function () {
    const { templ } = await deployTempl({ entryFee: ENTRY_FEE });
    await expect(templ.getProposalSnapshots(1)).to.be.revertedWithCustomError(
      templ,
      "InvalidProposal"
    );
  });
});
