const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");

describe("TEMPL selector → module introspection", function () {
  it("maps membership selectors to the membership module", async function () {
    const { templ } = await deployTempl();
    const membership = await templ.membershipModule();
    const joinSel = templ.interface.getFunction("join").selector;
    const claimSel = templ.interface.getFunction("claimMemberRewards").selector;
    expect(await templ.getModuleForSelector(joinSel)).to.equal(membership);
    expect(await templ.getModuleForSelector(claimSel)).to.equal(membership);
  });

  it("maps treasury selectors to the treasury module", async function () {
    const { templ } = await deployTempl();
    const treasury = await templ.treasuryModule();
    const pauseSel = templ.interface.getFunction("setJoinPausedDAO").selector;
    const withdrawSel = templ.interface.getFunction("withdrawTreasuryDAO").selector;
    expect(await templ.getModuleForSelector(pauseSel)).to.equal(treasury);
    expect(await templ.getModuleForSelector(withdrawSel)).to.equal(treasury);
  });

  it("maps governance selectors to the governance module", async function () {
    const { templ } = await deployTempl();
    const governance = await templ.governanceModule();
    const createSel = templ.interface.getFunction("createProposalSetJoinPaused").selector;
    const voteSel = templ.interface.getFunction("vote").selector;
    const execSel = templ.interface.getFunction("executeProposal").selector;
    expect(await templ.getModuleForSelector(createSel)).to.equal(governance);
    expect(await templ.getModuleForSelector(voteSel)).to.equal(governance);
    expect(await templ.getModuleForSelector(execSel)).to.equal(governance);
  });

  it("returns zero address for unknown selectors", async function () {
    const { templ } = await deployTempl();
    // Random 4-byte selector that doesn't exist.
    const unknownSel = "0x12345678";
    expect(await templ.getModuleForSelector(unknownSel)).to.equal(ethers.ZeroAddress);
  });

  it("maps new treasury/governance selectors and TEMPL-owned generic payload getter", async function () {
    const { templ } = await deployTempl();
    const treasury = await templ.treasuryModule();
    const governance = await templ.governanceModule();

    const sel = (name) => templ.interface.getFunction(name).selector;

    // Treasury DAO setters
    for (const fn of [
      "setQuorumBpsDAO",
      "setExecutionDelayAfterQuorumDAO",
      "setBurnAddressDAO",
    ]) {
      expect(await templ.getModuleForSelector(sel(fn))).to.equal(treasury);
    }

    // Governance proposal creators
    for (const fn of [
      "createProposalSetQuorumBps",
      "createProposalSetExecutionDelay",
      "createProposalSetBurnAddress",
    ]) {
      expect(await templ.getModuleForSelector(sel(fn))).to.equal(governance);
    }

    // Generic payload getter is implemented on TEMPL itself, not routed
    expect(await templ.getModuleForSelector(sel("getProposalActionData"))).to.equal(ethers.ZeroAddress);
  });

  it("reverts InvalidCallData for non-existent payload getters", async function () {
    const { templ, accounts } = await deployTempl();
    const [owner] = accounts;
    // Craft a call to a payload getter that isn't implemented (trimmed to keep code size under the limit)
    const badIface = new ethers.Interface([
      "function getProposalUpdateConfigPayload(uint256)"
    ]);
    const data = badIface.encodeFunctionData("getProposalUpdateConfigPayload", [0]);
    await expect(owner.sendTransaction({ to: await templ.getAddress(), data }))
      .to.be.revertedWithCustomError(templ, "InvalidCallData");
  });
});
