const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("BatchExecutor", function () {
  let batch;
  let target;

  beforeEach(async function () {
    const BatchExecutor = await ethers.getContractFactory("BatchExecutor");
    batch = await BatchExecutor.deploy();
    await batch.waitForDeployment();

    const Target = await ethers.getContractFactory(
      "contracts/mocks/ExternalCallTarget.sol:ExternalCallTarget"
    );
    target = await Target.deploy();
    await target.waitForDeployment();
  });

  it("reverts on empty or mismatched arrays", async function () {
    await expect(batch.execute([], [], [])).to.be.reverted;

    const addr = await target.getAddress();
    await expect(batch.execute([addr], [], [])).to.be.reverted;
    await expect(batch.execute([addr], [0], [])).to.be.reverted;
  });

  it("reverts on zero targets", async function () {
    await expect(batch.execute([ethers.ZeroAddress], [0], ["0x"])).to.be.reverted;
  });

  it("reverts when msg.value does not equal the sum of values", async function () {
    const addr = await target.getAddress();
    const call = target.interface.encodeFunctionData("setNumberPayable", [1]);

    await expect(batch.execute([addr], [1], [call], { value: 0 })).to.be.reverted;
    await expect(batch.execute([addr], [1], [call], { value: 2 })).to.be.reverted;
  });

  it("executes calls in order, forwards value, and returns data", async function () {
    const addr = await target.getAddress();
    const call1 = target.interface.encodeFunctionData("setNumber", [10]);
    const call2 = target.interface.encodeFunctionData("setNumberPayable", [99]);
    const value = 1n;

    const results = await batch.execute.staticCall(
      [addr, addr],
      [0, value],
      [call1, call2],
      { value }
    );
    await batch.execute([addr, addr], [0, value], [call1, call2], { value });

    const [result1] = ethers.AbiCoder.defaultAbiCoder().decode(["uint256"], results[0]);
    const [result2] = ethers.AbiCoder.defaultAbiCoder().decode(["uint256"], results[1]);
    expect(result1).to.equal(11n);
    expect(result2).to.equal(99n);
    expect(await target.storedValue()).to.equal(99n);

    const targetBalance = await ethers.provider.getBalance(addr);
    expect(targetBalance).to.equal(value);
  });

  it("bubbles revert data from a target call", async function () {
    const addr = await target.getAddress();
    const ok = target.interface.encodeFunctionData("setNumber", [1]);
    const bad = target.interface.encodeFunctionData("willRevert");

    await expect(
      batch.execute([addr, addr], [0, 0], [ok, bad])
    ).to.be.revertedWithCustomError(target, "ExternalCallFailure").withArgs(42);
  });
});
