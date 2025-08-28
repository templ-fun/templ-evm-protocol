const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ClaimMemberPool access control", function () {
  let templ;
  let token;
  let accounts;
  const ENTRY_FEE = ethers.parseUnits("100", 18);

  beforeEach(async function () {
    accounts = await ethers.getSigners();
    const [owner, priest] = accounts;

    const Token = await ethers.getContractFactory("TestToken");
    token = await Token.deploy("Test Token", "TEST", 18);
    await token.waitForDeployment();

    const TEMPL = await ethers.getContractFactory("TEMPL");
    templ = await TEMPL.deploy(
      priest.address,
      priest.address,
      await token.getAddress(),
      ENTRY_FEE,
      10,
      10
    );
    await templ.waitForDeployment();
  });

  it("reverts with NotMember when non-member tries to claim", async function () {
    const nonMember = accounts[2];
    await expect(templ.connect(nonMember).claimMemberPool()).to.be.revertedWithCustomError(
      templ,
      "NotMember"
    );
  });
});

