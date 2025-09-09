const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ExecuteCallHarness", function () {
  it("should revert on invalid call data", async function () {
    const accounts = await ethers.getSigners();
    const [owner, priest] = accounts;
    const Token = await ethers.getContractFactory(
      "contracts/mocks/TestToken.sol:TestToken"
    );
    const token = await Token.deploy("Test Token", "TEST", 18);
    await token.waitForDeployment();

    const Harness = await ethers.getContractFactory("ExecuteCallHarness");
    const harness = await Harness.deploy(
      priest.address,
      priest.address,
      await token.getAddress(),
      ethers.parseUnits("100", 18)
    );

    await expect(harness.executeCall("0x12345678")).to.be.revertedWithCustomError(
      harness,
      "InvalidCallData"
    );
  });
});
