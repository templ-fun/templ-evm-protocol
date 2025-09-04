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

  it("reverts when proposal call data execution fails", async function () {
    await token.mint(owner.address, ENTRY_FEE);
    await token
      .connect(owner)
      .approve(await templ.getAddress(), ENTRY_FEE);
    await templ.connect(owner).purchaseAccess();

    const selector = templ.interface.getFunction(
      "withdrawTreasuryDAO"
    ).selector;

    await templ
      .connect(owner)
      .createProposal("Test", "Revert", selector, 7 * 24 * 60 * 60);

    await templ.connect(owner).vote(0, true);

    await ethers.provider.send("evm_increaseTime", [7 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine");

    await expect(templ.executeProposal(0)).to.be.revertedWithCustomError(
      templ,
      "ProposalExecutionFailed"
    );
  });
});
