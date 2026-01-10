const { expect } = require("chai");
const { ethers } = require("hardhat");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, joinMembers } = require("./utils/mintAndPurchase");
const { deployTemplModules } = require("./utils/modules");
const { attachTemplInterface } = require("./utils/templ");

describe("Event argument coverage (withArgs)", function () {
  const ENTRY_FEE = ethers.parseUnits("100", 18);
  const DAY = 24 * 60 * 60;

  it("emits ProposalCreated, VoteCast, ProposalExecuted with exact args", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, priest, m1, m2] = accounts;

    await mintToUsers(token, [m1, m2], ENTRY_FEE * 3n);
    await joinMembers(templ, token, [m1, m2]);

    // Create proposal and assert ProposalCreated args (id and endTime are dynamic)
    const title = "Pause";
    const desc = "Check event args";
    const createTx = await templ.connect(m1).createProposalSetJoinPaused(true, 7 * DAY, title, desc);
    await expect(createTx)
      .to.emit(templ, "ProposalCreated")
      .withArgs(anyValue, m1.address, anyValue, title, desc);

    const id = (await templ.proposalCount()) - 1n;

    // Vote and assert VoteCast args (timestamp is dynamic)
    const voteTx = await templ.connect(m2).vote(id, true);
    await expect(voteTx)
      .to.emit(templ, "VoteCast")
      .withArgs(id, m2.address, true, anyValue);

    // Wait past post‑quorum delay and execute; result hash is keccak256(0x) for non-external actions
    const delay = Number(await templ.postQuorumVotingPeriod());
    await ethers.provider.send("evm_increaseTime", [delay + 1]);
    await ethers.provider.send("evm_mine", []);
    const execTx = await templ.executeProposal(id);
    await expect(execTx)
      .to.emit(templ, "ProposalExecuted")
      .withArgs(id, true, ethers.keccak256("0x"));
  });

  it("emits TemplMetadataUpdated with exact args via onlyDAO self-call", async function () {
    const [, priest, protocol] = await ethers.getSigners();
    const AccessToken = await ethers.getContractFactory("contracts/mocks/TestToken.sol:TestToken");
    const accessToken = await AccessToken.deploy("Access", "ACC", 18);
    await accessToken.waitForDeployment();
    const Harness = await ethers.getContractFactory(
      "contracts/mocks/DaoCallerHarness.sol:DaoCallerHarness"
    );
    const modules = await deployTemplModules();
    let templ = await Harness.deploy(
      priest.address,
      protocol.address,
      accessToken.target,
      ENTRY_FEE,
      modules.membershipModule,
      modules.treasuryModule,
      modules.governanceModule,
      modules.councilModule
    );
    await templ.waitForDeployment();
    templ = await attachTemplInterface(templ);

    const name = "Eventful";
    const description = "Updated via onlyDAO";
    const logo = "https://templ/logo.png";
    const tx = await templ.daoSetMetadata(name, description, logo);
    await expect(tx)
      .to.emit(templ, "TemplMetadataUpdated")
      .withArgs(name, description, logo);
  });

  it("emits TreasuryAction with exact args on ERC20 withdrawal execution", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, , proposer, voter, recipient] = accounts;
    await mintToUsers(token, [proposer, voter], ENTRY_FEE * 6n);
    await joinMembers(templ, token, [proposer, voter]);

    // Ensure treasury has funds from joins; withdraw a small amount
    const amount = (ENTRY_FEE * 10n) / 100n; // 10 tokens
    await templ.connect(proposer).createProposalWithdrawTreasury(token.target, recipient.address, amount, 7 * DAY, "wd", "");
    const id = (await templ.proposalCount()) - 1n;
    await templ.connect(voter).vote(id, true);
    await ethers.provider.send("evm_increaseTime", [7 * DAY + 1]);
    await ethers.provider.send("evm_mine", []);
    const execTx = await templ.executeProposal(id);
    await expect(execTx)
      .to.emit(templ, "TreasuryAction")
      .withArgs(id, await token.getAddress(), recipient.address, amount);
  });

  it("emits ReferralRewardPaid with exact args when referral share > 0", async function () {
    const referralShareBps = 2_000; // 20% of member pool slice
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE, referralShareBps });
    const [, , referrer, newcomer] = accounts;
    await mintToUsers(token, [referrer, newcomer], ENTRY_FEE * 3n);
    await joinMembers(templ, token, [referrer]);

    const memberPoolBps = await templ.memberPoolBps();
    const memberPoolSlice = (ENTRY_FEE * memberPoolBps) / 10_000n;
    const expectedReferral = (memberPoolSlice * BigInt(referralShareBps)) / 10_000n;

    await token.connect(newcomer).approve(await templ.getAddress(), ENTRY_FEE);
    const tx = await templ.connect(newcomer).joinWithReferral(referrer.address);
    await expect(tx)
      .to.emit(templ, "ReferralRewardPaid")
      .withArgs(referrer.address, newcomer.address, expectedReferral);
  });
});
