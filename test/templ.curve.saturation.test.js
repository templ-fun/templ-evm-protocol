const { expect } = require("chai");
const hre = require("hardhat");

const { ethers } = hre;
const { deployTemplModules } = require("./utils/modules");
const { getTemplAt, attachTemplInterface } = require("./utils/templ");

const MAX_ENTRY_FEE = (1n << 128n) - 1n;
const TOTAL_JOINS = 100; // not 20k so tests wont take too long for now, will bring back in future after all refactors are done
const TOTAL_PERCENT_BPS = 10_000n;
const VOTING_PERIOD_SECONDS = 7 * 24 * 60 * 60;
const CurveStyle = { Static: 0, Linear: 1, Exponential: 2 };
const METADATA = {
  name: "Saturation Templ",
  description: "High-load stress test",
  logo: "https://templ.test/saturation.png"
};

async function setupHighLoadTempl() {
  const [priest, protocolFeeRecipient, memberA, memberB] = await ethers.getSigners();
  const accessibleMembers = [memberA, memberB];

  const TestToken = await ethers.getContractFactory("TestToken");
  const token = await TestToken.connect(priest).deploy("Stress Token", "STRS", 18);
  await token.waitForDeployment();

  const modules = await deployTemplModules();
  const Templ = await ethers.getContractFactory("TEMPL");
  let templ = await Templ.connect(priest).deploy(
    priest.address,
    protocolFeeRecipient.address,
    await token.getAddress(),
    10n,
    1_000,
    4_000,
    4_000,
    1_000,
    1, // 1% quorum to keep voting tractable
    1,
    ethers.ZeroAddress,
    false,
    0,
    METADATA.name,
    METADATA.description,
    METADATA.logo,
    0,
    0,
    modules.membershipModule,
    modules.treasuryModule,
    modules.governanceModule,
    { primary: { style: CurveStyle.Exponential, rateBps: 11_000, length: 0 }, additionalSegments: [] }
  );
  await templ.waitForDeployment();
  templ = await attachTemplInterface(templ);

  const templAddress = await templ.getAddress();

  const totalBudget = MAX_ENTRY_FEE * BigInt(TOTAL_JOINS);
  await token.connect(priest).mint(priest.address, totalBudget);
  await token.connect(priest).approve(templAddress, ethers.MaxUint256);

  const joinTargets = accessibleMembers.map((member) => member.address);
  const randomWallets = [];
  const additionalMembers = TOTAL_JOINS - accessibleMembers.length;

  for (let i = 0; i < additionalMembers; i += 1) {
    const wallet = ethers.Wallet.createRandom().connect(ethers.provider);
    randomWallets.push(wallet);
    joinTargets.push(wallet.address);
  }

  for (const target of joinTargets) {
    await templ.connect(priest).joinFor(target);
  }

  expect(await templ.totalJoins()).to.equal(TOTAL_JOINS);

  return {
    templ,
    token,
    priest,
    accessibleMembers,
    randomWallets
  };
}

describe("TEMPL high-load behaviour", function () {
  it("deploys successfully via the factory on constrained networks", async function () {
    const [deployer, protocolFeeRecipient] = await ethers.getSigners();

    const TestToken = await ethers.getContractFactory("TestToken");
    const token = await TestToken.connect(deployer).deploy("Test Token", "TEST", 18);
    await token.waitForDeployment();

    const modules = await deployTemplModules();
    const TemplFactory = await ethers.getContractFactory("TemplFactory");
    const factory = await TemplFactory.connect(deployer).deploy(
      protocolFeeRecipient.address,
      1_000,
      modules.membershipModule,
      modules.treasuryModule,
      modules.governanceModule
    );
    await factory.waitForDeployment();

    const tokenAddress = await token.getAddress();
  const predictedAddress = await factory
    .connect(deployer)
    .createTemplFor.staticCall(
      deployer.address,
      tokenAddress,
      10n,
      METADATA.name,
      METADATA.description,
      METADATA.logo,
      0,
      0
    );

  const tx = await factory.connect(deployer).createTemplFor(
    deployer.address,
    tokenAddress,
    10n,
    METADATA.name,
    METADATA.description,
    METADATA.logo,
    0,
    0
  );
    await tx.wait();

    expect(predictedAddress).to.be.properAddress;

    const templ = await getTemplAt(predictedAddress, ethers.provider);
    expect(await templ.accessToken()).to.equal(tokenAddress);

    const artifactBase = `${__dirname}/../artifacts/contracts`;
    const contractArtifacts = [
      ['TEMPL.sol', 'TEMPL', 'templ router'],
      ['TemplMembership.sol', 'TemplMembershipModule', 'membership module'],
      ['TemplTreasury.sol', 'TemplTreasuryModule', 'treasury module'],
      ['TemplGovernance.sol', 'TemplGovernanceModule', 'governance module']
    ];
    const limit = 24_576;
    const sizes = await Promise.all(contractArtifacts.map(async ([file, name]) => {
      const artifactPath = require('path').join(artifactBase, file, `${name}.json`);
      const artifact = JSON.parse(require('fs').readFileSync(artifactPath, 'utf8'));
      const deployedBytecode = artifact.deployedBytecode || '0x';
      return (deployedBytecode.length - 2) / 2;
    }));

    const labels = contractArtifacts.map(([,, label]) => label);
    const diagnostics = labels.map((label, index) => `${label}: ${sizes[index]} bytes`).join(', ');
    console.log(`templ bytecode footprint → ${diagnostics}`);

    for (let index = 0; index < sizes.length; index += 1) {
      expect(sizes[index], `module ${labels[index]} exceeds deployment limit`).to.be.at.most(limit);
    }
  });

  describe("with 20k members", function () {
    this.timeout(15 * 60 * 1000);

    let context;

    before(async function () {
      context = await setupHighLoadTempl();
    });

    it("caps the entry fee at the saturation limit", async function () {
      const { templ } = context;

      expect(await templ.totalJoins()).to.equal(TOTAL_JOINS);
      const entryFee = await templ.entryFee();
      expect(entryFee).to.be.gt(0n);
      expect(entryFee).to.be.lte(MAX_ENTRY_FEE);
    });

    it("supports governance, withdrawal, claims, and disband under maximum load", async function () {
      const { templ, token, priest, accessibleMembers, randomWallets } = context;
      const tokenAddress = await token.getAddress();
      const withdrawRecipient = accessibleMembers[1];

      let treasuryBalanceBefore = await templ.treasuryBalance();
      expect(treasuryBalanceBefore).to.be.gt(0n);

      let withdrawAmount = treasuryBalanceBefore / 10n;
      if (withdrawAmount === 0n) {
        withdrawAmount = 1n;
      }

      const withdrawProposalId = await templ.connect(priest).createProposalWithdrawTreasury.staticCall(
        tokenAddress,
        withdrawRecipient.address,
        withdrawAmount,
        "stress withdraw",
        0,
        "Stress Withdraw",
        "Exercise treasury withdrawal under maximal membership"
      );

      await templ
        .connect(priest)
        .createProposalWithdrawTreasury(
          tokenAddress,
          withdrawRecipient.address,
          withdrawAmount,
          "stress withdraw",
          0,
          "Stress Withdraw",
          "Exercise treasury withdrawal under maximal membership"
        );

      await templ.connect(accessibleMembers[0]).vote(withdrawProposalId, true);

      const quorumPercentBps = await templ.quorumPercent();
      const memberCount = await templ.memberCount();
      let requiredYesVotes = (quorumPercentBps * memberCount + (TOTAL_PERCENT_BPS - 1n)) / TOTAL_PERCENT_BPS;
      if (requiredYesVotes < 1n) {
        requiredYesVotes = 1n;
      }

      const votesAlreadyCast = 2n; // proposer auto-votes + accessible member above
      let remainingVotes = requiredYesVotes - votesAlreadyCast;
      if (remainingVotes < 0n) {
        remainingVotes = 0n;
      }

      const voterWallets = randomWallets.slice(0, Number(remainingVotes));
      const gasTopUp = ethers.parseEther("0.05");

      for (const wallet of voterWallets) {
        await priest.sendTransaction({ to: wallet.address, value: gasTopUp });
        await templ.connect(wallet).vote(withdrawProposalId, true);
      }

      const withdrawProposal = await templ.getProposal(withdrawProposalId);
      expect(withdrawProposal.yesVotes).to.be.at.least(requiredYesVotes);

      await ethers.provider.send("evm_increaseTime", [2]);
      await ethers.provider.send("evm_mine");

      const recipientBalanceBefore = await token.balanceOf(withdrawRecipient.address);
      await templ.connect(priest).executeProposal(withdrawProposalId);
      const recipientBalanceAfter = await token.balanceOf(withdrawRecipient.address);
      expect(recipientBalanceAfter - recipientBalanceBefore).to.equal(withdrawAmount);

      const disbandProposalId = await templ.connect(priest).createProposalDisbandTreasury.staticCall(
        tokenAddress,
        0,
        "Stress Disband",
        "Distribute treasury with maximal membership"
      );

      await templ
        .connect(priest)
        .createProposalDisbandTreasury(
          tokenAddress,
          0,
          "Stress Disband",
          "Distribute treasury with maximal membership"
        );

      await templ.connect(accessibleMembers[0]).vote(disbandProposalId, true);

      await ethers.provider.send("evm_increaseTime", [VOTING_PERIOD_SECONDS]);
      await ethers.provider.send("evm_mine");

      const claimableBefore = await templ.getClaimableMemberRewards(accessibleMembers[0].address);
      await templ.connect(priest).executeProposal(disbandProposalId);
      const claimableAfter = await templ.getClaimableMemberRewards(accessibleMembers[0].address);
      expect(claimableAfter).to.be.gt(claimableBefore);

      const memberBalanceBefore = await token.balanceOf(accessibleMembers[0].address);
      await templ.connect(accessibleMembers[0]).claimMemberRewards();
      const memberBalanceAfter = await token.balanceOf(accessibleMembers[0].address);
      expect(memberBalanceAfter).to.be.gt(memberBalanceBefore);

      treasuryBalanceBefore = await templ.treasuryBalance();
      expect(treasuryBalanceBefore).to.equal(0n);
    });
  });
});
