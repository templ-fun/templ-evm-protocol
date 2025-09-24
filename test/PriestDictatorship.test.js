const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, purchaseAccess } = require("./utils/mintAndPurchase");

describe("Priest dictatorship governance toggle", function () {
  const ENTRY_FEE = ethers.parseUnits("100", 18);
  const TOKEN_SUPPLY = ethers.parseUnits("10000", 18);
  const VOTING_PERIOD = 7 * 24 * 60 * 60;
  const EXECUTION_DELAY = 7 * 24 * 60 * 60;

  let templ;
  let token;
  let accounts;
  let priest;
  let member;

  beforeEach(async function () {
    ({ templ, token, accounts, priest } = await deployTempl({ entryFee: ENTRY_FEE }));
    [, , member] = accounts;
    await mintToUsers(token, [member], TOKEN_SUPPLY);
    await purchaseAccess(templ, token, [member]);
  });

  function advanceBeyondExecutionDelay() {
    return Promise.all([
      ethers.provider.send("evm_increaseTime", [EXECUTION_DELAY + 1]),
      ethers.provider.send("evm_mine")
    ]);
  }

  it("allows DAO proposals to enable and disable dictatorship", async function () {
    expect(await templ.priestIsDictator()).to.equal(false);

    const txEnable = await templ
      .connect(member)
      .createProposalSetDictatorship(true, VOTING_PERIOD);
    await txEnable.wait();

    await advanceBeyondExecutionDelay();
    const execEnable = await templ.executeProposal(0);
    const receiptEnable = await execEnable.wait();
    const enableEvent = receiptEnable.logs
      .map((log) => {
        try {
          return templ.interface.parseLog(log);
        } catch (_) {
          return null;
        }
      })
      .find((log) => log && log.name === "DictatorshipModeChanged");
    expect(enableEvent?.args?.enabled).to.equal(true);
    expect(await templ.priestIsDictator()).to.equal(true);

    await expect(
      templ.connect(member).createProposalSetDictatorship(true, VOTING_PERIOD)
    ).to.be.revertedWithCustomError(templ, "DictatorshipUnchanged");

    await expect(
      templ.connect(member).createProposalSetPaused(true, VOTING_PERIOD)
    ).to.be.revertedWithCustomError(templ, "DictatorshipEnabled");

    const txDisable = await templ
      .connect(member)
      .createProposalSetDictatorship(false, VOTING_PERIOD);
    await txDisable.wait();

    // ensure voting still works while dictatorship is active for the toggle proposal
    await expect(templ.connect(member).vote(1, true)).to.not.be.reverted;

    await advanceBeyondExecutionDelay();
    const execDisable = await templ.executeProposal(1);
    const receiptDisable = await execDisable.wait();
    const disableEvent = receiptDisable.logs
      .map((log) => {
        try {
          return templ.interface.parseLog(log);
        } catch (_) {
          return null;
        }
      })
      .find((log) => log && log.name === "DictatorshipModeChanged");
    expect(disableEvent?.args?.enabled).to.equal(false);
    expect(await templ.priestIsDictator()).to.equal(false);
  });

  it("restricts priest-only DAO calls when dictatorship is active", async function () {
    await templ.connect(member).createProposalSetDictatorship(true, VOTING_PERIOD);
    await advanceBeyondExecutionDelay();
    await templ.executeProposal(0);

    const outsider = accounts[4];
    await expect(
      templ.connect(outsider).setDictatorshipDAO(false)
    ).to.be.revertedWithCustomError(templ, "PriestOnly");

    await expect(templ.connect(priest).setDictatorshipDAO(false)).to.not.be.reverted;
    expect(await templ.priestIsDictator()).to.equal(false);
  });
});
