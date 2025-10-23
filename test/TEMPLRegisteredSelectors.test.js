const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");

describe("TEMPL.getRegisteredSelectors()", function () {
  it("returns exact static selector sets per module", async function () {
    const { templ } = await deployTempl();

    const [membership, treasury, governance] = await templ.getRegisteredSelectors();

    // Helper to compute selector from function name using the merged interface
    const sel = (name) => templ.interface.getFunction(name).selector;

    const expectedMembership = [
      "join",
      "joinWithReferral",
      "joinFor",
      "joinForWithReferral",
      "claimMemberRewards",
      "claimExternalReward",
      "getClaimableMemberRewards",
      "getExternalRewardTokens",
      "getExternalRewardState",
      "getClaimableExternalReward",
      "isMember",
      "getJoinDetails",
      "getTreasuryInfo",
      "getConfig",
      "getMemberCount",
      "getVoteWeight",
      "totalJoins",
      "getExternalRewardTokensPaginated",
    ].map(sel);

    const expectedTreasury = [
      "withdrawTreasuryDAO",
      "updateConfigDAO",
      "setJoinPausedDAO",
      "setMaxMembersDAO",
      "disbandTreasuryDAO",
      "changePriestDAO",
      "setDictatorshipDAO",
      "setTemplMetadataDAO",
      "setProposalCreationFeeBpsDAO",
      "setReferralShareBpsDAO",
      "setEntryFeeCurveDAO",
      "cleanupExternalRewardToken",
      "setQuorumBpsDAO",
      "setPostQuorumVotingPeriodDAO",
      "setBurnAddressDAO",
      "batchDAO",
      "setPreQuorumVotingPeriodDAO",
    ].map(sel);

    const expectedGovernance = [
      "createProposalSetJoinPaused",
      "createProposalUpdateConfig",
      "createProposalSetMaxMembers",
      "createProposalUpdateMetadata",
      "createProposalSetProposalFeeBps",
      "createProposalSetReferralShareBps",
      "createProposalSetEntryFeeCurve",
      "createProposalCallExternal",
      "createProposalWithdrawTreasury",
      "createProposalDisbandTreasury",
      "createProposalChangePriest",
      "createProposalSetDictatorship",
      "vote",
      "executeProposal",
      "getProposal",
      "getProposalSnapshots",
      "hasVoted",
      "getActiveProposals",
      "getActiveProposalsPaginated",
      "pruneInactiveProposals",
      "getProposalJoinSequences",
      "createProposalCleanupExternalRewardToken",
      "createProposalSetQuorumBps",
      "createProposalSetPostQuorumVotingPeriod",
      "createProposalSetBurnAddress",
    ].map(sel);

    expect(membership.length).to.equal(expectedMembership.length);
    expect(treasury.length).to.equal(expectedTreasury.length);
    expect(governance.length).to.equal(expectedGovernance.length);

    expect(membership).to.deep.equal(expectedMembership);
    expect(treasury).to.deep.equal(expectedTreasury);
    expect(governance).to.deep.equal(expectedGovernance);

    // Additionally, verify that each returned selector maps back to the correct module
    const membershipModuleAddr = await templ.MEMBERSHIP_MODULE();
    const treasuryModuleAddr = await templ.TREASURY_MODULE();
    const governanceModuleAddr = await templ.GOVERNANCE_MODULE();

    for (const s of membership) {
      expect(await templ.getModuleForSelector(s)).to.equal(membershipModuleAddr);
    }
    for (const s of treasury) {
      expect(await templ.getModuleForSelector(s)).to.equal(treasuryModuleAddr);
    }
    for (const s of governance) {
      expect(await templ.getModuleForSelector(s)).to.equal(governanceModuleAddr);
    }
  });
});
