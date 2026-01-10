const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl, STATIC_CURVE } = require("./utils/deploy");
const { mintToUsers, joinMembers } = require("./utils/mintAndPurchase");
const { deployTemplModules } = require("./utils/modules");

const ENTRY_FEE = ethers.parseUnits("100", 18);
const TOKEN_SUPPLY = ethers.parseUnits("10000", 18);
const WEEK = 7 * 24 * 60 * 60;

describe("Instant quorum execution", function () {
  it("executes democracy proposals immediately once instant quorum is met", async function () {
    const { templ, token, accounts } = await deployTempl({
      entryFee: ENTRY_FEE,
      proposalFeeBps: 0,
      instantQuorumBps: 6_600,
      councilMode: false,
    });
    const [, , member1, member2] = accounts;
    await mintToUsers(token, [member1, member2], TOKEN_SUPPLY);
    await joinMembers(templ, token, [member1, member2]);

    const immediateBurn = ethers.getAddress("0x00000000000000000000000000000000000000ab");
    await templ.connect(member1).createProposalSetBurnAddress(immediateBurn, WEEK, "instant burn", "");
    const proposalId = (await templ.proposalCount()) - 1n;

    const proposalBefore = await templ.proposals(proposalId);
    await templ.connect(member2).vote(proposalId, true);
    const proposalAfter = await templ.proposals(proposalId);
    expect(proposalAfter.instantQuorumMet).to.equal(true);
    expect(proposalAfter.instantQuorumReachedAt).to.be.gt(0n);
    expect(proposalAfter.endTime).to.equal(proposalAfter.instantQuorumReachedAt);
    expect(proposalAfter.endTime).to.be.at.most(proposalBefore.endTime);
    expect(proposalAfter.instantQuorumReachedAt).to.be.at.least(proposalAfter.quorumReachedAt);

    await templ.connect(member2).executeProposal(proposalId);
    expect(await templ.burnAddress()).to.equal(immediateBurn);

    // Update instant quorum to 100% via governance
    await templ.connect(member1).createProposalSetInstantQuorumBps(10_000, WEEK, "raise instant quorum", "");
    const configProposalId = (await templ.proposalCount()) - 1n;
    await templ.connect(member2).vote(configProposalId, true);
    await templ.connect(member2).executeProposal(configProposalId);
    expect(await templ.instantQuorumBps()).to.equal(10_000n);

    // With instant quorum at 100%, proposals must wait for the delay again
    await templ.connect(member1).createProposalSetBurnAddress("0x00000000000000000000000000000000000000AD", WEEK, "delayed burn", "");
    const delayedProposalId = (await templ.proposalCount()) - 1n;
    await expect(templ.connect(member2).executeProposal(delayedProposalId)).to.be.revertedWithCustomError(templ, "ExecutionDelayActive");
  });

  it("keeps the instant quorum threshold fixed for existing proposals", async function () {
    const { templ, token, accounts } = await deployTempl({
      entryFee: ENTRY_FEE,
      proposalFeeBps: 0,
      instantQuorumBps: 6_600,
      councilMode: false,
    });
    const [, , member1, member2, member3] = accounts;
    await mintToUsers(token, [member1, member2, member3], TOKEN_SUPPLY);
    await joinMembers(templ, token, [member1, member2, member3]);

    const snapBurn = "0x00000000000000000000000000000000000000AE";
    await templ.connect(member1).createProposalSetBurnAddress(snapBurn, WEEK, "snap", "");
    const proposalId = (await templ.proposalCount()) - 1n;

    await templ.connect(member2).createProposalSetInstantQuorumBps(10_000, WEEK, "raise", "");
    const configId = (await templ.proposalCount()) - 1n;
    await templ.connect(member3).vote(configId, true);

    const delay = Number(await templ.postQuorumVotingPeriod());
    await ethers.provider.send("evm_increaseTime", [delay + 1]);
    await ethers.provider.send("evm_mine", []);
    await templ.executeProposal(configId);
    expect(await templ.instantQuorumBps()).to.equal(10_000n);

    await templ.connect(member2).vote(proposalId, true);
    await templ.connect(member3).vote(proposalId, true);
    await templ.executeProposal(proposalId);
    expect(await templ.burnAddress()).to.equal(snapBurn);
  });

  it("executes council proposals immediately once instant quorum is met", async function () {
    const { templ, token, accounts } = await deployTempl({
      entryFee: ENTRY_FEE,
      proposalFeeBps: 0,
      instantQuorumBps: 7_500,
      councilMode: true,
    });
    const [, priest, member1] = accounts;
    await mintToUsers(token, [member1], TOKEN_SUPPLY);
    await joinMembers(templ, token, [member1]);

    await templ.connect(member1).createProposalAddCouncilMember(member1.address, WEEK, "Add council", "");
    const addId = (await templ.proposalCount()) - 1n;
    await templ.connect(priest).vote(addId, true);
    await templ.executeProposal(addId);
    expect(await templ.councilMembers(member1.address)).to.equal(true);

    const councilBurn = ethers.getAddress("0x00000000000000000000000000000000000000ac");
    await templ.connect(member1).createProposalSetBurnAddress(councilBurn, WEEK, "council burn", "");
    const proposalId = (await templ.proposalCount()) - 1n;

    await templ.connect(priest).vote(proposalId, true);
    await templ.connect(member1).executeProposal(proposalId);
    expect(await templ.burnAddress()).to.equal(councilBurn);
  });

  it("reverts on deploy when instant quorum is below the quorum threshold", async function () {
    const [, priest, protocol] = await ethers.getSigners();
    const modules = await deployTemplModules();
    const AccessToken = await ethers.getContractFactory("contracts/mocks/TestToken.sol:TestToken");
    const accessToken = await AccessToken.deploy("Instant Access", "IA", 18);
    await accessToken.waitForDeployment();
    const Templ = await ethers.getContractFactory("TEMPL");
    await expect(
      Templ.deploy(
        priest.address,
        protocol.address,
        accessToken.target,
        ENTRY_FEE,
        3_000,
        3_000,
        3_000,
        1_000,
        6_000,
        WEEK,
        "0x000000000000000000000000000000000000dEaD",
        0,
        "Bad Instant",
        "",
        "",
        0,
        0,
        5_100,
        5_000,
        false,
        modules.membershipModule,
        modules.treasuryModule,
        modules.governanceModule,
        modules.councilModule,
        STATIC_CURVE
      )
    ).to.be.revertedWithCustomError(Templ, "InstantQuorumBelowQuorum");
  });

  it("blocks instant quorum updates below the normal quorum threshold", async function () {
    const { templ, token, accounts } = await deployTempl({
      quorumBps: 5_000,
      instantQuorumBps: 6_000,
      proposalFeeBps: 0,
    });
    const [, , member1, member2] = accounts;
    await mintToUsers(token, [member1, member2], TOKEN_SUPPLY);
    await joinMembers(templ, token, [member1, member2]);

    await templ
      .connect(member1)
      .createProposalSetInstantQuorumBps(4_000, WEEK, "lower instant quorum", "");
    const proposalId = (await templ.proposalCount()) - 1n;
    await templ.connect(member2).vote(proposalId, true);
    await expect(templ.executeProposal(proposalId)).to.be.revertedWithCustomError(
      templ,
      "InstantQuorumBelowQuorum"
    );
  });

  it("blocks quorum updates that would exceed the instant quorum threshold", async function () {
    const { templ, token, accounts } = await deployTempl({
      quorumBps: 4_000,
      instantQuorumBps: 6_000,
      proposalFeeBps: 0,
    });
    const [, , member1, member2] = accounts;
    await mintToUsers(token, [member1, member2], TOKEN_SUPPLY);
    await joinMembers(templ, token, [member1, member2]);

    await templ.connect(member1).createProposalSetQuorumBps(7_000, WEEK, "raise quorum", "");
    const proposalId = (await templ.proposalCount()) - 1n;
    await templ.connect(member2).vote(proposalId, true);
    await expect(templ.executeProposal(proposalId)).to.be.revertedWithCustomError(
      templ,
      "InstantQuorumBelowQuorum"
    );
  });
});
