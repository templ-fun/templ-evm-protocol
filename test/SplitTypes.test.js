const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, joinMembers } = require("./utils/mintAndPurchase");

describe("Split types (30/30/30 and 90/0/0 variants)", function () {
  const ENTRY_FEE = ethers.parseUnits("100", 18);
  const BPS = 10_000n;
  const pct = (n) => BigInt(n) * 100n; // express % as bps

  async function doJoin(templ, token, member) {
    await token.connect(member).approve(await templ.getAddress(), ENTRY_FEE);
    const tx = await templ.connect(member).join();
    return tx.wait();
  }

  it("30/30/30 splits with 10% protocol", async function () {
    const { templ, token, accounts } = await deployTempl({
      entryFee: ENTRY_FEE,
      burnBps: pct(30), treasuryBps: pct(30), memberPoolBps: pct(30), protocolBps: pct(10)
    });
    const [, , member] = accounts;
    await mintToUsers(token, [member], ENTRY_FEE);

    const burnAddress = await templ.burnAddress();
    const protocolRecipient = await templ.protocolFeeRecipient();
    const burnBefore = await token.balanceOf(burnAddress);
    const protocolBefore = await token.balanceOf(protocolRecipient);
    const poolBefore = await templ.memberPoolBalance();
    const treasuryBefore = await templ.treasuryBalance();

    const receipt = await doJoin(templ, token, member);
    const evt = receipt.logs.map((l)=>{try{return templ.interface.parseLog(l);}catch(_){return null;}}).find(x=>x&&x.name==="MemberJoined");
    expect(evt).to.not.equal(undefined);

    const burn = (ENTRY_FEE * pct(30)) / BPS;
    const pool = (ENTRY_FEE * pct(30)) / BPS;
    const protocol = (ENTRY_FEE * pct(10)) / BPS;
    const treasury = ENTRY_FEE - burn - pool - protocol;

    expect(evt.args.burnedAmount).to.equal(burn);
    expect(evt.args.memberPoolAmount).to.equal(pool);
    expect(evt.args.protocolAmount).to.equal(protocol);
    expect(evt.args.treasuryAmount).to.equal(treasury);

    expect(await token.balanceOf(burnAddress)).to.equal(burnBefore + burn);
    expect(await token.balanceOf(protocolRecipient)).to.equal(protocolBefore + protocol);
    expect(await templ.memberPoolBalance()).to.equal(poolBefore + pool);
    expect(await templ.treasuryBalance()).to.equal(treasuryBefore + treasury);
  });

  it("90/0/0 with burn only", async function () {
    const { templ, token, accounts } = await deployTempl({
      entryFee: ENTRY_FEE,
      burnBps: pct(90), treasuryBps: 0, memberPoolBps: 0, protocolBps: pct(10)
    });
    const [, , member] = accounts;
    await mintToUsers(token, [member], ENTRY_FEE);

    const burnAddress = await templ.burnAddress();
    const protocolRecipient = await templ.protocolFeeRecipient();
    const burnBefore = await token.balanceOf(burnAddress);
    const protocolBefore = await token.balanceOf(protocolRecipient);
    const poolBefore = await templ.memberPoolBalance();
    const treasuryBefore = await templ.treasuryBalance();

    const receipt = await doJoin(templ, token, member);
    const evt = receipt.logs.map((l)=>{try{return templ.interface.parseLog(l);}catch(_){return null;}}).find(x=>x&&x.name==="MemberJoined");
    expect(evt).to.not.equal(undefined);

    const burn = (ENTRY_FEE * pct(90)) / BPS;
    const pool = 0n;
    const protocol = (ENTRY_FEE * pct(10)) / BPS;
    const treasury = 0n;

    expect(evt.args.burnedAmount).to.equal(burn);
    expect(evt.args.memberPoolAmount).to.equal(pool);
    expect(evt.args.protocolAmount).to.equal(protocol);
    expect(evt.args.treasuryAmount).to.equal(treasury);

    expect(await token.balanceOf(burnAddress)).to.equal(burnBefore + burn);
    expect(await token.balanceOf(protocolRecipient)).to.equal(protocolBefore + protocol);
    expect(await templ.memberPoolBalance()).to.equal(poolBefore + pool);
    expect(await templ.treasuryBalance()).to.equal(treasuryBefore + treasury);
  });

  it("90/0/0 with treasury only", async function () {
    const { templ, token, accounts } = await deployTempl({
      entryFee: ENTRY_FEE,
      burnBps: 0, treasuryBps: pct(90), memberPoolBps: 0, protocolBps: pct(10)
    });
    const [, , member] = accounts;
    await mintToUsers(token, [member], ENTRY_FEE);

    const burnAddress = await templ.burnAddress();
    const protocolRecipient = await templ.protocolFeeRecipient();
    const burnBefore = await token.balanceOf(burnAddress);
    const protocolBefore = await token.balanceOf(protocolRecipient);
    const poolBefore = await templ.memberPoolBalance();
    const treasuryBefore = await templ.treasuryBalance();

    const receipt = await doJoin(templ, token, member);
    const evt = receipt.logs.map((l)=>{try{return templ.interface.parseLog(l);}catch(_){return null;}}).find(x=>x&&x.name==="MemberJoined");
    expect(evt).to.not.equal(undefined);

    const burn = 0n;
    const pool = 0n;
    const protocol = (ENTRY_FEE * pct(10)) / BPS;
    const treasury = (ENTRY_FEE * pct(90)) / BPS;

    expect(evt.args.burnedAmount).to.equal(burn);
    expect(evt.args.memberPoolAmount).to.equal(pool);
    expect(evt.args.protocolAmount).to.equal(protocol);
    expect(evt.args.treasuryAmount).to.equal(treasury);

    expect(await token.balanceOf(burnAddress)).to.equal(burnBefore + burn);
    expect(await token.balanceOf(protocolRecipient)).to.equal(protocolBefore + protocol);
    expect(await templ.memberPoolBalance()).to.equal(poolBefore + pool);
    expect(await templ.treasuryBalance()).to.equal(treasuryBefore + treasury);
  });

  it("90/0/0 with member pool only", async function () {
    const { templ, token, accounts } = await deployTempl({
      entryFee: ENTRY_FEE,
      burnBps: 0, treasuryBps: 0, memberPoolBps: pct(90), protocolBps: pct(10)
    });
    const [, , referrer, member] = accounts;
    await mintToUsers(token, [referrer, member], ENTRY_FEE * 2n);
    await joinMembers(templ, token, [referrer]);

    const burnAddress = await templ.burnAddress();
    const protocolRecipient = await templ.protocolFeeRecipient();
    const burnBefore = await token.balanceOf(burnAddress);
    const protocolBefore = await token.balanceOf(protocolRecipient);
    const poolBefore = await templ.memberPoolBalance();
    const treasuryBefore = await templ.treasuryBalance();

    const receipt = await doJoin(templ, token, member);
    const evt = receipt.logs.map((l)=>{try{return templ.interface.parseLog(l);}catch(_){return null;}}).find(x=>x&&x.name==="MemberJoined");
    expect(evt).to.not.equal(undefined);

    const burn = 0n;
    const pool = (ENTRY_FEE * pct(90)) / BPS;
    const protocol = (ENTRY_FEE * pct(10)) / BPS;
    const treasury = 0n;

    expect(evt.args.burnedAmount).to.equal(burn);
    expect(evt.args.memberPoolAmount).to.equal(pool);
    expect(evt.args.protocolAmount).to.equal(protocol);
    expect(evt.args.treasuryAmount).to.equal(treasury);

    expect(await token.balanceOf(burnAddress)).to.equal(burnBefore + burn);
    expect(await token.balanceOf(protocolRecipient)).to.equal(protocolBefore + protocol);
    expect(await templ.memberPoolBalance()).to.equal(poolBefore + pool);
    expect(await templ.treasuryBalance()).to.equal(treasuryBefore + treasury);
  });
});

