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
    const [, priest] = accounts;

    // Deploy harness-like TEMPL with modules to allow direct onlyDAO wrappers via self-call.
    const Token = await ethers.getContractFactory('contracts/mocks/TestToken.sol:TestToken');
    const token = await Token.deploy('Test', 'TEST', 18);
    await token.waitForDeployment();

    const { membershipModule, treasuryModule, governanceModule } = await deployTemplModules();

    // Use 7 days default execution delay (matching harness), that’s fine — we warp time.
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
      7 * 24 * 60 * 60,
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

    // Enable dictatorship via self-call wrapper so priest can call onlyDAO externals directly.
    // Use the treasury wrapper exposed on the merged ABI.
    await templ.daoSetDictatorship(true);

    // Reduce global delay to 0 after quorum.
    await templ.connect(priest).setExecutionDelayAfterQuorumDAO(0);

    // Try to execute immediately (well before stored endTime). Should revert ExecutionDelayActive.
    await expect(templ.executeProposal(proposalId)).to.be.revertedWithCustomError(
      templ,
      'ExecutionDelayActive'
    );

    // Warp time to just past the stored endTime and execute successfully.
    const now = (await ethers.provider.getBlock('latest')).timestamp;
    const wait = Number(endTime) - now + 1;
    await ethers.provider.send('evm_increaseTime', [wait]);
    await ethers.provider.send('evm_mine', []);
    await templ.executeProposal(proposalId);
  });
});

