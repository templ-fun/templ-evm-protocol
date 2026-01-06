const { expect } = require('chai');
const { ethers } = require('hardhat');
const { deployTempl } = require('./utils/deploy');
const { deployTemplModules } = require('./utils/modules');
const { mintToUsers, joinMembers } = require('./utils/mintAndPurchase');
const { attachTemplInterface } = require('./utils/templ');

// Regression test: once quorum is reached, execution must wait until the
// endTime captured at quorum even if the global executionDelayAfterQuorum
// is changed afterwards.
describe('Anchored execution delay after quorum', function () {
  it('does not shorten waiting period when global delay is reduced after quorum', async function () {
    const accounts = await ethers.getSigners();
    const [, priest, memberB] = accounts;

    // Deploy harness-like TEMPL with modules to allow direct onlyDAO wrappers via self-call.
    const Token = await ethers.getContractFactory('contracts/mocks/TestToken.sol:TestToken');
    const token = await Token.deploy('Test', 'TEST', 18);
    await token.waitForDeployment();

    const { membershipModule, treasuryModule, governanceModule, councilModule } = await deployTemplModules();

    // Use the minimum execution delay and warp time across checks.
    const Templ = await ethers.getContractFactory('TEMPL');
    let templ = await Templ.deploy(
      priest.address,
      priest.address,
      await token.getAddress(),
      ethers.parseUnits('100', 18),
      3000,
      3000,
      3000,
      1000,
      3300,
      60 * 60,
      '0x000000000000000000000000000000000000dEaD',
      0,
      'Anchored',
      'Delay test',
      'https://templ.test/logo.png',
      0,
      0,
      5_000,
       10_000,
      false,
      membershipModule,
      treasuryModule,
      governanceModule,
      councilModule,
      { primary: { style: 2, rateBps: 11000, length: 0 }, additionalSegments: [] }
    );
    await templ.waitForDeployment();
    templ = await attachTemplInterface(templ);

    // Onboard a second member so instant quorum (100% yes) requires more than the auto YES vote.
    await token.mint(memberB.address, ethers.parseUnits('100', 18));
    await token.connect(memberB).approve(await templ.getAddress(), ethers.parseUnits('100', 18));
    await templ.connect(memberB).join();

    // Create a proposal that will hit quorum immediately (priest auto-enrolled, auto-YES).
    const tx = await templ.connect(priest).createProposalSetJoinPaused(true, 0, 'Pause', 'Test');
    await tx.wait();
    const proposalId = (await templ.proposalCount()) - 1n;

    const snapshots = await templ.getProposalSnapshots(proposalId);
    expect(snapshots[5]).to.not.equal(0n); // quorumReachedAt
    const proposal = await templ.getProposal(proposalId);
    const createdAt = snapshots[4];
    const endTime = proposal[3];
    expect(endTime).to.be.greaterThan(createdAt);

    // Prepare an external call proposal (B) that sets the global execution delay to a large value.

    const iface = templ.interface;
    const func = iface.getFunction('setPostQuorumVotingPeriodDAO');
    const selector = func.selector;
    const params = ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [100_000]);
    await templ
      .connect(memberB)
      .createProposalCallExternal(await templ.getAddress(), 0, selector, params, 0, 'Set delay', 'Bump delay');
    const proposalB = (await templ.proposalCount()) - 1n;

    // Fast forward past the short default delay to execute proposal B first.
    const delay = Number(await templ.postQuorumVotingPeriod());
    await ethers.provider.send('evm_increaseTime', [delay + 1]);
    await ethers.provider.send('evm_mine', []);
    await templ.executeProposal(proposalB);

    // Now global delay is large. Executing proposal A should still succeed based on its stored endTime.
    await expect(templ.executeProposal(proposalId)).to.not.be.reverted;
  });

  it('anchors post-quorum delay at creation when the delay is reduced before quorum', async function () {
    const ENTRY_FEE = ethers.parseUnits('100', 18);
    const LONG_DELAY = 7 * 24 * 60 * 60;
    const SHORT_DELAY = 60 * 60;
    const LONG_VOTING_PERIOD = 20 * 24 * 60 * 60;

    const { templ, token, accounts } = await deployTempl({
      entryFee: ENTRY_FEE,
      executionDelay: LONG_DELAY,
    });
    const [, , member1, member2, member3] = accounts;

    await mintToUsers(token, [member1, member2, member3], ENTRY_FEE * 5n);
    await joinMembers(templ, token, [member1, member2, member3]);

    await templ
      .connect(member1)
      .createProposalSetBurnAddress('0x00000000000000000000000000000000000000c1', LONG_VOTING_PERIOD, 'burn', '');
    const proposalA = (await templ.proposalCount()) - 1n;

    await templ
      .connect(member2)
      .createProposalSetPostQuorumVotingPeriod(SHORT_DELAY, 7 * 24 * 60 * 60, 'delay', '');
    const proposalB = (await templ.proposalCount()) - 1n;
    await templ.connect(member3).vote(proposalB, true);

    await ethers.provider.send('evm_increaseTime', [LONG_DELAY + 1]);
    await ethers.provider.send('evm_mine', []);
    await templ.executeProposal(proposalB);
    expect(await templ.postQuorumVotingPeriod()).to.equal(BigInt(SHORT_DELAY));

    await templ.connect(member2).vote(proposalA, true);
    await templ.connect(member3).vote(proposalA, true);

    await ethers.provider.send('evm_increaseTime', [SHORT_DELAY + 1]);
    await ethers.provider.send('evm_mine', []);

    await expect(templ.executeProposal(proposalA)).to.be.revertedWithCustomError(templ, 'ExecutionDelayActive');
  });
});
