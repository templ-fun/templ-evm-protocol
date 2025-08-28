const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("executeDAO ETH handling", function () {
  const ENTRY_FEE = ethers.parseUnits("100", 18);
  let templ, token, helper;
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

    const ReturnEth = await ethers.getContractFactory("ReturnEth");
    helper = await ReturnEth.deploy();
    await helper.waitForDeployment();

    await owner.sendTransaction({
      to: await helper.getAddress(),
      value: ethers.parseEther("1"),
    });
  });

  it("receives ETH sent back from helper", async function () {
    const iface = new ethers.Interface(["function executeDAO(address,uint256,bytes)"]);
    const helperIface = new ethers.Interface(["function returnToCaller(uint256)"]);

    const callData = iface.encodeFunctionData("executeDAO", [
      await helper.getAddress(),
      0,
      helperIface.encodeFunctionData("returnToCaller", [ethers.parseEther("1")]),
    ]);

    await templ.connect(user1).createProposal(
      "Return ETH",
      "Helper returns ETH to DAO",
      callData,
      7 * 24 * 60 * 60
    );

    await templ.connect(user1).vote(0, true);
    await templ.connect(user2).vote(0, true);
    await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine");

    const balanceBefore = await ethers.provider.getBalance(await templ.getAddress());
    await templ.executeProposal(0);
    const balanceAfter = await ethers.provider.getBalance(await templ.getAddress());
    expect(balanceAfter - balanceBefore).to.equal(ethers.parseEther("1"));
  });
});

