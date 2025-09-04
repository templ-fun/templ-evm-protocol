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

  it("reverts when DAO attempts to propose self purchase", async function () {
    const iface = new ethers.Interface(["function purchaseAccess()"]);
    const callData = iface.encodeFunctionData("purchaseAccess", []);

    await expect(
      templ.connect(member).createProposal(
        "Self Purchase",
        "DAO tries to buy access",
        callData,
        7 * 24 * 60 * 60
      )
    ).to.be.revertedWithCustomError(templ, "InvalidCallData");
  });

  it("reverts when DAO invokes helper calling purchaseAccess", async function () {
    const Caller = await ethers.getContractFactory("PurchaseCaller");
    const caller = await Caller.deploy(await templ.getAddress());
    await caller.waitForDeployment();

    const templAddress = await templ.getAddress();
    // fund DAO address with ETH for tx fees
    await owner.sendTransaction({
      to: templAddress,
      value: ethers.parseEther("1"),
    });

    // impersonate DAO
    await ethers.provider.send("hardhat_impersonateAccount", [templAddress]);
    const dao = await ethers.getSigner(templAddress);

    await expect(
      caller.connect(dao).callPurchaseAccess()
    ).to.be.revertedWithCustomError(templ, "InsufficientBalance");

    await ethers.provider.send("hardhat_stopImpersonatingAccount", [templAddress]);
  });

  it("reverts when DAO calls purchaseAccess directly", async function () {
    const templAddress = await templ.getAddress();

    // fund DAO address with ETH for gas
    await owner.sendTransaction({
      to: templAddress,
      value: ethers.parseEther("1"),
    });

    // impersonate DAO
    await ethers.provider.send("hardhat_impersonateAccount", [templAddress]);
    const dao = await ethers.getSigner(templAddress);

    await expect(
      templ.connect(dao).purchaseAccess()
    ).to.be.revertedWithCustomError(templ, "InvalidSender");

    await ethers.provider.send("hardhat_stopImpersonatingAccount", [templAddress]);
  });
});
