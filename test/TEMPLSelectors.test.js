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
});

