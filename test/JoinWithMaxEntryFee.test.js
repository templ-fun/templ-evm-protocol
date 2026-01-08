const { expect } = require("chai");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers } = require("./utils/mintAndPurchase");

describe("Join max-entry-fee variants", function () {
  const ENTRY_FEE = ethers.parseUnits("100", 18);

  it("reverts when maxEntryFee is below the current entry fee", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, , payer, recipient, referrer] = accounts;

    await mintToUsers(token, [payer], ENTRY_FEE * 5n);
    await token.connect(payer).approve(await templ.getAddress(), ENTRY_FEE * 5n);

    const tooLow = ENTRY_FEE - 1n;
    const cases = [
      { name: "joinWithMaxEntryFee", args: [tooLow] },
      { name: "joinWithReferralMaxEntryFee", args: [referrer.address, tooLow] },
      { name: "joinForWithMaxEntryFee", args: [recipient.address, tooLow] },
      { name: "joinForWithReferralMaxEntryFee", args: [recipient.address, referrer.address, tooLow] },
    ];

    for (const testCase of cases) {
      await expect(
        templ.connect(payer)[testCase.name](...testCase.args)
      ).to.be.revertedWithCustomError(templ, "EntryFeeTooHigh");
    }
  });

  it("charges payer, credits recipient, and pays referral on joinForWithReferralMaxEntryFee", async function () {
    const referralShareBps = 2000;
    const { templ, token, accounts } = await deployTempl({
      entryFee: ENTRY_FEE,
      referralShareBps,
    });
    const [, , sponsor, referrer, recipient] = accounts;

    await mintToUsers(token, [sponsor, referrer], ENTRY_FEE * 10n);

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

    const tx = await templ
      .connect(sponsor)
      .joinForWithReferralMaxEntryFee(recipient.address, referrer.address, ENTRY_FEE);

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
});
