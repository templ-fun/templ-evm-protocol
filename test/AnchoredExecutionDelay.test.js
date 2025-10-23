const { expect } = require('chai');
const { ethers } = require('hardhat');
const { deployTemplModules } = require('./utils/modules');
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

    const { membershipModule, treasuryModule, governanceModule } = await deployTemplModules();

    // Use a short execution delay (2 seconds) and warp time across checks.
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
      2,
      '0x000000000000000000000000000000000000dEaD',
      false,
      0,
      'Anchored',
      'Delay test',
      'https://templ.test/logo.png',
      0,
      0,
      membershipModule,
      treasuryModule,
      governanceModule,
      { primary: { style: 2, rateBps: 11000, length: 0 }, additionalSegments: [] }
    );
    await templ.waitForDeployment();
    templ = await attachTemplInterface(templ);

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
    // Onboard a second member who will propose the external-call change.
    await token.mint(memberB.address, ethers.parseUnits('100', 18));
    await token.connect(memberB).approve(await templ.getAddress(), ethers.parseUnits('100', 18));
    await templ.connect(memberB).join();

    const iface = templ.interface;
    const func = iface.getFunction('setPostQuorumVotingPeriodDAO');
    const selector = func.selector;
    const params = ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [100_000]);
    await templ
      .connect(memberB)
      .createProposalCallExternal(await templ.getAddress(), 0, selector, params, 0, 'Set delay', 'Bump delay');
    const proposalB = (await templ.proposalCount()) - 1n;

    // Fast forward past the short default delay to execute proposal B first.
    await ethers.provider.send('evm_increaseTime', [3]);
    await ethers.provider.send('evm_mine', []);
    await templ.executeProposal(proposalB);

    // Now global delay is large. Executing proposal A should still succeed based on its stored endTime.
    await expect(templ.executeProposal(proposalId)).to.not.be.reverted;
  });
});
