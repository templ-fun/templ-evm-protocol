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

// Single knob for load size.
// Example: TEMPL_LOAD=1000000 npm run test:load
const LOAD_ENV = process.env.TEMPL_LOAD;
const TOTAL_JOINS = Number.isFinite(Number(LOAD_ENV)) && Number(LOAD_ENV) > 0 ? Number(LOAD_ENV) : 500;

// Optional knobs for proposal volume and external token fanout under load
const LOAD_PROPOSALS_ENV = process.env.TEMPL_LOAD_PROPOSALS;
const LOAD_TOKENS_ENV = process.env.TEMPL_LOAD_TOKENS;
const MAX_PROPOSAL_TARGET = 200; // safety guard for CI runtime
const DEFAULT_TOKEN_FANOUT = 12; // reasonable default to exercise pagination/iteration

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
    1, // 1% quorum (percent mode) to keep voting cheap under load
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

  // Memory‑lean joiner generation:
  // - Join the two accessible members first (if within TOTAL_JOINS)
  // - Generate additional ephemeral wallets on the fly; only keep up to the
  //   max voters we’ll ever need for quorum so 1M joiners stays feasible.
  const randomWallets = [];
  const expectedMembers = Math.max(0, TOTAL_JOINS);
  const maxVotersWeMayNeed = Math.max(10, Math.ceil(expectedMembers / 100)); // ~1% quorum

  let joined = 0;
  const joinProg = progressEvery(expectedMembers);

  // Join the accessible members first
  for (const m of accessibleMembers) {
    if (joined >= expectedMembers) break;
    await templ.connect(priest).joinFor(m.address);
    joined += 1;
    if (joined % joinProg.step === 0) {
      const pct = Math.ceil((joined * 100) / Math.max(1, expectedMembers));
      console.log(`[load] joins completed: ${joined}/${expectedMembers} (${pct}%)`);
    }
  }

  // Join remaining members with ephemeral wallets
  const additionalMembers = Math.max(0, expectedMembers - joined);
  for (let i = 0; i < additionalMembers; i += 1) {
    const wallet = ethers.Wallet.createRandom().connect(ethers.provider);
    // Keep only as many wallets as we might use for voting later
    if (randomWallets.length < maxVotersWeMayNeed) {
      randomWallets.push(wallet);
    }
    await templ.connect(priest).joinFor(wallet.address);
    joined += 1;
    if (joined % joinProg.step === 0) {
      const pct = Math.ceil((joined * 100) / Math.max(1, expectedMembers));
      console.log(`[load] joins completed: ${joined}/${expectedMembers} (${pct}%)`);
    }
  }

  expect(await templ.totalJoins()).to.equal(TOTAL_JOINS);

  return { templ, token, priest, protocolFeeRecipient, accessibleMembers, randomWallets };
}

describe("@load Templ High-Load Stress", function () {
  // Disable timeouts for large env-configured runs
  this.timeout(0);

  // Bytecode size limit test moved to test/BytecodeSizeLimit.test.js so it runs in default npm test

  describe("with many members", function () {
    let context;

    // Helper to reach quorum and ensure YES > NO by casting the minimum additional YES votes.
    async function ensureQuorum(templ, proposalId) {
      const quorumBps = await templ.quorumBps();
      const memberCount = await templ.memberCount();
      let requiredYesByQuorum = (quorumBps * memberCount + (TOTAL_PERCENT_BPS - 1n)) / TOTAL_PERCENT_BPS;
      if (requiredYesByQuorum < 1n) requiredYesByQuorum = 1n;

      // Read current yes/no to ensure we also satisfy YES > NO
      const prop = await templ.getProposal(proposalId);
      let yes = BigInt(prop[1]);
      const no = BigInt(prop[2]);
      const targetYes = yes >= requiredYesByQuorum ? (no + 1n > yes ? no + 1n : yes) : (no + 1n > requiredYesByQuorum ? no + 1n : requiredYesByQuorum);
      let remaining = targetYes > yes ? targetYes - yes : 0n;
      if (remaining <= 0n) return;

      const gasTopUp = ethers.parseEther("0.05");
      // Build a robust candidate voter set: random wallets then accessible members, finally priest
      const candidates = [...context.randomWallets, ...context.accessibleMembers, context.priest];
      const voteProg = progressEvery(Number(remaining));
      let cast = 0;
      for (let i = 0; i < candidates.length && yes < targetYes; i += 1) {
        const w = candidates[i];
        const addr = w.address || (await w.getAddress());
        // Skip if already voted
        const voted = await templ.hasVoted(proposalId, addr);
        if (voted[0]) continue;
        try {
          await context.priest.sendTransaction({ to: addr, value: gasTopUp });
          await templ.connect(w).vote(proposalId, true);
          yes += 1n;
          cast += 1;
          if (cast % voteProg.step === 0) {
            const pct = Math.ceil((cast * 100) / Number(remaining));
            console.log(`[load] votes cast: ${cast}/${remaining} (${pct}%)`);
          }
        } catch (_) {
          // Ignore NotMember/JoinedAfterProposal/AlreadyVoted; try next candidate
          continue;
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

      // Claim again should revert due to no rewards left
      await expect(templ.connect(accessibleMembers[0]).claimMemberRewards()).to.be.revertedWithCustomError(
        templ,
        "NoRewardsToClaim"
      );
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
      const hv = await templ.hasVoted(id, accessibleMembers[1].address);
      expect(hv[0]).to.equal(true);
      expect(hv[1]).to.equal(true);
      await ensureQuorum(templ, id);
      await ethers.provider.send("evm_increaseTime", [2]);
      await ethers.provider.send("evm_mine");
      await templ.executeProposal(id);
      expect(await templ.templName()).to.equal("StressMeta");

      // Inspect action payload and snapshots/join-sequences views
      const [action, payload] = await templ.getProposalActionData(id);
      // Action enum: SetMetadata = 7 per contracts/TemplBase.sol order
      expect(Number(action)).to.equal(7);
      const decoded = ethers.AbiCoder.defaultAbiCoder().decode(["string", "string", "string"], payload);
      expect(decoded[0]).to.equal("StressMeta");
      const snaps = await templ.getProposalSnapshots(id);
      expect(snaps[0]).to.be.gt(0n); // eligible voters pre-quorum
      const sequences = await templ.getProposalJoinSequences(id);
      expect(sequences[0]).to.be.gt(0n); // pre-quorum join sequence captured

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

    it("executes payable external calls with ETH value under load", async function () {
      const { templ, accessibleMembers, token, priest } = context;

      // Seed ETH so the templ can forward value in the external call
      await priest.sendTransaction({ to: await templ.getAddress(), value: ethers.parseEther("2") });

      const Target = await ethers.getContractFactory("contracts/mocks/ExternalCallTarget.sol:ExternalCallTarget");
      const target = await Target.deploy();
      await target.waitForDeployment();
      const sel = target.interface.getFunction("setNumberPayable").selector;
      const params = ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [777n]);

      const templAddr = await templ.getAddress();
      const ethBefore = await ethers.provider.getBalance(templAddr);

      await ensureProposalFee(templ, token, accessibleMembers[0], context);
      await templ
        .connect(accessibleMembers[0])
        .createProposalCallExternal(await target.getAddress(), ethers.parseEther("1"), sel, params, 0, "Payable", "");

      let id = (await templ.proposalCount()) - 1n;
      await templ.connect(accessibleMembers[1]).vote(id, true);
      await ensureQuorum(templ, id);
      await ethers.provider.send("evm_increaseTime", [2]);
      await ethers.provider.send("evm_mine");
      await templ.executeProposal(id);

      expect(await target.storedValue()).to.equal(777n);
      const ethAfter = await ethers.provider.getBalance(templAddr);
      expect(ethBefore - ethAfter).to.be.gte(ethers.parseEther("1"));
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

    it("explicitly pauses and resumes joins via governance under load", async function () {
      const { templ, accessibleMembers, priest, token } = context;
      // Pause joins
      await ensureProposalFee(templ, token, accessibleMembers[0], context);
      await templ.connect(accessibleMembers[0]).createProposalSetJoinPaused(true, 0, "Pause", "");
      let id = (await templ.proposalCount()) - 1n;
      await templ.connect(accessibleMembers[1]).vote(id, true);
      await ensureQuorum(templ, id);
      await ethers.provider.send("evm_increaseTime", [2]);
      await ethers.provider.send("evm_mine");
      await templ.executeProposal(id);
      expect(await templ.joinPaused()).to.equal(true);

      // Attempt to join while paused should revert
      const blocked = ethers.Wallet.createRandom().connect(ethers.provider);
      await expect(templ.connect(priest).joinFor(blocked.address)).to.be.revertedWithCustomError(templ, "JoinIntakePaused");

      // Resume joins
      await ensureProposalFee(templ, token, accessibleMembers[0], context);
      await templ.connect(accessibleMembers[0]).createProposalSetJoinPaused(false, 0, "Resume", "");
      id = (await templ.proposalCount()) - 1n;
      await templ.connect(accessibleMembers[1]).vote(id, true);
      await ensureQuorum(templ, id);
      await ethers.provider.send("evm_increaseTime", [2]);
      await ethers.provider.send("evm_mine");
      await templ.executeProposal(id);
      expect(await templ.joinPaused()).to.equal(false);

      // Now a join should succeed again
      const ok = ethers.Wallet.createRandom().connect(ethers.provider);
      await templ.connect(priest).joinFor(ok.address);
      expect(await templ.isMember(ok.address)).to.equal(true);
    });

    it("changes priest and exercises dictatorship-only gates under load", async function () {
      const { templ, accessibleMembers, token } = context;
      // Change priest
      await ensureProposalFee(templ, token, accessibleMembers[0], context);
      await templ.connect(accessibleMembers[0]).createProposalChangePriest(accessibleMembers[0].address, 0, "Priest", "");
      let id = (await templ.proposalCount()) - 1n;
      await templ.connect(accessibleMembers[1]).vote(id, true);
      await ensureQuorum(templ, id);
      await ethers.provider.send("evm_increaseTime", [2]);
      await ethers.provider.send("evm_mine");
      await templ.executeProposal(id);
      expect(await templ.priest()).to.equal(accessibleMembers[0].address);

      // Enable dictatorship
      await ensureProposalFee(templ, token, accessibleMembers[0], context);
      await templ.connect(accessibleMembers[0]).createProposalSetDictatorship(true, 0, "Dict", "");
      id = (await templ.proposalCount()) - 1n;
      await templ.connect(accessibleMembers[1]).vote(id, true);
      await ensureQuorum(templ, id);
      await ethers.provider.send("evm_increaseTime", [2]);
      await ethers.provider.send("evm_mine");
      await templ.executeProposal(id);
      expect(await templ.priestIsDictator()).to.equal(true);

      // Non-priest attempts to create a proposal should revert
      await expect(
        templ.connect(accessibleMembers[1]).createProposalUpdateMetadata("Nope", "", "", 0, "x", "")
      ).to.be.revertedWithCustomError(templ, "DictatorshipEnabled");

      // OnlyDAO: priest can act directly to pause joins
      await templ.connect(accessibleMembers[0]).setJoinPausedDAO(true);
      expect(await templ.joinPaused()).to.equal(true);

      // Priest disables dictatorship via onlyDAO to resume normal governance
      await templ.connect(accessibleMembers[0]).setDictatorshipDAO(false);
      expect(await templ.priestIsDictator()).to.equal(false);
    });

    it("distributes and claims external reward tokens under load", async function () {
      const { templ, priest, accessibleMembers } = context;
      // Deploy an external reward token
      const TestToken = await ethers.getContractFactory("TestToken");
      const reward = await TestToken.connect(priest).deploy("Reward", "REWARD", 18);
      await reward.waitForDeployment();
      const rewardAddr = await reward.getAddress();

      // Fund templ with an amount that divides evenly across members
      const members = await templ.memberCount();
      const perMember = ethers.parseUnits("1", 18);
      const total = perMember * members;
      await reward.connect(priest).mint(priest.address, total);
      await reward.connect(priest).transfer(await templ.getAddress(), total);

      // Disband external token into member rewards via governance (non‑priest proposer to avoid 7d wait)
      await ensureProposalFee(templ, context.token, accessibleMembers[1], context);
      await templ.connect(accessibleMembers[1]).createProposalDisbandTreasury(rewardAddr, 0, "DisbandExt", "");
      const id = (await templ.proposalCount()) - 1n;
      await templ.connect(accessibleMembers[0]).vote(id, true);
      await ensureQuorum(templ, id);
      await ethers.provider.send("evm_increaseTime", [2]);
      await ethers.provider.send("evm_mine");
      await templ.executeProposal(id);

      // One member claims their external reward share
      const tokens = await templ.getExternalRewardTokens();
      expect(tokens).to.include(rewardAddr);
      const [poolBalance, cumulative, remainder] = await templ.getExternalRewardState(rewardAddr);
      expect(poolBalance).to.be.gt(0n);
      expect(cumulative).to.be.gt(0n);
      const before = await reward.balanceOf(accessibleMembers[0].address);
      const claimable = await templ.getClaimableExternalReward(accessibleMembers[0].address, rewardAddr);
      expect(claimable).to.equal(perMember);
      await templ.connect(accessibleMembers[0]).claimExternalReward(rewardAddr);
      const after = await reward.balanceOf(accessibleMembers[0].address);
      expect(after - before).to.equal(perMember);

      // Attempt to cleanup external token while unsettled should revert on execution
      await ensureProposalFee(templ, context.token, accessibleMembers[0], context);
      await templ.connect(accessibleMembers[0]).createProposalCleanupExternalRewardToken(
        rewardAddr,
        0,
        "CleanupExt",
        ""
      );
      const cleanupId = (await templ.proposalCount()) - 1n;
      await templ.connect(accessibleMembers[1]).vote(cleanupId, true);
      await ensureQuorum(templ, cleanupId);
      await ethers.provider.send("evm_increaseTime", [2]);
      await ethers.provider.send("evm_mine");
      await expect(templ.executeProposal(cleanupId)).to.be.revertedWithCustomError(
        templ,
        "ExternalRewardsNotSettled"
      );
    });

    it("updates quorum and execution delay; updates burn address then verifies burn on next join", async function () {
      const { templ, accessibleMembers, priest, token } = context;

      // Set quorum to 1% (percent mode) and set 2s execution delay
      await ensureProposalFee(templ, token, accessibleMembers[0], context);
      await templ.connect(accessibleMembers[0]).createProposalSetQuorumBps(1, 0, "Quorum", "");
      let id = (await templ.proposalCount()) - 1n;
      await templ.connect(accessibleMembers[1]).vote(id, true);
      await ensureQuorum(templ, id);
      await ethers.provider.send("evm_increaseTime", [2]);
      await ethers.provider.send("evm_mine");
      await templ.executeProposal(id);
      // Using percent mode: 1 → multiplied by 100 inside, becomes 100 bps
      expect(await templ.quorumBps()).to.equal(100n);

      await ensureProposalFee(templ, token, accessibleMembers[0], context);
      await templ.connect(accessibleMembers[0]).createProposalSetExecutionDelay(2, 0, "Delay", "");
      id = (await templ.proposalCount()) - 1n;
      await templ.connect(accessibleMembers[1]).vote(id, true);
      await ensureQuorum(templ, id);
      await ethers.provider.send("evm_increaseTime", [2]);
      await ethers.provider.send("evm_mine");
      await templ.executeProposal(id);
      expect(await templ.executionDelayAfterQuorum()).to.equal(2n);

      // Change burn address to a known wallet and confirm next join burns to it
      const burner = ethers.Wallet.createRandom().connect(ethers.provider);
      await ensureProposalFee(templ, token, accessibleMembers[0], context);
      await templ.connect(accessibleMembers[0]).createProposalSetBurnAddress(burner.address, 0, "Burn", "");
      id = (await templ.proposalCount()) - 1n;
      await templ.connect(accessibleMembers[1]).vote(id, true);
      await ensureQuorum(templ, id);
      await ethers.provider.send("evm_increaseTime", [2]);
      await ethers.provider.send("evm_mine");
      await templ.executeProposal(id);
      expect(await templ.burnAddress()).to.equal(burner.address);

      // Ensure joins are not paused (cap test earlier may have auto-paused)
      if (await templ.joinPaused()) {
        await ensureProposalFee(templ, token, accessibleMembers[0], context);
        await templ.connect(accessibleMembers[0]).createProposalSetJoinPaused(false, 0, "Resume", "");
        id = (await templ.proposalCount()) - 1n;
        await templ.connect(accessibleMembers[1]).vote(id, true);
        await ensureQuorum(templ, id);
        await ethers.provider.send("evm_increaseTime", [2]);
        await ethers.provider.send("evm_mine");
        await templ.executeProposal(id);
        expect(await templ.joinPaused()).to.equal(false);
      }

      const entryFee = await templ.entryFee();
      const burnBps = await templ.burnBps();
      const expectedBurn = (entryFee * burnBps) / 10_000n;
      const beforeBurn = await token.balanceOf(burner.address);
      await templ.connect(priest).joinFor(ethers.Wallet.createRandom().connect(ethers.provider).address);
      const afterBurn = await token.balanceOf(burner.address);
      expect(afterBurn - beforeBurn).to.equal(expectedBurn);
    });

    it("manages active-proposals index and pagination; prunes inactive under load", async function () {
      const { templ, token, priest, accessibleMembers, randomWallets } = context;

      // Prepare a set of proposers (avoid wallets with active proposals)
      const candidates = [];
      // Prefer random wallets used only for voting (skip accessibleMembers which may have active leftovers)
      for (let i = 0; i < randomWallets.length && candidates.length < 8; i += 1) {
        const w = randomWallets[i];
        if (!(await templ.hasActiveProposal(w.address))) {
          candidates.push(w);
        }
      }
      // Fallback: use accessible members only if they don't have active proposals
      for (const m of accessibleMembers) {
        if (candidates.length >= 8) break;
        if (!(await templ.hasActiveProposal(m.address))) {
          candidates.push(m);
        }
      }
      let proposers = [...candidates];

      // Ensure each proposer can afford proposal fees
      for (const p of proposers) {
        await ensureProposalFee(templ, token, p, context);
      }

      // Create several proposals with different proposers
      const created = [];
      for (let i = 0; i < Math.min(6, proposers.length); i += 1) {
        const p = proposers[i];
        // Final guard against single-active-per-proposer
        if (await templ.hasActiveProposal(p.address)) {
          continue;
        }
        await templ.connect(p).createProposalUpdateMetadata(
          `Meta-${i}`,
          "",
          "",
          0,
          `m-${i}`,
          ""
        );
        const id = (await templ.proposalCount()) - 1n;
        created.push(id);
      }

      // Some get quorum and execute quickly (due to 2s delay from earlier test), others lapse
      const toExecute = created.slice(0, Math.ceil(created.length / 2));
      for (const id of toExecute) {
        await templ.connect(accessibleMembers[0]).vote(id, true);
        await templ.connect(accessibleMembers[1]).vote(id, true);
        await ensureQuorum(templ, id);
        // Defensive: double pass if still short
        let prop = await templ.getProposal(id);
        const yes = BigInt(prop[1]);
        const quorumBps = await templ.quorumBps();
        const memberCount = await templ.memberCount();
        const required = (quorumBps * memberCount + (TOTAL_PERCENT_BPS - 1n)) / TOTAL_PERCENT_BPS;
        if (yes < required) {
          await ensureQuorum(templ, id);
        }
        await ethers.provider.send("evm_increaseTime", [3]);
        await ethers.provider.send("evm_mine");
        await templ.executeProposal(id);
      }

      // The rest: fast-forward past default voting period so they become inactive
      await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
      await ethers.provider.send("evm_mine");

      // Pagination should show some actives (possibly zero if all executed/expired)
      const [page, hasMore] = await templ.getActiveProposalsPaginated(0, 5);
      expect(Array.isArray(page)).to.equal(true);

      // Prune everything
      const removedPreview = await templ.pruneInactiveProposals.staticCall(1000);
      if (removedPreview > 0n) {
        await templ.pruneInactiveProposals(1000);
      }
      const remaining = await templ.getActiveProposals();
      expect(remaining.length).to.equal(0);
    });

    it("withdraws ETH and an arbitrary ERC-20 from treasury under load", async function () {
      const { templ, priest, accessibleMembers, token } = context;
      // Seed ETH balance
      await priest.sendTransaction({ to: await templ.getAddress(), value: ethers.parseEther("5") });

      // Withdraw 1 ETH to member
      const recipient = accessibleMembers[1];
      const ethBefore = await ethers.provider.getBalance(recipient.address);
      await ensureProposalFee(templ, token, accessibleMembers[0], context);
      const idW = await templ.connect(accessibleMembers[0]).createProposalWithdrawTreasury.staticCall(
        ethers.ZeroAddress,
        recipient.address,
        ethers.parseEther("1"),
        "ETH withdraw",
        0,
        "ETH W",
        ""
      );
      await templ.connect(accessibleMembers[0]).createProposalWithdrawTreasury(
        ethers.ZeroAddress,
        recipient.address,
        ethers.parseEther("1"),
        "ETH withdraw",
        0,
        "ETH W",
        ""
      );
      await templ.connect(accessibleMembers[0]).vote(idW, true);
      await ensureQuorum(templ, idW);
      await ethers.provider.send("evm_increaseTime", [2]);
      await ethers.provider.send("evm_mine");
      await templ.executeProposal(idW);
      const ethAfter = await ethers.provider.getBalance(recipient.address);
      expect(ethAfter).to.be.gt(ethBefore);

      // Seed arbitrary ERC‑20 and withdraw half
      const TestToken = await ethers.getContractFactory("TestToken");
      const other = await TestToken.connect(priest).deploy("Other", "OTHR", 18);
      await other.waitForDeployment();
      const otherAddr = await other.getAddress();
      const amount = ethers.parseUnits("10000", 18);
      await other.connect(priest).mint(priest.address, amount);
      await other.connect(priest).transfer(await templ.getAddress(), amount);

      const half = amount / 2n;
      const balBefore = await other.balanceOf(recipient.address);
      await ensureProposalFee(templ, token, accessibleMembers[0], context);
      await templ
        .connect(accessibleMembers[0])
        .createProposalWithdrawTreasury(otherAddr, recipient.address, half, "ERC20 withdraw", 0, "ERC20 W", "");
      const id2 = (await templ.proposalCount()) - 1n;
      await templ.connect(context.accessibleMembers[0]).vote(id2, true);
      await ensureQuorum(templ, id2);
      await ethers.provider.send("evm_increaseTime", [2]);
      await ethers.provider.send("evm_mine");
      await templ.executeProposal(id2);
      const balAfter = await other.balanceOf(recipient.address);
      expect(balAfter - balBefore).to.equal(half);
    });

    it("creates many concurrent proposals across distinct proposers and paginates reliably", async function () {
      const { templ, token, priest, accessibleMembers, randomWallets } = context;

      // Decide a target based on load: scales gently up to MAX_PROPOSAL_TARGET, or use override
      const override = Number.isFinite(Number(LOAD_PROPOSALS_ENV)) && Number(LOAD_PROPOSALS_ENV) > 0 ? Number(LOAD_PROPOSALS_ENV) : undefined;
      const DEFAULT_TARGET = Math.max(10, Math.min(MAX_PROPOSAL_TARGET, Math.ceil(Math.sqrt(TOTAL_JOINS) / 10)));
      const TARGET = Math.min(override || DEFAULT_TARGET, MAX_PROPOSAL_TARGET);

      // Compose proposers from existing wallets only to avoid new joins under saturated fees
      const proposersBase = [...randomWallets, ...accessibleMembers];
      const proposers = proposersBase.slice(0, Math.min(TARGET, proposersBase.length));

      // Ensure fee coverage for all proposers
      for (const p of proposers) {
        await ensureProposalFee(templ, token, p, context);
      }

      // Batch-create concurrent proposals (1 per proposer, respecting single-active-per-proposer gate)
      const created = [];
      const prog = progressEvery(TARGET);
      const attempts = proposers.length;
      for (let i = 0; i < attempts; i += 1) {
        const p = proposers[i];
        const kind = i % 3;
        try {
          if (kind === 0) {
            await ensureProposalFee(templ, token, p, context);
            await templ.connect(p).createProposalUpdateMetadata(`Batch-${i}`, "", "", 0, `B-${i}`, "");
          } else if (kind === 1) {
            await ensureProposalFee(templ, token, p, context);
            await templ.connect(p).createProposalSetReferralShareBps(1_000, 0, `Ref-${i}`, "");
          } else {
            await ensureProposalFee(templ, token, p, context);
            await templ.connect(p).createProposalSetQuorumBps(1, 0, `Q-${i}`, "");
          }
          const id = (await templ.proposalCount()) - 1n;
          created.push(id);
        } catch (e) {
          // likely ActiveProposalExists; skip this proposer
          continue;
        }
        if ((i + 1) % prog.step === 0) {
          const pct = Math.ceil(((i + 1) * 100) / Math.max(1, attempts));
          console.log(`[load] proposals created: ${i + 1}/${attempts} (${pct}%)`);
        }
      }

      // Verify listing via pagination across pages of 25
      const limit = 25;
      let offset = 0;
      const seen = new Set();
      while (true) {
        const [page, hasMore] = await templ.getActiveProposalsPaginated(offset, limit);
        for (const id of page) {
          seen.add(id.toString());
        }
        if (!hasMore) break;
        offset += page.length;
      }

      for (const id of created) {
        if (!seen.has(id.toString())) {
          throw new Error(`missing proposal id ${id}`);
        }
      }

      const activeAll = await templ.getActiveProposals();
      expect(activeAll.length).to.be.gte(created.length);
    });

    it("disbands many distinct external tokens and enumerates claims under dictatorship", async function () {
      const { templ, priest, accessibleMembers } = context;

      // Enable dictatorship to call onlyDAO paths directly for throughput
      await ensureProposalFee(templ, context.token, accessibleMembers[0], context);
      await templ.connect(accessibleMembers[0]).createProposalSetDictatorship(true, 0, "DictOn", "");
      let id = (await templ.proposalCount()) - 1n;
      await templ.connect(accessibleMembers[1]).vote(id, true);
      await ensureQuorum(templ, id);
      await ethers.provider.send("evm_increaseTime", [2]);
      await ethers.provider.send("evm_mine");
      await templ.executeProposal(id);

      const members = await templ.memberCount();
      const tokenFanout = Number.isFinite(Number(LOAD_TOKENS_ENV)) && Number(LOAD_TOKENS_ENV) > 0 ? Math.min(Number(LOAD_TOKENS_ENV), 64) : DEFAULT_TOKEN_FANOUT;

      const TestToken = await ethers.getContractFactory("TestToken");
      const created = [];
      const perMember = ethers.parseUnits("1", 18);
      const totalPerToken = perMember * members;

      // Create N tokens, fund templ, and disband via onlyDAO
      for (let i = 0; i < tokenFanout; i += 1) {
        const t = await TestToken.connect(priest).deploy(`R${i}`, `R${i}`, 18);
        await t.waitForDeployment();
        const addr = await t.getAddress();
        await t.connect(priest).mint(priest.address, totalPerToken);
        await t.connect(priest).transfer(await templ.getAddress(), totalPerToken);
        await templ.connect(accessibleMembers[0]).disbandTreasuryDAO(addr);
        created.push({ token: t, address: addr });
      }

      // Verify enumeration via pagination and claim from a couple of tokens
      const [page, hasMore] = await templ.getExternalRewardTokensPaginated(0, 10);
      expect(page.length).to.be.lte(10);
      expect(hasMore).to.equal(tokenFanout > 10);

      // Claim from first and last token
      const before0 = await created[0].token.balanceOf(accessibleMembers[0].address);
      const claimable0 = await templ.getClaimableExternalReward(accessibleMembers[0].address, created[0].address);
      expect(claimable0).to.equal(perMember);
      await templ.connect(accessibleMembers[0]).claimExternalReward(created[0].address);
      const after0 = await created[0].token.balanceOf(accessibleMembers[0].address);
      expect(after0 - before0).to.equal(perMember);

      const last = created[created.length - 1];
      const beforeLast = await last.token.balanceOf(accessibleMembers[0].address);
      await templ.connect(accessibleMembers[0]).claimExternalReward(last.address);
      const afterLast = await last.token.balanceOf(accessibleMembers[0].address);
      expect(afterLast - beforeLast).to.equal(perMember);

      // Turn dictatorship back off to avoid leaking state across tests
      await templ.connect(accessibleMembers[0]).setDictatorshipDAO(false);
      expect(await templ.priestIsDictator()).to.equal(false);
    });
  });
});
