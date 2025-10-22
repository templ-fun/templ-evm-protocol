const { expect } = require("chai");
const hre = require("hardhat");
const { ethers } = hre;

const { deployTempl } = require("../utils/deploy");
const { attachTemplInterface } = require("../utils/templ");

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

describe("@fuzz Config BPS split property", function () {
  this.timeout(90_000);

  let templ, priest;
  const FUZZ_ITERS = (() => {
    const v = Number(process.env.TEMPL_BPS_FUZZ_ITERS || process.env.FUZZ_ITERS || 100);
    return Number.isFinite(v) && v > 0 ? v : 100;
  })();
  const SEED = (() => {
    const raw = process.env.TEMPL_BPS_FUZZ_SEED || process.env.FUZZ_SEED;
    if (!raw) return Date.now() >>> 0;
    const n = Number(raw);
    if (Number.isFinite(n)) return n >>> 0;
    let h = 2166136261 >>> 0;
    for (let i = 0; i < String(raw).length; i++) {
      h ^= String(raw).charCodeAt(i);
      h = Math.imul(h, 16777619);
      h >>>= 0;
    }
    return h >>> 0;
  })();
  let rng;

  before(async function () {
    ({ templ, priest } = await deployTempl());
    templ = await attachTemplInterface(templ);
    rng = mulberry32(SEED);
  });

  it("updates to random valid splits and preserves sum=100%", async function () {
    for (let i = 0; i < FUZZ_ITERS; i++) {
      const protocol = await templ.protocolBps();
      const available = 10_000n - protocol;
      // Random composition of available into three non-negative integers (burn, treasury, member)
      const a = BigInt(seededRandInt(rng, Number(available) + 1));
      const b = BigInt(seededRandInt(rng, Number(available - a) + 1));
      const burn = a;
      const treasury = b;
      const member = available - a - b;

      await templ.connect(priest).createProposalUpdateConfig(
        ethers.ZeroAddress, // leave token unchanged
        0, // keep entryFee unchanged
        burn,
        treasury,
        member,
        true, // update fee split
        0,
        "cfg",
        "fuzz"
      );
      const id = (await templ.proposalCount()) - 1n;

      // With one member the proposer's auto-vote should reach quorum
      const delay = await templ.executionDelayAfterQuorum();
      await ethers.provider.send("evm_increaseTime", [Number(delay) + 1]);
      await ethers.provider.send("evm_mine");

      await templ.executeProposal(id);

      const burn2 = await templ.burnBps();
      const tre2 = await templ.treasuryBps();
      const mem2 = await templ.memberPoolBps();
      const pro2 = await templ.protocolBps();

      expect(burn2).to.equal(burn);
      expect(tre2).to.equal(treasury);
      expect(mem2).to.equal(member);
      expect(burn2 + tre2 + mem2 + pro2).to.equal(10_000n);
    }
  });
});

