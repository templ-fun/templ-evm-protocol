const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("executeDAO revert handling", function () {
  const ENTRY_FEE = ethers.parseUnits("100", 18);
  let templ, token, reverter;
  let owner, priest, user1, user2;

  beforeEach(async function () {
    [owner, priest, user1, user2] = await ethers.getSigners();

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

    const TOKEN_SUPPLY = ethers.parseUnits("10000", 18);
    await token.mint(user1.address, TOKEN_SUPPLY);
    await token.mint(user2.address, TOKEN_SUPPLY);
    await token.connect(user1).approve(await templ.getAddress(), ENTRY_FEE);
    await templ.connect(user1).purchaseAccess();
    await token.connect(user2).approve(await templ.getAddress(), ENTRY_FEE);
    await templ.connect(user2).purchaseAccess();

    const Reverter = await ethers.getContractFactory("Reverter");
    reverter = await Reverter.deploy();
    await reverter.waitForDeployment();
  });

  it("reverts with ExternalCallFailed when helper reverts", async function () {
    const templIface = new ethers.Interface(["function executeDAO(address,uint256,bytes)"]);
    const revertIface = new ethers.Interface(["function alwaysRevert()"]);

    const callData = templIface.encodeFunctionData("executeDAO", [
      await reverter.getAddress(),
      0,
      revertIface.encodeFunctionData("alwaysRevert", []),
    ]);

    await templ.connect(user1).createProposal(
      "Revert call",
      "Helper reverts",
      callData,
      7 * 24 * 60 * 60
    );

    await templ.connect(user1).vote(0, true);
    await templ.connect(user2).vote(0, true);
    await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine");

    await expect(templ.executeProposal(0)).to.be.revertedWithCustomError(
      templ,
      "ExternalCallFailed"
    );
  });
});
