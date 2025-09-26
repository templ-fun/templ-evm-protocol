const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");

describe("ClaimMemberPool access control", function () {
  let templ;
  let token;
  let accounts;
  const ENTRY_FEE = ethers.parseUnits("100", 18);

  beforeEach(async function () {
    ({ templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE }));
  });

  it("reverts with NotMember when non-member tries to claim", async function () {
    const nonMember = accounts[2];
    await expect(templ.connect(nonMember).claimMemberPool()).to.be.revertedWithCustomError(
      templ,
      "NotMember"
    );
  });

  it("enforces member-only access and lets members claim accumulated rewards", async function () {
    const [, , memberA, memberB, outsider] = accounts;

    await expect(templ.connect(outsider).claimExternalToken(ethers.ZeroAddress)).to.be.revertedWithCustomError(
      templ,
      "NotMember"
    );

    await token.mint(memberA.address, ENTRY_FEE * 2n);
    await token.connect(memberA).approve(templ.target, ENTRY_FEE * 2n);
    await templ.connect(memberA).purchaseAccess();

    await token.mint(memberB.address, ENTRY_FEE);
    await token.connect(memberB).approve(templ.target, ENTRY_FEE);
    await templ.connect(memberB).purchaseAccess();

    const expectedShare = (ENTRY_FEE * 30n) / 100n;
    const before = await token.balanceOf(memberA.address);
    await templ.connect(memberA).claimMemberPool();
    const after = await token.balanceOf(memberA.address);
    expect(after - before).to.equal(expectedShare);

    await expect(templ.connect(memberA).claimExternalToken(token.target)).to.be.revertedWithCustomError(
      templ,
      "InvalidCallData"
    );
  });
});
