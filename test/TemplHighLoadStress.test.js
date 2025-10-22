const { expect } = require("chai");
const hre = require("hardhat");

const { ethers } = hre;
const { deployTemplModules } = require("./utils/modules");
const { getTemplAt, attachTemplInterface } = require("./utils/templ");

// @load – this suite is intentionally heavy. It validates that
// high-member scenarios do not cause gas blowups and core actions keep working.

const MAX_ENTRY_FEE = (1n << 128n) - 1n;
const TOTAL_PERCENT_BPS = 10_000n;
const VOTING_PERIOD_SECONDS = 7 * 24 * 60 * 60;
const CurveStyle = { Static: 0, Linear: 1, Exponential: 2 };
const METADATA = {
  name: "Saturation Templ",
  description: "High-load stress test",
  logo: "https://templ.test/saturation.png"
};

// Allow configuring join count via env for super heavy runs
const TOTAL_JOINS = Number(process.env.STRESS_JOINS || 500);
const STRESS_VOTE_ALL = (process.env.STRESS_VOTE_ALL === '1' || process.env.STRESS_VOTE_ALL === 'true');
const STRESS_VOTE_COUNT = process.env.STRESS_VOTE_COUNT ? Number(process.env.STRESS_VOTE_COUNT) : 0;

function progressEvery(total) {
  const step = Math.max(1, Math.ceil(total / 10));
  return { step };
}

// Ensures the proposer holds enough access tokens and allowance to cover the proposal fee
async function ensureProposalFee(templ, token, proposer, context) {
  const feeBps = await templ.proposalCreationFeeBps();
  if (feeBps === 0n) return;
  const currentEntryFee = await templ.entryFee();
  const expectedFee = (currentEntryFee * feeBps) / 10_000n;
  const templAddress = await templ.getAddress();
  const bal = await token.balanceOf(proposer.address);
  if (bal < expectedFee) {
    await token.connect(context.priest).mint(proposer.address, expectedFee - bal);
  }
  // Make sure proposer has ETH for gas, in case of custom providers
  const ethBal = await ethers.provider.getBalance(proposer.address);
  if (ethBal < ethers.parseEther("0.1")) {
    await context.priest.sendTransaction({ to: proposer.address, value: ethers.parseEther("1") });
  }
  await token.connect(proposer).approve(templAddress, expectedFee);
}

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
    1_000, // 1% protocol share
    1, // 0.01% quorum to keep voting cheap under load
    1, // 1 second execution delay
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

  // Seed the priest with budget to fund joins-for for random wallets
  const totalBudget = MAX_ENTRY_FEE * BigInt(TOTAL_JOINS);
  await token.connect(priest).mint(priest.address, totalBudget);
  await token.connect(priest).approve(templAddress, ethers.MaxUint256);

  const joinTargets = accessibleMembers.map((m) => m.address);
  const randomWallets = [];
  const additionalMembers = TOTAL_JOINS - accessibleMembers.length;
  const genProg = progressEvery(additionalMembers);
  for (let i = 0; i < additionalMembers; i += 1) {
    const wallet = ethers.Wallet.createRandom().connect(ethers.provider);
    randomWallets.push(wallet);
    joinTargets.push(wallet.address);
    if ((i + 1) % genProg.step === 0) {
      const pct = Math.ceil(((i + 1) * 100) / Math.max(1, additionalMembers));
      console.log(`[load] generated wallets: ${i + 1}/${additionalMembers} (${pct}%)`);
    }
  }

  const joinProg = progressEvery(joinTargets.length);
  for (let i = 0; i < joinTargets.length; i += 1) {
    const target = joinTargets[i];
    await templ.connect(priest).joinFor(target);
    if ((i + 1) % joinProg.step === 0) {
      const pct = Math.ceil(((i + 1) * 100) / Math.max(1, joinTargets.length));
      console.log(`[load] joins completed: ${i + 1}/${joinTargets.length} (${pct}%)`);
    }
  }

  expect(await templ.totalJoins()).to.equal(TOTAL_JOINS);

  return { templ, token, priest, protocolFeeRecipient, accessibleMembers, randomWallets };
}

describe("@load Templ High-Load Stress", function () {
  // Disable timeouts for large env-configured runs
  this.timeout(0);

  it("deploys successfully via the factory and respects bytecode limits", async function () {
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
      ["TEMPL.sol", "TEMPL", "templ router"],
      ["TemplMembership.sol", "TemplMembershipModule", "membership module"],
      ["TemplTreasury.sol", "TemplTreasuryModule", "treasury module"],
      ["TemplGovernance.sol", "TemplGovernanceModule", "governance module"]
    ];
    const limit = 24_576;
    const sizes = await Promise.all(contractArtifacts.map(async ([file, name]) => {
      const artifactPath = require("path").join(artifactBase, file, `${name}.json`);
      const artifact = JSON.parse(require("fs").readFileSync(artifactPath, "utf8"));
      const deployedBytecode = artifact.deployedBytecode || "0x";
      return (deployedBytecode.length - 2) / 2;
    }));

    const labels = contractArtifacts.map(([, , label]) => label);
    const diagnostics = labels.map((label, index) => `${label}: ${sizes[index]} bytes`).join(", ");
    console.log(`templ bytecode footprint → ${diagnostics}`);

    for (let index = 0; index < sizes.length; index += 1) {
      expect(sizes[index], `module ${labels[index]} exceeds deployment limit`).to.be.at.most(limit);
    }
  });

  describe("with many members", function () {
    let context;

    // Helper to reach quorum by casting the minimum additional YES votes,
    // or cast many votes when STRESS_VOTE_ALL/COUNT is set.
    async function ensureQuorum(templ, proposalId) {
      const quorumBps = await templ.quorumBps();
      const memberCount = await templ.memberCount();
      let requiredYesVotes = (quorumBps * memberCount + (TOTAL_PERCENT_BPS - 1n)) / TOTAL_PERCENT_BPS;
      if (requiredYesVotes < 1n) requiredYesVotes = 1n;
      // proposer auto-votes + one accessible member already voted in these flows
      let remainingVotes = requiredYesVotes - 2n;
      const totalPool = context.randomWallets.length;
      let votesToCast = 0;
      if (STRESS_VOTE_ALL) {
        votesToCast = totalPool;
      } else if (STRESS_VOTE_COUNT > 0) {
        votesToCast = Math.min(STRESS_VOTE_COUNT, totalPool);
      } else {
        votesToCast = Number(remainingVotes > 0n ? remainingVotes : 0n);
      }
      if (votesToCast <= 0) return;
      const gasTopUp = ethers.parseEther("0.05");
      const voterWallets = context.randomWallets.slice(0, votesToCast);
      const voteProg = progressEvery(voterWallets.length);
      for (let i = 0; i < voterWallets.length; i += 1) {
        const wallet = voterWallets[i];
        await context.priest.sendTransaction({ to: wallet.address, value: gasTopUp });
        await templ.connect(wallet).vote(proposalId, true);
        if ((i + 1) % voteProg.step === 0) {
          const pct = Math.ceil(((i + 1) * 100) / Math.max(1, voterWallets.length));
          console.log(`[load] votes cast: ${i + 1}/${voterWallets.length} (${pct}%)`);
        }
      }
    }

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

    it("supports core governance actions (withdraw, execute, disband, claim)", async function () {
      const { templ, token, priest, accessibleMembers, randomWallets } = context;
      const tokenAddress = await token.getAddress();
      const withdrawRecipient = accessibleMembers[1];

      let treasuryBalanceBefore = await templ.treasuryBalance();
      expect(treasuryBalanceBefore).to.be.gt(0n);

      let withdrawAmount = treasuryBalanceBefore / 10n;
      if (withdrawAmount === 0n) withdrawAmount = 1n;

      const withdrawProposalId = await templ.connect(priest).createProposalWithdrawTreasury.staticCall(
        tokenAddress,
        withdrawRecipient.address,
        withdrawAmount,
        "stress withdraw",
        0,
        "Stress Withdraw",
        "Exercise treasury withdrawal under maximal membership"
      );

      await templ.connect(priest).createProposalWithdrawTreasury(
        tokenAddress,
        withdrawRecipient.address,
        withdrawAmount,
        "stress withdraw",
        0,
        "Stress Withdraw",
        "Exercise treasury withdrawal under maximal membership"
      );

      await templ.connect(accessibleMembers[0]).vote(withdrawProposalId, true);

      const quorumBps = await templ.quorumBps();
      const memberCount = await templ.memberCount();
      let requiredYesVotes = (quorumBps * memberCount + (TOTAL_PERCENT_BPS - 1n)) / TOTAL_PERCENT_BPS;
      if (requiredYesVotes < 1n) requiredYesVotes = 1n;
      const votesAlreadyCast = 2n; // proposer auto-votes + accessible member above
      let remainingVotes = requiredYesVotes - votesAlreadyCast;
      if (remainingVotes < 0n) remainingVotes = 0n;

      const voterWallets = randomWallets.slice(0, Number(remainingVotes));
      const gasTopUp = ethers.parseEther("0.05");
      const voteProg = progressEvery(voterWallets.length);
      for (let i = 0; i < voterWallets.length; i += 1) {
        const wallet = voterWallets[i];
        await priest.sendTransaction({ to: wallet.address, value: gasTopUp });
        await templ.connect(wallet).vote(withdrawProposalId, true);
        if ((i + 1) % voteProg.step === 0) {
          const pct = Math.ceil(((i + 1) * 100) / Math.max(1, voterWallets.length));
          console.log(`[load] votes cast: ${i + 1}/${voterWallets.length} (${pct}%)`);
        }
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

      await templ.connect(priest).createProposalDisbandTreasury(
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

    it("handles metadata, fees, referrals, and external calls under load", async function () {
      const { templ, token, priest, accessibleMembers } = context;
      const tokenAddress = await token.getAddress();

      // Metadata update
      await templ.connect(accessibleMembers[0]).createProposalUpdateMetadata(
        "StressMeta",
        "Under load",
        "https://stress/logo",
        0,
        "Meta",
        ""
      );
      let id = (await templ.proposalCount()) - 1n;
      await templ.connect(accessibleMembers[1]).vote(id, true);
      await ensureQuorum(templ, id);
      await ethers.provider.send("evm_increaseTime", [2]);
      await ethers.provider.send("evm_mine");
      await templ.executeProposal(id);
      expect(await templ.templName()).to.equal("StressMeta");

      // Proposal fee becomes non-zero, then charged on next proposal creation
      await templ.connect(accessibleMembers[0]).createProposalSetProposalFeeBps(600, 0, "Fee", "");
      id = (await templ.proposalCount()) - 1n;
      await templ.connect(accessibleMembers[1]).vote(id, true);
      await ensureQuorum(templ, id);
      await ethers.provider.send("evm_increaseTime", [2]);
      await ethers.provider.send("evm_mine");
      await templ.executeProposal(id);
      expect(await templ.proposalCreationFeeBps()).to.equal(600n);

      const currentEntryFee = await templ.entryFee();
      const expectedFee = (currentEntryFee * 600n) / 10_000n;
      const treasuryBefore = await templ.treasuryBalance();
      // Pay proposal fee by creating a trivial referral share proposal
      const bal = await token.balanceOf(accessibleMembers[0].address);
      if (bal < expectedFee) {
        await token.connect(priest).mint(accessibleMembers[0].address, expectedFee - bal);
      }
      await token.connect(accessibleMembers[0]).approve(await templ.getAddress(), expectedFee);
      await templ.connect(accessibleMembers[0]).createProposalSetReferralShareBps(1_000, 0, "Referral", "");
      const treasuryAfter = await templ.treasuryBalance();
      expect(treasuryAfter - treasuryBefore).to.equal(expectedFee);

      // Execute referral proposal and perform referral join
      id = (await templ.proposalCount()) - 1n;
      await templ.connect(accessibleMembers[1]).vote(id, true);
      await ensureQuorum(templ, id);
      await ethers.provider.send("evm_increaseTime", [2]);
      await ethers.provider.send("evm_mine");
      await templ.executeProposal(id);
      expect(await templ.referralShareBps()).to.equal(1_000n);

      // Referral join with a fresh wallet
      const newcomer = ethers.Wallet.createRandom().connect(ethers.provider);
      await token.connect(priest).mint(newcomer.address, currentEntryFee);
      // Fund ETH for gas
      await priest.sendTransaction({ to: newcomer.address, value: ethers.parseEther("0.1") });
      await token.connect(newcomer).approve(await templ.getAddress(), currentEntryFee);
      const before = await token.balanceOf(accessibleMembers[0].address);
      await templ.connect(newcomer).joinWithReferral(accessibleMembers[0].address);
      expect(await token.balanceOf(accessibleMembers[0].address)).to.be.gt(before);

      // External call proposal to a target contract
      const Target = await ethers.getContractFactory("contracts/mocks/ExternalCallTarget.sol:ExternalCallTarget");
      const target = await Target.deploy();
      await target.waitForDeployment();
      const sel = target.interface.getFunction("setNumber").selector;
      const params = ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [123n]);
      await ensureProposalFee(templ, token, accessibleMembers[0], context);
      await templ.connect(accessibleMembers[0]).createProposalCallExternal(
        await target.getAddress(),
        0,
        sel,
        params,
        0,
        "Call",
        ""
      );
      id = (await templ.proposalCount()) - 1n;
      await templ.connect(accessibleMembers[1]).vote(id, true);
      await ensureQuorum(templ, id);
      await ethers.provider.send("evm_increaseTime", [2]);
      await ethers.provider.send("evm_mine");
      await templ.executeProposal(id);
      expect(await target.storedValue()).to.equal(123n);
    });

    it("updates fee split and entry fee curve; handles member cap toggles", async function () {
      const { templ, accessibleMembers, token } = context;

      // Update fee split only (keep entry fee unchanged to satisfy curve/base constraints)
      const newBurn = 3_500, newTreasury = 3_000, newMember = 2_500; // with protocol (1%) totals 100%
      const current = await templ.entryFee();
      const newEntry = 0n; // leave entry fee unchanged
      await ensureProposalFee(templ, token, accessibleMembers[0], context);
      await templ.connect(accessibleMembers[0]).createProposalUpdateConfig(
        ethers.ZeroAddress,
        newEntry,
        newBurn,
        newTreasury,
        newMember,
        true,
        0,
        "Cfg",
        ""
      );
      let id = (await templ.proposalCount()) - 1n;
      await templ.connect(accessibleMembers[1]).vote(id, true);
      await ensureQuorum(templ, id);
      await ethers.provider.send("evm_increaseTime", [2]);
      await ethers.provider.send("evm_mine");
      await templ.executeProposal(id);
      expect(await templ.burnBps()).to.equal(BigInt(newBurn));
      expect(await templ.treasuryBps()).to.equal(BigInt(newTreasury));
      expect(await templ.memberPoolBps()).to.equal(BigInt(newMember));
      expect(await templ.entryFee()).to.equal(current);

      // Update curve and verify entry fee moves (base unchanged when zero)
      const newCurve = { primary: { style: CurveStyle.Exponential, rateBps: 12_000, length: 0 }, additionalSegments: [] };
      await ensureProposalFee(templ, token, accessibleMembers[0], context);
      await templ.connect(accessibleMembers[0]).createProposalSetEntryFeeCurve(newCurve, 0, 0, "Curve", "");
      id = (await templ.proposalCount()) - 1n;
      await templ.connect(accessibleMembers[1]).vote(id, true);
      await ensureQuorum(templ, id);
      await ethers.provider.send("evm_increaseTime", [2]);
      await ethers.provider.send("evm_mine");
      await expect(templ.executeProposal(id)).to.emit(templ, "EntryFeeCurveUpdated");

      // Toggle member cap to current count (should auto-pause), then remove cap
      const count = await templ.memberCount();
      await ensureProposalFee(templ, token, accessibleMembers[0], context);
      await templ.connect(accessibleMembers[0]).createProposalSetMaxMembers(count, 0, "Cap", "");
      id = (await templ.proposalCount()) - 1n;
      await templ.connect(accessibleMembers[1]).vote(id, true);
      await ensureQuorum(templ, id);
      await ethers.provider.send("evm_increaseTime", [2]);
      await ethers.provider.send("evm_mine");
      await templ.executeProposal(id);
      expect(await templ.maxMembers()).to.equal(count);
      expect(await templ.joinPaused()).to.equal(true);

      await ensureProposalFee(templ, token, accessibleMembers[0], context);
      await templ.connect(accessibleMembers[0]).createProposalSetMaxMembers(0, 0, "Uncap", "");
      id = (await templ.proposalCount()) - 1n;
      await templ.connect(accessibleMembers[1]).vote(id, true);
      await ensureQuorum(templ, id);
      await ethers.provider.send("evm_increaseTime", [2]);
      await ethers.provider.send("evm_mine");
      await templ.executeProposal(id);
      expect(await templ.maxMembers()).to.equal(0n);
    });
  });
});
