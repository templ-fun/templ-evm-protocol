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

    await templ.connect(member2).vote(proposalId, true);
    await expect(templ.connect(member2).executeProposal(proposalId)).to.not.be.reverted;
    expect(await templ.burnAddress()).to.equal(immediateBurn);

    // Update instant quorum to 100% via governance
    await templ.connect(member1).createProposalSetInstantQuorumBps(10_000, WEEK, "raise instant quorum", "");
    const configProposalId = (await templ.proposalCount()) - 1n;
    await templ.connect(member2).vote(configProposalId, true);
    await expect(templ.connect(member2).executeProposal(configProposalId)).to.not.be.reverted;
    expect(await templ.instantQuorumBps()).to.equal(10_000n);

    // With instant quorum at 100%, proposals must wait for the delay again
    await templ.connect(member1).createProposalSetBurnAddress("0x00000000000000000000000000000000000000AD", WEEK, "delayed burn", "");
    const delayedProposalId = (await templ.proposalCount()) - 1n;
    await expect(templ.connect(member2).executeProposal(delayedProposalId)).to.be.revertedWithCustomError(templ, "ExecutionDelayActive");
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

    await templ.connect(priest).bootstrapCouncilMember(member1.address);

    const councilBurn = ethers.getAddress("0x00000000000000000000000000000000000000ac");
    await templ.connect(member1).createProposalSetBurnAddress(councilBurn, WEEK, "council burn", "");
    const proposalId = (await templ.proposalCount()) - 1n;

    await templ.connect(priest).vote(proposalId, true);
    await expect(templ.connect(member1).executeProposal(proposalId)).to.not.be.reverted;
    expect(await templ.burnAddress()).to.equal(councilBurn);
  });

  it("allows dictatorship proposals to execute instantly when the threshold is met", async function () {
    const { templ, token, accounts } = await deployTempl({
      entryFee: ENTRY_FEE,
      proposalFeeBps: 0,
      councilMode: false,
      instantQuorumBps: 10_000,
    });
    const [, priest, member1] = accounts;
    await mintToUsers(token, [member1], TOKEN_SUPPLY);
    await joinMembers(templ, token, [member1]);

    await templ
      .connect(member1)
      .createProposalSetDictatorship(true, WEEK, "enable dictatorship", "");
    let proposalId = (await templ.proposalCount()) - 1n;
    await templ.connect(priest).vote(proposalId, true);
    await expect(templ.connect(member1).executeProposal(proposalId)).to.not.be.reverted;
    expect(await templ.priestIsDictator()).to.equal(true);

    await templ
      .connect(member1)
      .createProposalSetDictatorship(false, WEEK, "disable dictatorship", "");
    proposalId = (await templ.proposalCount()) - 1n;
    await templ.connect(priest).vote(proposalId, true);
    await expect(templ.connect(member1).executeProposal(proposalId)).to.not.be.reverted;
    expect(await templ.priestIsDictator()).to.equal(false);
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
        false,
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

  it("blocks dictatorship setters from lowering instant quorum below the normal quorum", async function () {
    const { templ, priest } = await deployTempl({
      quorumBps: 5_000,
      instantQuorumBps: 6_000,
      priestIsDictator: true,
    });
    await expect(templ.connect(priest).setInstantQuorumBpsDAO(4_000)).to.be.revertedWithCustomError(
      templ,
      "InstantQuorumBelowQuorum"
    );
  });

  it("blocks quorum updates that would exceed the instant quorum threshold", async function () {
    const { templ, priest } = await deployTempl({
      quorumBps: 4_000,
      instantQuorumBps: 6_000,
      priestIsDictator: true,
    });
    await expect(templ.connect(priest).setQuorumBpsDAO(7_000)).to.be.revertedWithCustomError(
      templ,
      "InstantQuorumBelowQuorum"
    );
  });
});
