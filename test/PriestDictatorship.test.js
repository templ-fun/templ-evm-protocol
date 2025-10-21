const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, joinMembers } = require("./utils/mintAndPurchase");

describe("Priest dictatorship governance toggle", function () {
  const ENTRY_FEE = ethers.parseUnits("100", 18);
  const TOKEN_SUPPLY = ethers.parseUnits("10000", 18);
  const VOTING_PERIOD = 7 * 24 * 60 * 60;
  const EXECUTION_DELAY = 7 * 24 * 60 * 60;
  const TITLE_ENABLE = "Enable dictatorship";
  const TITLE_DISABLE = "Disable dictatorship";
  const DESC_DICTATORSHIP = "Toggle priest dictatorship mode";

  let templ;
  let token;
  let accounts;
  let priest;
  let member;

  beforeEach(async function () {
    ({ templ, token, accounts, priest } = await deployTempl({ entryFee: ENTRY_FEE }));
    [, , member] = accounts;
    await mintToUsers(token, [member], TOKEN_SUPPLY);
    await joinMembers(templ, token, [member]);
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
      .createProposalSetDictatorship(true, VOTING_PERIOD, TITLE_ENABLE, DESC_DICTATORSHIP);
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
      templ
        .connect(member)
        .createProposalSetDictatorship(true, VOTING_PERIOD, TITLE_ENABLE, DESC_DICTATORSHIP)
    ).to.be.revertedWithCustomError(templ, "DictatorshipUnchanged");

    await expect(
      templ
        .connect(member)
        .createProposalSetJoinPaused(true, VOTING_PERIOD, "Pause templ", "Attempt to pause while dictator")
    ).to.be.revertedWithCustomError(templ, "DictatorshipEnabled");

    const txDisable = await templ
      .connect(member)
      .createProposalSetDictatorship(false, VOTING_PERIOD, TITLE_DISABLE, DESC_DICTATORSHIP);
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
    await templ
      .connect(member)
      .createProposalSetDictatorship(true, VOTING_PERIOD, TITLE_ENABLE, DESC_DICTATORSHIP);
    await advanceBeyondExecutionDelay();
    await templ.executeProposal(0);

    const outsider = accounts[4];
    await expect(
      templ.connect(outsider).setDictatorshipDAO(false)
    ).to.be.revertedWithCustomError(templ, "PriestOnly");

    await expect(templ.connect(priest).setDictatorshipDAO(false)).to.not.be.reverted;
    expect(await templ.priestIsDictator()).to.equal(false);
  });

  it("permits the priest to call DAO functions directly under dictatorship", async function () {
    await templ
      .connect(member)
      .createProposalSetDictatorship(true, VOTING_PERIOD, TITLE_ENABLE, DESC_DICTATORSHIP);
    await advanceBeyondExecutionDelay();
    await templ.executeProposal(0);

    await expect(
      templ.connect(priest).setTemplMetadataDAO("Dict Templ", "Dictatorship active", "https://dict-templ/logo.png")
    ).to.emit(templ, "TemplMetadataUpdated");
  });

  it("blocks new governance proposals while dictatorship is active", async function () {
    await templ
      .connect(member)
      .createProposalSetDictatorship(true, VOTING_PERIOD, TITLE_ENABLE, DESC_DICTATORSHIP);
    await advanceBeyondExecutionDelay();
    await templ.executeProposal(0);

    const revertWithDictatorship = async (fn) => {
      await expect(fn).to.be.revertedWithCustomError(templ, "DictatorshipEnabled");
    };

    await revertWithDictatorship(
      templ
        .connect(member)
        .createProposalUpdateConfig(
          ethers.ZeroAddress,
          0,
          0,
          0,
          0,
          false,
          VOTING_PERIOD,
          "cfg",
          "dict"
        )
    );
    await revertWithDictatorship(
      templ
        .connect(member)
        .createProposalSetMaxMembers(0, VOTING_PERIOD, "max", "dict")
    );
    await revertWithDictatorship(
      templ
        .connect(member)
        .createProposalUpdateMetadata(
          "Dict Name",
          "Dict desc",
          "https://templ/logo.png",
          VOTING_PERIOD,
          "home",
          "dict"
        )
    );
    await revertWithDictatorship(
      templ
        .connect(member)
        .createProposalWithdrawTreasury(
          ethers.ZeroAddress,
          member.address,
          0,
          "test",
          VOTING_PERIOD,
          "withdraw",
          "dict"
        )
    );
    await revertWithDictatorship(
      templ
        .connect(member)
        .createProposalDisbandTreasury(ethers.ZeroAddress, VOTING_PERIOD, "disband", "dict")
    );
    await revertWithDictatorship(
      templ
        .connect(member)
        .createProposalChangePriest(priest.address, VOTING_PERIOD, "priest", "dict")
    );
  });

  it("enforces the voting window for quorum-exempt priest proposals", async function () {
    await mintToUsers(token, [priest], TOKEN_SUPPLY);
    await joinMembers(templ, token, [priest]);

    await templ
      .connect(priest)
      .createProposalDisbandTreasury(ethers.ZeroAddress, VOTING_PERIOD, "priest disband", "dict");

    await expect(templ.executeProposal(0)).to.be.revertedWithCustomError(
      templ,
      "VotingNotEnded"
    );

    await ethers.provider.send("evm_increaseTime", [VOTING_PERIOD + 1]);
    await ethers.provider.send("evm_mine", []);

    const donation = ethers.parseUnits("1", 18);
    await priest.sendTransaction({ to: await templ.getAddress(), value: donation });

    await expect(templ.executeProposal(0)).to.not.be.reverted;
  });

  it("blocks voting and execution of existing proposals once dictatorship begins", async function () {
    const secondMember = accounts[3];

    await mintToUsers(token, [secondMember], TOKEN_SUPPLY);
    await joinMembers(templ, token, [secondMember]);

    await templ
      .connect(member)
      .createProposalUpdateMetadata(
        "Dict Name",
        "Dict desc",
        "https://templ.example/logo.png",
        VOTING_PERIOD,
        "Set metadata",
        "Initial metadata"
      );

    await templ
      .connect(secondMember)
      .createProposalSetDictatorship(true, VOTING_PERIOD, TITLE_ENABLE, DESC_DICTATORSHIP);
    await advanceBeyondExecutionDelay();
    await templ.executeProposal(1);
    expect(await templ.priestIsDictator()).to.equal(true);

    await expect(templ.connect(member).vote(0, true)).to.be.revertedWithCustomError(
      templ,
      "DictatorshipEnabled"
    );

    await expect(templ.executeProposal(0)).to.be.revertedWithCustomError(
      templ,
      "DictatorshipEnabled"
    );
  });

  it("blocks executing non-dictatorship proposals while dictatorship is enabled", async function () {
    const [, , memberA, memberB] = accounts;
    await mintToUsers(token, [memberA, memberB], TOKEN_SUPPLY);
    await joinMembers(templ, token, [memberA, memberB]);

    await templ
      .connect(memberA)
      .createProposalSetJoinPaused(false, VOTING_PERIOD, "Pause", "Pre-dictatorship");

    await templ
      .connect(memberB)
      .createProposalSetDictatorship(true, VOTING_PERIOD, TITLE_ENABLE, DESC_DICTATORSHIP);
    await templ.connect(memberA).vote(1, true);
    await templ.connect(memberB).vote(1, true);
    await advanceBeyondExecutionDelay();
    await templ.executeProposal(1);

    await expect(templ.executeProposal(0)).to.be.revertedWithCustomError(
      templ,
      "DictatorshipEnabled"
    );
  });
});
