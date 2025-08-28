const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Self Purchase Guard", function () {
  const ENTRY_FEE = ethers.parseUnits("100", 18);
  let templ, token;
  let owner, priest, member;

  beforeEach(async function () {
    [owner, priest, member] = await ethers.getSigners();

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

    // Mint tokens to member and approve
    await token.mint(member.address, ethers.parseUnits("1000", 18));
    await token.connect(member).approve(await templ.getAddress(), ENTRY_FEE);
    // Member purchase to seed treasury
    await templ.connect(member).purchaseAccess();
  });

  it("reverts when DAO attempts to purchase access for itself", async function () {
    const iface = new ethers.Interface(["function purchaseAccess()"]);
    const callData = iface.encodeFunctionData("purchaseAccess", []);

    await templ.connect(member).createProposal(
      "Self Purchase",
      "DAO tries to buy access",
      callData,
      7 * 24 * 60 * 60
    );

    await templ.connect(member).vote(0, true);
    await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine");

    const balanceBefore = await token.balanceOf(await templ.getAddress());

    await expect(templ.executeProposal(0)).to.be.revertedWithCustomError(templ, "InvalidSender");

    const balanceAfter = await token.balanceOf(await templ.getAddress());
    expect(balanceAfter).to.equal(balanceBefore);
  });
});

