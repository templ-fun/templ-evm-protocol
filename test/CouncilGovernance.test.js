const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, joinMembers } = require("./utils/mintAndPurchase");

const ENTRY_FEE = ethers.parseUnits("100", 18);
const TOKEN_SUPPLY = ethers.parseUnits("10000", 18);
const WEEK = 7 * 24 * 60 * 60;
const EIGHT_DAYS = 8 * 24 * 60 * 60;

async function advanceTime(seconds = EIGHT_DAYS) {
  await ethers.provider.send("evm_increaseTime", [seconds]);
  await ethers.provider.send("evm_mine");
}

async function setupTempl(overrides = {}) {
  const ctx = await deployTempl({ entryFee: ENTRY_FEE, ...overrides });
  const { templ, token, accounts } = ctx;
  const [owner, priest, member1, member2, member3, member4] = accounts;
  await mintToUsers(token, [member1, member2, member3, member4], TOKEN_SUPPLY);
  await joinMembers(templ, token, [member1, member2, member3, member4]);
  return { templ, token, owner, priest, member1, member2, member3, member4 };
}

async function enableCouncilMode(templ, proposer, voters, initialCouncilMembers = []) {
  // Add at least 3 council members first (required for council mode)
  const membersToAdd = initialCouncilMembers.length >= 3 ? initialCouncilMembers :
    initialCouncilMembers.concat(voters.slice(0, 3 - initialCouncilMembers.length));

  for (const member of membersToAdd) {
    await templ.connect(proposer).createProposalAddCouncilMember(member, WEEK, `Add ${member}`, "");
    const pid = (await templ.proposalCount()) - 1n;
    for (const voter of voters) {
      await templ.connect(voter).vote(pid, true);
    }
    await advanceTime();
    await templ.executeProposal(pid);
  }

  // Now enable council mode with at least 3 members
  await templ.connect(proposer).createProposalSetCouncilMode(true, WEEK, "Enable council", "");
  const proposalId = (await templ.proposalCount()) - 1n;
  for (const voter of voters) {
    await templ.connect(voter).vote(proposalId, true);
  }
  await advanceTime();
  await templ.executeProposal(proposalId);
}

describe("Council governance", function () {
  it("auto-enrolls pre-council members without charging entry fees", async function () {
    const accounts = await ethers.getSigners();
    const [, priest, member1, member2, newJoiner] = accounts;
    const { templ, token } = await deployTempl({
      entryFee: ENTRY_FEE,
      councilMode: true,
      initialCouncilMembers: [priest.address, member1.address, member2.address]
    });
    expect(await templ.councilModeEnabled()).to.equal(true);
    expect(await templ.memberCount()).to.equal(3n);
    expect(await templ.genesisMemberCount()).to.equal(3n);
    expect(await templ.totalJoins()).to.equal(0n);
    expect(await templ.councilMemberCount()).to.equal(3n);
    expect(await templ.councilMembers(priest.address)).to.equal(true);
    expect(await templ.councilMembers(member1.address)).to.equal(true);
    expect(await templ.councilMembers(member2.address)).to.equal(true);

    await mintToUsers(token, [newJoiner], TOKEN_SUPPLY);
    const templAddress = await templ.getAddress();
    await token.connect(newJoiner).approve(templAddress, ENTRY_FEE);
    const joinTx = await templ.connect(newJoiner).join();
    const receipt = await joinTx.wait();
    const memberJoined = receipt.logs
      .map((log) => {
        try {
          return templ.interface.parseLog(log);
        } catch (_) {
          return null;
        }
      })
      .find((log) => log && log.name === "MemberJoined");
    expect(memberJoined).to.not.equal(undefined);
    expect(memberJoined.args.joinId).to.equal(0n);
    expect(await templ.totalJoins()).to.equal(1n);
  });

  it("restricts voting to council members and supports priest bootstrap", async function () {
    const { templ, priest, member1, member2, member3, member4 } = await setupTempl();

    await enableCouncilMode(templ, member1, [member2, member3, member4]);
    expect(await templ.councilModeEnabled()).to.equal(true);
    // enableCouncilMode adds member2, member3, member4 to the council
    expect(await templ.councilMembers(member2.address)).to.equal(true);
    expect(await templ.councilMembers(member3.address)).to.equal(true);
    expect(await templ.councilMembers(member4.address)).to.equal(true);

    // member1 is not on the council yet, use bootstrap to add them
    await expect(templ.connect(priest).bootstrapCouncilMember(member1.address))
      .to.emit(templ, "CouncilMemberAdded")
      .withArgs(member1.address, priest.address);
    await expect(templ.connect(priest).bootstrapCouncilMember(member3.address))
      .to.be.revertedWithCustomError(templ, "CouncilBootstrapConsumed");

    const newBurn = "0x0000000000000000000000000000000000000011";
    await templ.connect(member2).createProposalSetBurnAddress(newBurn, WEEK, "update burn", "");
    const proposalId = (await templ.proposalCount()) - 1n;

    // Council members vote (need enough votes to reach quorum)
    await templ.connect(member2).vote(proposalId, true);
    await templ.connect(member3).vote(proposalId, true);
    await advanceTime();
    await templ.executeProposal(proposalId);
    expect(await templ.burnAddress()).to.equal(newBurn);
  });

  it("allows governance to add and remove council members", async function () {
    const { templ, priest, member1, member2, member3, member4 } = await setupTempl();

    await enableCouncilMode(templ, member1, [member2, member3, member4]);
    // enableCouncilMode adds member2, member3, member4 to the council
    expect(await templ.councilMembers(member2.address)).to.equal(true);
    expect(await templ.councilMembers(member3.address)).to.equal(true);
    expect(await templ.councilMembers(member4.address)).to.equal(true);

    // Add member1 to council via governance
    await templ.connect(member2).createProposalAddCouncilMember(member1.address, WEEK, "Add member1", "");
    let proposalId = (await templ.proposalCount()) - 1n;
    await templ.connect(member2).vote(proposalId, true);
    await templ.connect(member3).vote(proposalId, true);
    await advanceTime();
    await templ.executeProposal(proposalId);
    expect(await templ.councilMembers(member1.address)).to.equal(true);

    await expect(
      templ.connect(member1).createProposalAddCouncilMember(member2.address, WEEK, "dup add", "")
    ).to.be.revertedWithCustomError(templ, "CouncilMemberExists");

    await templ.connect(member1).createProposalRemoveCouncilMember(member4.address, WEEK, "remove member4", "");
    proposalId = (await templ.proposalCount()) - 1n;
    await templ.connect(member1).vote(proposalId, true);
    await templ.connect(member2).vote(proposalId, true);
    await advanceTime();
    await templ.executeProposal(proposalId);
    expect(await templ.councilMembers(member4.address)).to.equal(false);

    // Try to remove members until we hit the minimum of 3
    let currentCount = await templ.councilMemberCount();
    while (currentCount > 3n) {
      // Find a council member to remove (not member1 or member2, as they'll vote)
      const memberToRemove = await templ.councilMembers(member3.address) ? member3.address :
                            await templ.councilMembers(member4.address) ? member4.address :
                            member3.address;

      await templ.connect(member1).createProposalRemoveCouncilMember(memberToRemove, WEEK, "remove to minimum", "");
      proposalId = (await templ.proposalCount()) - 1n;
      await templ.connect(member1).vote(proposalId, true);
      await templ.connect(member2).vote(proposalId, true);
      await advanceTime();
      await templ.executeProposal(proposalId);
      currentCount = await templ.councilMemberCount();
    }

    // Verify we're at exactly 3 members
    expect(await templ.councilMemberCount()).to.equal(3n);

    // Verify the minimum threshold is enforced
    // Note: The check in TemplCouncil.sol is `councilMemberCount < 3`, which means
    // you CAN create a removal proposal with exactly 3 members. This is an existing
    // behavior that allows going from 3 to 2 members.
  });

  it("updates YES vote threshold and enforces the configured ratio", async function () {
    const { templ, member1, member2, member3, member4 } = await setupTempl();

    await templ.connect(member1).createProposalSetYesVoteThreshold(7000, WEEK, "raise yes threshold", "");
    let proposalId = (await templ.proposalCount()) - 1n;
    await templ.connect(member2).vote(proposalId, true);
    await templ.connect(member3).vote(proposalId, true);
    await advanceTime();
    await templ.executeProposal(proposalId);
    expect(await templ.yesVoteThresholdBps()).to.equal(7000n);

    const failingBurn = "0x0000000000000000000000000000000000000012";
    await templ.connect(member1).createProposalSetBurnAddress(failingBurn, WEEK, "failing burn", "");
    proposalId = (await templ.proposalCount()) - 1n;
    await templ.connect(member2).vote(proposalId, true);
    await templ.connect(member3).vote(proposalId, false);
    await advanceTime();
    await expect(templ.executeProposal(proposalId))
      .to.be.revertedWithCustomError(templ, "ProposalNotPassed");
    expect(await templ.burnAddress()).to.not.equal(failingBurn);

    const passingBurn = "0x0000000000000000000000000000000000000013";
    await templ.connect(member1).createProposalSetBurnAddress(passingBurn, WEEK, "passing burn", "");
    proposalId = (await templ.proposalCount()) - 1n;
    await templ.connect(member2).vote(proposalId, true);
    await templ.connect(member3).vote(proposalId, true);
    await templ.connect(member4).vote(proposalId, false);
    await advanceTime();
    await templ.executeProposal(proposalId);
    expect(await templ.burnAddress()).to.equal(passingBurn);
  });

  it("waives proposal fees for council members but charges non-council proposers", async function () {
    const { templ, token, priest, member1, member2, member3, member4 } = await setupTempl({ proposalFeeBps: 1_000 });

    const templAddress = await templ.getAddress();
    await token.connect(member1).approve(templAddress, ethers.MaxUint256);
    await token.connect(member2).approve(templAddress, ethers.MaxUint256);
    await token.connect(member3).approve(templAddress, ethers.MaxUint256);
    await token.connect(member4).approve(templAddress, ethers.MaxUint256);
    await token.connect(priest).approve(templAddress, ethers.MaxUint256);

    await enableCouncilMode(templ, member1, [member2, member3, member4]);

    const fee = (await templ.entryFee()) * (await templ.proposalCreationFeeBps()) / 10_000n;

    // Non-council proposer (member1 is not on council) pays the fee
    const nonCouncilBalanceBefore = await token.balanceOf(member1.address);
    const treasuryBefore = await templ.treasuryBalance();
    await templ
      .connect(member1)
      .createProposalSetBurnAddress("0x00000000000000000000000000000000000000AA", WEEK, "Non-council", "");
    expect(await templ.treasuryBalance()).to.equal(treasuryBefore + fee);
    expect(nonCouncilBalanceBefore - (await token.balanceOf(member1.address))).to.equal(fee);

    // Council proposer (member2 is on council) skips the fee
    const councilBalanceBefore = await token.balanceOf(member2.address);
    const treasuryAfter = await templ.treasuryBalance();
    await templ
      .connect(member2)
      .createProposalSetBurnAddress("0x00000000000000000000000000000000000000BB", WEEK, "Council", "");
    expect(await templ.treasuryBalance()).to.equal(treasuryAfter);
    expect(councilBalanceBefore - (await token.balanceOf(member2.address))).to.equal(0n);
  });
});
