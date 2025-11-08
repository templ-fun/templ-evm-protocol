const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers } = require("./utils/mintAndPurchase");

describe("Membership invalid recipient reverts", function () {
  const ENTRY_FEE = ethers.parseUnits("100", 18);

  it("joinFor and joinForWithReferral revert for zero recipient", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, , sponsor] = accounts;
    await mintToUsers(token, [sponsor], ENTRY_FEE * 2n);
    await token.connect(sponsor).approve(await templ.getAddress(), ENTRY_FEE * 2n);

    await expect(templ.connect(sponsor).joinFor(ethers.ZeroAddress))
      .to.be.revertedWithCustomError(templ, "InvalidRecipient");

    await expect(templ.connect(sponsor).joinForWithReferral(ethers.ZeroAddress, sponsor.address))
      .to.be.revertedWithCustomError(templ, "InvalidRecipient");
  });
});

