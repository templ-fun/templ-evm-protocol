const { expect } = require("chai");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers } = require("./utils/mintAndPurchase");

describe("JoinFor variants", function () {
  const ENTRY_FEE = ethers.parseUnits("100", 18);

  it("joinFor charges payer and enrolls recipient", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, , payer, recipient] = accounts;

    await mintToUsers(token, [payer], ENTRY_FEE * 2n);
    await token.connect(payer).approve(await templ.getAddress(), ENTRY_FEE);

    const burnBps = await templ.burnBps();
    const memberPoolBps = await templ.memberPoolBps();
    const protocolBps = await templ.protocolBps();
    const burnAmount = (ENTRY_FEE * burnBps) / 10_000n;
    const memberPoolAmount = (ENTRY_FEE * memberPoolBps) / 10_000n;
    const protocolAmount = (ENTRY_FEE * protocolBps) / 10_000n;
    const treasuryAmount = ENTRY_FEE - burnAmount - memberPoolAmount - protocolAmount;

    const payerBefore = await token.balanceOf(payer.address);
    const poolBefore = await templ.memberPoolBalance();

    const tx = await templ.connect(payer).joinFor(recipient.address);
    await expect(tx)
      .to.emit(templ, "MemberJoined")
      .withArgs(
        payer.address,
        recipient.address,
        ENTRY_FEE,
        burnAmount,
        treasuryAmount,
        memberPoolAmount,
        protocolAmount,
        anyValue,
        anyValue,
        anyValue
      );

    expect(await token.balanceOf(payer.address)).to.equal(payerBefore - ENTRY_FEE);
    expect(await templ.isMember(recipient.address)).to.equal(true);
    expect(await templ.isMember(payer.address)).to.equal(false);
    expect(await templ.memberPoolBalance()).to.equal(poolBefore + memberPoolAmount);
  });

  it("joinForWithReferral pays referral and credits recipient", async function () {
    const referralShareBps = 2_000;
    const { templ, token, accounts } = await deployTempl({
      entryFee: ENTRY_FEE,
      referralShareBps,
    });
    const [, , sponsor, referrer, recipient] = accounts;

    await mintToUsers(token, [sponsor, referrer], ENTRY_FEE * 5n);
    await token.connect(referrer).approve(await templ.getAddress(), ENTRY_FEE);
    await templ.connect(referrer).join();

    const burnBps = await templ.burnBps();
    const memberPoolBps = await templ.memberPoolBps();
    const protocolBps = await templ.protocolBps();
    const burnAmount = (ENTRY_FEE * burnBps) / 10_000n;
    const memberPoolAmount = (ENTRY_FEE * memberPoolBps) / 10_000n;
    const protocolAmount = (ENTRY_FEE * protocolBps) / 10_000n;
    const treasuryAmount = ENTRY_FEE - burnAmount - memberPoolAmount - protocolAmount;
    const referralAmount = (memberPoolAmount * BigInt(referralShareBps)) / 10_000n;

    const poolBefore = await templ.memberPoolBalance();
    const sponsorBefore = await token.balanceOf(sponsor.address);
    const referrerBefore = await token.balanceOf(referrer.address);

    await token.connect(sponsor).approve(await templ.getAddress(), ENTRY_FEE);
    const tx = await templ.connect(sponsor).joinForWithReferral(recipient.address, referrer.address);

    await expect(tx)
      .to.emit(templ, "MemberJoined")
      .withArgs(
        sponsor.address,
        recipient.address,
        ENTRY_FEE,
        burnAmount,
        treasuryAmount,
        memberPoolAmount,
        protocolAmount,
        anyValue,
        anyValue,
        anyValue
      )
      .and.to.emit(templ, "ReferralRewardPaid")
      .withArgs(referrer.address, recipient.address, referralAmount);

    expect(await templ.isMember(recipient.address)).to.equal(true);
    expect(await token.balanceOf(sponsor.address)).to.equal(sponsorBefore - ENTRY_FEE);
    expect(await token.balanceOf(referrer.address)).to.equal(referrerBefore + referralAmount);
    expect(await templ.memberPoolBalance()).to.equal(poolBefore + (memberPoolAmount - referralAmount));
  });

  it("joinForWithMaxEntryFee honors the max entry fee", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, , payer, recipient] = accounts;

    await mintToUsers(token, [payer], ENTRY_FEE * 2n);
    await token.connect(payer).approve(await templ.getAddress(), ENTRY_FEE);

    const payerBefore = await token.balanceOf(payer.address);
    await templ.connect(payer).joinForWithMaxEntryFee(recipient.address, ENTRY_FEE);

    expect(await templ.isMember(recipient.address)).to.equal(true);
    expect(await token.balanceOf(payer.address)).to.equal(payerBefore - ENTRY_FEE);
  });
});
