const { expect } = require("chai");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, joinMembers } = require("./utils/mintAndPurchase");

describe("Split accounting stress (treasury info + referral across config changes)", function () {
  const ENTRY_FEE = ethers.parseUnits("100", 18);
  const DAY = 24 * 60 * 60;
  const BPS = 10_000n;

  function split(price, { burn, treasury, member, protocol }) {
    const burnAmt = (price * BigInt(burn)) / BPS;
    const memberAmt = (price * BigInt(member)) / BPS;
    const protocolAmt = (price * BigInt(protocol)) / BPS;
    const treasuryAmt = price - burnAmt - memberAmt - protocolAmt;
    return { burnAmt, memberAmt, treasuryAmt, protocolAmt };
  }

  it("keeps getTreasuryInfo consistent across many joins and post‑governance config changes", async function () {
    const referralShareBps = 1_500; // 15% of memberPool slice
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE, referralShareBps });
    const [, priest, a, b, c, d, e] = accounts;

    await mintToUsers(token, [a, b, c, d, e], ENTRY_FEE * 100n);

    const burnAddr = await templ.burnAddress();
    const proto = await templ.protocolFeeRecipient();

    // Stage 1: default 30/30/30/10; joins: A (no referral), B (refers to A), C (self-referral ignored)
    const cfg1 = {
      burn: Number(await templ.burnBps()),
      treasury: Number(await templ.treasuryBps()),
      member: Number(await templ.memberPoolBps()),
      protocol: Number(await templ.protocolBps()),
    };

    const t0 = await templ.getTreasuryInfo();
    const burned0 = t0[3];
    const proto0 = await token.balanceOf(proto);
    const burn0 = await token.balanceOf(burnAddr);

    // A joins
    const sA = split(ENTRY_FEE, cfg1);
    await token.connect(a).approve(await templ.getAddress(), ENTRY_FEE);
    const txA = await templ.connect(a).join();
    await expect(txA)
      .to.emit(templ, "MemberJoined")
      .withArgs(
        a.address,
        a.address,
        ENTRY_FEE,
        sA.burnAmt,
        sA.treasuryAmt,
        sA.memberAmt,
        sA.protocolAmt,
        anyValue,
        anyValue,
        anyValue
      );
    let info = await templ.getTreasuryInfo();
    expect(info[0]).to.equal(sA.treasuryAmt); // treasury available
    expect(info[1]).to.equal(sA.memberAmt);   // member pool
    expect(info[3]).to.equal(burned0 + sA.burnAmt); // burned cumulative
    expect(await token.balanceOf(proto)).to.equal(proto0 + sA.protocolAmt);
    expect(await token.balanceOf(burnAddr)).to.equal(burn0 + sA.burnAmt);

    // B joins with referral to A
    const sB = split(ENTRY_FEE, cfg1);
    const referralB = (sB.memberAmt * BigInt(referralShareBps)) / BPS;
    await token.connect(b).approve(await templ.getAddress(), ENTRY_FEE);
    const txB = await templ.connect(b).joinWithReferral(a.address);
    await expect(txB)
      .to.emit(templ, "MemberJoined")
      .withArgs(
        b.address,
        b.address,
        ENTRY_FEE,
        sB.burnAmt,
        sB.treasuryAmt,
        sB.memberAmt,
        sB.protocolAmt,
        anyValue,
        anyValue,
        anyValue
      );
    await expect(txB)
      .to.emit(templ, "ReferralRewardPaid")
      .withArgs(a.address, b.address, referralB);
    
    info = await templ.getTreasuryInfo();
    expect(info[0]).to.equal(sA.treasuryAmt + sB.treasuryAmt);
    expect(info[1]).to.equal(sA.memberAmt + (sB.memberAmt - referralB));
    expect(await token.balanceOf(a.address)).to.be.gte(referralB); // exact match since A had 0 before from pool
    expect(info[3]).to.equal(burned0 + sA.burnAmt + sB.burnAmt);
    expect(await token.balanceOf(proto)).to.equal(proto0 + sA.protocolAmt + sB.protocolAmt);

    // C joins with self-referral (ignored)
    const sC = split(ENTRY_FEE, cfg1);
    await token.connect(c).approve(await templ.getAddress(), ENTRY_FEE);
    const txC = await templ.connect(c).joinWithReferral(c.address);
    await expect(txC)
      .to.emit(templ, "MemberJoined")
      .withArgs(
        c.address,
        c.address,
        ENTRY_FEE,
        sC.burnAmt,
        sC.treasuryAmt,
        sC.memberAmt,
        sC.protocolAmt,
        anyValue,
        anyValue,
        anyValue
      );
    
    info = await templ.getTreasuryInfo();
    expect(info[0]).to.equal(sA.treasuryAmt + sB.treasuryAmt + sC.treasuryAmt);
    expect(info[1]).to.equal(sA.memberAmt + (sB.memberAmt - referralB) + sC.memberAmt);
    expect(info[3]).to.equal(burned0 + sA.burnAmt + sB.burnAmt + sC.burnAmt);

    // Stage 2: governance updates fee split to 20/45/25 keeping protocol 10
    const NEW = { burn: 2000, treasury: 4500, member: 2500, protocol: cfg1.protocol };
    await templ.connect(a).createProposalUpdateConfig(0, NEW.burn, NEW.treasury, NEW.member, true, 7 * DAY, "split", "");
    let pid = (await templ.proposalCount()) - 1n;
    await templ.connect(b).vote(pid, true);
    await ethers.provider.send("evm_increaseTime", [7 * DAY + 1]);
    await ethers.provider.send("evm_mine", []);
    await templ.executeProposal(pid);
    expect(await templ.burnBps()).to.equal(BigInt(NEW.burn));
    expect(await templ.treasuryBps()).to.equal(BigInt(NEW.treasury));
    expect(await templ.memberPoolBps()).to.equal(BigInt(NEW.member));

    // D joins with referral to A under new split
    const sD = split(ENTRY_FEE, NEW);
    const referralD = (sD.memberAmt * BigInt(referralShareBps)) / BPS;
    await token.connect(d).approve(await templ.getAddress(), ENTRY_FEE);
    const txD = await templ.connect(d).joinWithReferral(a.address);
    await expect(txD)
      .to.emit(templ, "MemberJoined")
      .withArgs(
        d.address,
        d.address,
        ENTRY_FEE,
        sD.burnAmt,
        sD.treasuryAmt,
        sD.memberAmt,
        sD.protocolAmt,
        anyValue,
        anyValue,
        anyValue
      );
    await expect(txD)
      .to.emit(templ, "ReferralRewardPaid")
      .withArgs(a.address, d.address, referralD);
    
    info = await templ.getTreasuryInfo();
    const expectedTreas = sA.treasuryAmt + sB.treasuryAmt + sC.treasuryAmt + sD.treasuryAmt;
    const expectedPool = sA.memberAmt + (sB.memberAmt - referralB) + sC.memberAmt + (sD.memberAmt - referralD);
    const expectedBurn = burned0 + sA.burnAmt + sB.burnAmt + sC.burnAmt + sD.burnAmt;
    const expectedProto = proto0 + sA.protocolAmt + sB.protocolAmt + sC.protocolAmt + sD.protocolAmt;
    expect(info[0]).to.equal(expectedTreas);
    expect(info[1]).to.equal(expectedPool);
    expect(info[3]).to.equal(expectedBurn);
    expect(await token.balanceOf(proto)).to.equal(expectedProto);

    // Stage 3: set referral share to 0 via governance; E joins (no referral paid, full pool credited)
    await templ.connect(b).createProposalSetReferralShareBps(0, 7 * DAY, "ref=0", "");
    pid = (await templ.proposalCount()) - 1n;
    await templ.connect(c).vote(pid, true);
    await ethers.provider.send("evm_increaseTime", [7 * DAY + 1]);
    await ethers.provider.send("evm_mine", []);
    await templ.executeProposal(pid);
    expect(await templ.referralShareBps()).to.equal(0n);

    const sE = split(ENTRY_FEE, NEW);
    await token.connect(e).approve(await templ.getAddress(), ENTRY_FEE);
    const txE = await templ.connect(e).joinWithReferral(a.address);
    await expect(txE)
      .to.emit(templ, "MemberJoined")
      .withArgs(
        e.address,
        e.address,
        ENTRY_FEE,
        sE.burnAmt,
        sE.treasuryAmt,
        sE.memberAmt,
        sE.protocolAmt,
        anyValue,
        anyValue,
        anyValue
      );
    
    info = await templ.getTreasuryInfo();
    expect(info[0]).to.equal(expectedTreas + sE.treasuryAmt);
    expect(info[1]).to.equal(expectedPool + sE.memberAmt); // full pool credited; referral is zero now
    expect(info[3]).to.equal(expectedBurn + sE.burnAmt);
    expect(await token.balanceOf(proto)).to.equal(expectedProto + sE.protocolAmt);
  });
});
