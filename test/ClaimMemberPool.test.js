const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");

describe("ClaimMemberPool access control", function () {
  let templ;
  let token;
  let accounts;
  const ENTRY_FEE = ethers.parseUnits("100", 18);
  const BPS_DENOMINATOR = 10_000n;

  beforeEach(async function () {
    ({ templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE }));
  });

  it("reverts with NotMember when non-member tries to claim", async function () {
    const nonMember = accounts[2];
    await expect(templ.connect(nonMember).claimMemberRewards()).to.be.revertedWithCustomError(
      templ,
      "NotMember"
    );
  });

  it("enforces member-only access and lets members claim accumulated rewards", async function () {
    const [, , memberA, memberB, outsider] = accounts;

    await expect(templ.connect(outsider).claimExternalReward(ethers.ZeroAddress)).to.be.revertedWithCustomError(
      templ,
      "NotMember"
    );

    await token.mint(memberA.address, ENTRY_FEE * 2n);
    await token.connect(memberA).approve(templ.target, ENTRY_FEE * 2n);
    await templ.connect(memberA).join();

    await token.mint(memberB.address, ENTRY_FEE);
    await token.connect(memberB).approve(templ.target, ENTRY_FEE);
    await templ.connect(memberB).join();

    const memberPoolBps = BigInt(await templ.memberPoolBps());
    const totalRewards = (ENTRY_FEE * memberPoolBps) / BPS_DENOMINATOR;
    const expectedShare = totalRewards / 2n;
    const before = await token.balanceOf(memberA.address);
    await templ.connect(memberA).claimMemberRewards();
    const after = await token.balanceOf(memberA.address);
    expect(after - before).to.equal(expectedShare);

    await expect(templ.connect(memberA).claimExternalReward(token.target)).to.be.revertedWithCustomError(
      templ,
      "InvalidCallData"
    );
  });
});
