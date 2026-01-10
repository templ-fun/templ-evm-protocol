const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, joinMembers } = require("./utils/mintAndPurchase");

describe("Referral edge cases", function () {
  const ENTRY_FEE = ethers.parseUnits("100", 18);

  it("does not pay referral when the referral is not a member", async function () {
    const referralShare = 2_000; // 20% of member pool
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE, referralShareBps: referralShare });
    const [, , newcomer, outsider] = accounts;

    await mintToUsers(token, [newcomer], ENTRY_FEE * 2n);

    const poolBefore = await templ.memberPoolBalance();
    await token.connect(newcomer).approve(await templ.getAddress(), ENTRY_FEE);
    const receipt = await (await templ.connect(newcomer).joinWithReferral(outsider.address)).wait();

    // No referral event emitted when referral isn't a member
    const referralEvent = receipt.logs
      .map((log) => {
        try { return templ.interface.parseLog(log); } catch (_) { return null; }
      })
      .find((log) => log && log.name === "ReferralRewardPaid");
    expect(referralEvent).to.equal(undefined);

    // Entire member pool allocation remains in the pool
    const memberPoolAmount = (ENTRY_FEE * (await templ.memberPoolBps())) / 10_000n;
    const poolAfter = await templ.memberPoolBalance();
    expect(poolAfter - poolBefore).to.equal(memberPoolAmount);
  });

  it("does not pay referral when the referral equals the recipient (self-referral)", async function () {
    const referralShare = 2_000; // 20% of member pool
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE, referralShareBps: referralShare });
    const [, , newcomer] = accounts;

    await mintToUsers(token, [newcomer], ENTRY_FEE * 2n);

    const poolBefore = await templ.memberPoolBalance();
    await token.connect(newcomer).approve(await templ.getAddress(), ENTRY_FEE);
    const receipt = await (await templ.connect(newcomer).joinWithReferral(newcomer.address)).wait();

    // No referral event emitted for self-referral
    const referralEvent = receipt.logs
      .map((log) => {
        try { return templ.interface.parseLog(log); } catch (_) { return null; }
      })
      .find((log) => log && log.name === "ReferralRewardPaid");
    expect(referralEvent).to.equal(undefined);

    // Entire member pool allocation remains in the pool
    const memberPoolAmount = (ENTRY_FEE * (await templ.memberPoolBps())) / 10_000n;
    const poolAfter = await templ.memberPoolBalance();
    expect(poolAfter - poolBefore).to.equal(memberPoolAmount);
  });

  it("does not pay referral on joinForWithReferral when the referral is not a member", async function () {
    const referralShare = 2_000;
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE, referralShareBps: referralShare });
    const [, , sponsor, recipient, outsider] = accounts;

    await mintToUsers(token, [sponsor], ENTRY_FEE * 2n);

    const poolBefore = await templ.memberPoolBalance();
    await token.connect(sponsor).approve(await templ.getAddress(), ENTRY_FEE);
    const receipt = await (await templ.connect(sponsor).joinForWithReferral(recipient.address, outsider.address)).wait();

    const referralEvent = receipt.logs
      .map((log) => {
        try { return templ.interface.parseLog(log); } catch (_) { return null; }
      })
      .find((log) => log && log.name === "ReferralRewardPaid");
    expect(referralEvent).to.equal(undefined);

    const memberPoolAmount = (ENTRY_FEE * (await templ.memberPoolBps())) / 10_000n;
    const poolAfter = await templ.memberPoolBalance();
    expect(poolAfter - poolBefore).to.equal(memberPoolAmount);
    expect(await templ.isMember(recipient.address)).to.equal(true);
  });

  it("does not pay referral on joinForWithReferral when referral equals the recipient", async function () {
    const referralShare = 2_000;
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE, referralShareBps: referralShare });
    const [, , sponsor, recipient] = accounts;

    await mintToUsers(token, [sponsor], ENTRY_FEE * 2n);

    const poolBefore = await templ.memberPoolBalance();
    await token.connect(sponsor).approve(await templ.getAddress(), ENTRY_FEE);
    const receipt = await (await templ.connect(sponsor).joinForWithReferral(recipient.address, recipient.address)).wait();

    const referralEvent = receipt.logs
      .map((log) => {
        try { return templ.interface.parseLog(log); } catch (_) { return null; }
      })
      .find((log) => log && log.name === "ReferralRewardPaid");
    expect(referralEvent).to.equal(undefined);

    const memberPoolAmount = (ENTRY_FEE * (await templ.memberPoolBps())) / 10_000n;
    const poolAfter = await templ.memberPoolBalance();
    expect(poolAfter - poolBefore).to.equal(memberPoolAmount);
    expect(await templ.isMember(recipient.address)).to.equal(true);
  });
});
