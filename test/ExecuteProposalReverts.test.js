const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, joinMembers } = require("./utils/mintAndPurchase");
const { deployTemplModules } = require("./utils/modules");
const { attachTemplInterface } = require("./utils/templ");

describe("executeProposal reverts", function () {
  let templ;
  let token;
  let owner;
  let priest;
  let accounts;
  const ENTRY_FEE = ethers.parseUnits("100", 18);

  beforeEach(async function () {
    ({ templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE }));
    [owner, priest] = accounts;
  });

  it("reverts for proposal ID >= proposalCount", async function () {
    await expect(templ.executeProposal(0)).to.be.revertedWithCustomError(
      templ,
      "InvalidProposal"
    );
  });

  it("rejects invalid update fee at creation", async function () {
    await mintToUsers(token, [owner], ENTRY_FEE);
    await joinMembers(templ, token, [owner]);
    await expect(
      templ
        .connect(owner)
        .createProposalUpdateConfig(
          ethers.ZeroAddress,
          5,
          0,
          0,
          0,
          false,
          7 * 24 * 60 * 60,
          'Invalid fee',
          'Test metadata'
        )
    ).to.be.revertedWithCustomError(templ, "EntryFeeTooSmall");
  });

  it("reverts when executing before quorum is reached", async function () {
    const [, , member1, member2, member3, member4] = accounts;
    await mintToUsers(token, [member1, member2, member3, member4], ENTRY_FEE * 5n);
    await joinMembers(templ, token, [member1, member2, member3, member4]);

    await templ
      .connect(member1)
      .createProposalSetJoinPaused(false, 7 * 24 * 60 * 60, 'Keep running', 'Ensure quorum required');

    await expect(templ.executeProposal(0))
      .to.be.revertedWithCustomError(templ, "QuorumNotReached");
  });

  it("reverts when quorum support drops below the threshold after initial reach", async function () {
    const {
      templ: highQuorumTempl,
      token: highQuorumToken,
      accounts: highQuorumAccounts,
    } = await deployTempl({ entryFee: ENTRY_FEE, quorumBps: 60 });

    const members = highQuorumAccounts.slice(2, 8);

    await mintToUsers(highQuorumToken, members, ENTRY_FEE * 3n);
    await joinMembers(highQuorumTempl, highQuorumToken, members);

    await highQuorumTempl
      .connect(members[0])
      .createProposalSetJoinPaused(false, 7 * 24 * 60 * 60, 'Keep running', 'Require quorum persistence');

    await highQuorumTempl.connect(members[1]).vote(0, true);
    await highQuorumTempl.connect(members[2]).vote(0, true);
    await highQuorumTempl.connect(members[3]).vote(0, true);
    await highQuorumTempl.connect(members[4]).vote(0, true);

  const delay = Number(await highQuorumTempl.postQuorumVotingPeriod());

    await highQuorumTempl.connect(members[3]).vote(0, false);
    await highQuorumTempl.connect(members[2]).vote(0, false);

    await ethers.provider.send("evm_increaseTime", [delay + 1]);
    await ethers.provider.send("evm_mine", []);

    await expect(highQuorumTempl.executeProposal(0))
      .to.be.revertedWithCustomError(highQuorumTempl, "QuorumNotReached");
  });

  it("reverts with InvalidCallData when proposal action is undefined", async function () {
    const signers = await ethers.getSigners();
    const [, priestSigner, member1, member2] = signers;

    const Token = await ethers.getContractFactory(
      "contracts/mocks/TestToken.sol:TestToken"
    );
    const harnessToken = await Token.deploy("Harness", "HRN", 18);
    await harnessToken.waitForDeployment();

    const Harness = await ethers.getContractFactory(
      "contracts/mocks/DaoCallerHarness.sol:DaoCallerHarness"
    );
    const modules = await deployTemplModules();
    let harness = await Harness.deploy(
      priestSigner.address,
      priestSigner.address,
      harnessToken.target,
      ENTRY_FEE,
      modules.membershipModule,
      modules.treasuryModule,
      modules.governanceModule
    );
    await harness.waitForDeployment();
    harness = await attachTemplInterface(harness);

    await mintToUsers(harnessToken, [member1, member2], ENTRY_FEE * 5n);
    await joinMembers(harness, harnessToken, [member1, member2]);

    const harnessAddress = await harness.getAddress();
    await harnessToken.connect(member1).approve(harnessAddress, ENTRY_FEE * 10n);
    await harnessToken.connect(member2).approve(harnessAddress, ENTRY_FEE * 10n);

    await harness
      .connect(member1)
      .createProposalSetJoinPaused(true, 7 * 24 * 60 * 60, 'Pause harness', 'Testing invalid call data');
    await harness.setUndefinedAction(0);

  const delay = Number(await harness.postQuorumVotingPeriod());
    await ethers.provider.send("evm_increaseTime", [delay + 1]);
    await ethers.provider.send("evm_mine", []);

    await expect(harness.executeProposal(0))
      .to.be.revertedWithCustomError(harness, "InvalidCallData");
  });

});
