const { expect } = require("chai");
const hre = require("hardhat");
const { ethers } = hre;

const { deployTempl } = require("../utils/deploy");
const { attachTemplInterface } = require("../utils/templ");

// Basic seeded PRNG (mulberry32)
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededRandInt(rng, maxExclusive) {
  return Math.floor(rng() * maxExclusive);
}

function pick(rng, arr) {
  return arr[seededRandInt(rng, arr.length)];
}

function randomString(rng, min = 3, max = 16) {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const len = min + seededRandInt(rng, Math.max(1, max - min + 1));
  let s = "";
  for (let i = 0; i < len; i++) s += chars[seededRandInt(rng, chars.length)];
  return s;
}

// JS version of MAX_ENTRY_FEE from contracts (uint128 max)
const MAX_ENTRY_FEE_JS = (1n << 128n) - 1n;

describe("@fuzz Randomized Governance + Membership", function () {
  this.timeout(180_000);

  let templ, token, accounts, priest;
  let allActors; // array of signers used as candidate actors
  let rng;

  const FUZZ_ITERS = (() => {
    const v = Number(process.env.TEMPL_FUZZ_ITERS || 200);
    return Number.isFinite(v) && v > 0 ? v : 200;
  })();
  const FUZZ_SEED = (() => {
    const raw = process.env.TEMPL_FUZZ_SEED;
    if (!raw) return Date.now() >>> 0;
    const n = Number(raw);
    if (Number.isFinite(n)) return n >>> 0;
    // fold string into a 32-bit seed
    let h = 2166136261 >>> 0;
    for (let i = 0; i < String(raw).length; i++) {
      h ^= String(raw).charCodeAt(i);
      h = Math.imul(h, 16777619);
      h >>>= 0;
    }
    return h >>> 0;
  })();

  before(async function () {
    ({ templ, token, accounts, priest } = await deployTempl());
    templ = await attachTemplInterface(templ);
    allActors = accounts.slice(0, Math.min(32, accounts.length));
    rng = mulberry32(FUZZ_SEED);
  });

  it("executes randomized actions and preserves invariants", async function () {
    const templAddress = await templ.getAddress();

    // Track known members among our actor set for cross-checking
    const knownMembers = new Set();
    // The priest is an initial member
    knownMembers.add((await priest.getAddress()).toLowerCase());

    // Active proposals created by our test (subset of all proposals)
    const activeProposals = new Set();

    async function isMember(addr) {
      return await templ.isMember(addr);
    }

    async function ensureTokenBalance(actor) {
      const fee = await templ.entryFee();
      const bal = await token.balanceOf(actor.address);
      if (bal < fee) {
        // Anyone can mint on TestToken
        await token.connect(priest).mint(actor.address, fee - bal);
      }
      const allowance = await token.allowance(actor.address, templAddress);
      if (allowance < fee) {
        await token.connect(actor).approve(templAddress, ethers.MaxUint256);
      }
    }

    async function actJoin() {
      const actor = pick(rng, allActors);
      const addr = (await actor.getAddress()).toLowerCase();
      if (await isMember(addr)) {
        return; // already a member; skip
      }
      await ensureTokenBalance(actor);
      try {
        await templ.connect(actor).join();
        knownMembers.add(addr);
      } catch (_) {
        // join may legitimately revert (e.g., paused or cap); ignore in fuzz
      }
    }

    async function actCreateMetadataProposal() {
      const proposer = pick(rng, allActors);
      const proposerAddr = (await proposer.getAddress()).toLowerCase();
      if (!(await isMember(proposerAddr))) return; // only members can propose
      try {
        await templ.connect(proposer).createProposalUpdateMetadata(
          `F-${randomString(rng, 3, 10)}`,
          randomString(rng, 0, 12),
          `https://x/${randomString(rng, 3, 8)}`,
          0,
          "meta",
          "fuzz"
        );
        const id = (await templ.proposalCount()) - 1n;
        activeProposals.add(id.toString());
      } catch (_) {
        // proposer might be locked with an active proposal; ignore
      }
    }

    async function actCreateReferralProposal() {
      const proposer = pick(rng, allActors);
      const proposerAddr = (await proposer.getAddress()).toLowerCase();
      if (!(await isMember(proposerAddr))) return;
      // 0..2000 bps
      const bps = BigInt(seededRandInt(rng, 2001));
      try {
        await templ.connect(proposer).createProposalSetReferralShareBps(bps, 0, "ref", "fuzz");
        const id = (await templ.proposalCount()) - 1n;
        activeProposals.add(id.toString());
      } catch (_) {}
    }

    async function actVote() {
      if (activeProposals.size === 0) return;
      const ids = Array.from(activeProposals).map((x) => BigInt(x));
      const id = ids[seededRandInt(rng, ids.length)];
      const voter = pick(rng, allActors);
      const voterAddr = (await voter.getAddress()).toLowerCase();
      if (!(await isMember(voterAddr))) return;
      try {
        await templ.connect(voter).vote(id, rng() < 0.85); // mostly YES
      } catch (_) {
        // may not be eligible due to snapshot rules; ignore
      }
    }

    async function actTick() {
      const secs = 1 + seededRandInt(rng, 5 * 24 * 60 * 60);
      await ethers.provider.send("evm_increaseTime", [secs]);
      await ethers.provider.send("evm_mine");
    }

    async function actExecute() {
      if (activeProposals.size === 0) return;
      const ids = Array.from(activeProposals).map((x) => BigInt(x));
      const id = ids[seededRandInt(rng, ids.length)];
      try {
        await templ.executeProposal(id);
        activeProposals.delete(id.toString());
      } catch (_) {
        // Not yet past delay or not enough quorum; ignore
      }
    }

    async function checkInvariants() {
      // Fee split sums to 100%
      const burn = await templ.burnBps();
      const treas = await templ.treasuryBps();
      const member = await templ.memberPoolBps();
      const protocol = await templ.protocolBps();
      expect(burn + treas + member + protocol).to.equal(10_000n);

      // Entry fee never exceeds cap
      const fee = await templ.entryFee();
      expect(fee).to.be.lte(MAX_ENTRY_FEE_JS);

      // Our known members are actually members on-chain; memberCount is >= known size
      for (const m of knownMembers) {
        expect(await templ.isMember(m)).to.equal(true);
      }
      const onchainCount = await templ.memberCount();
      expect(onchainCount).to.be.gte(BigInt(knownMembers.size));
    }

    // Main fuzz loop
    for (let i = 0; i < FUZZ_ITERS; i++) {
      const roll = rng();
      if (roll < 0.40) {
        await actJoin();
      } else if (roll < 0.60) {
        await actCreateMetadataProposal();
      } else if (roll < 0.80) {
        await actCreateReferralProposal();
      } else if (roll < 0.90) {
        await actVote();
      } else if (roll < 0.95) {
        await actExecute();
      } else {
        await actTick();
      }

      // Periodically tick time to allow executions to unlock
      if ((i + 1) % 25 === 0) {
        await actTick();
      }

      // Check invariants regularly
      if ((i + 1) % 10 === 0) {
        await checkInvariants();
      }
    }

    // Final invariant check
    await checkInvariants();
  });
});
