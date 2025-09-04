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
});

