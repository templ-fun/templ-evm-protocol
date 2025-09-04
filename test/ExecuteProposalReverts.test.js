const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("executeProposal reverts", function () {
  let templ;
  let token;
  let owner;
  let priest;
  const ENTRY_FEE = ethers.parseUnits("100", 18);

  beforeEach(async function () {
    [owner, priest] = await ethers.getSigners();

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

  it("reverts for proposal ID >= proposalCount", async function () {
    await expect(templ.executeProposal(0)).to.be.revertedWithCustomError(
      templ,
      "InvalidProposal"
    );
  });
});
