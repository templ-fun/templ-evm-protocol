const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Bytecode harness", function () {
  let harness;
  let pointer;
  let dataBytes;

  beforeEach(async function () {
    const Harness = await ethers.getContractFactory(
      "contracts/mocks/BytecodeHarness.sol:BytecodeHarness"
    );
    harness = await Harness.deploy();
    await harness.waitForDeployment();

    dataBytes = ethers.toUtf8Bytes("templ-coverage");
    await harness.store(dataBytes);
    pointer = await harness.lastPointer();
  });

  it("reads stored data via full, offset, and ranged helpers", async function () {
    const full = await harness.readAll(pointer);
    expect(full).to.equal(ethers.hexlify(dataBytes));

    const offset = 5;
    const from = await harness.readFrom(pointer, offset);
    expect(from).to.equal(ethers.hexlify(dataBytes.slice(offset)));

    const start = 2;
    const end = 9;
    const range = await harness.readRange(pointer, start, end);
    expect(range).to.equal(ethers.hexlify(dataBytes.slice(start, end)));
  });

  it("returns empty slices when reading beyond the stored runtime", async function () {
    const codeSize = await harness.codeSize(pointer);
    const beyond = Number(codeSize) + 4;

    const emptyRange = await harness.codeAt(pointer, beyond, beyond + 5);
    expect(emptyRange).to.equal("0x");

    const emptyFrom = await harness.readFrom(pointer, beyond - 1);
    expect(emptyFrom).to.equal("0x");
  });

  it("caps reads when the requested window exceeds the runtime length", async function () {
    const codeSize = Number(await harness.codeSize(pointer));
    const oversizedEnd = codeSize + 10;
    const capped = await harness.codeAt(pointer, 1, oversizedEnd);
    expect(capped).to.equal(ethers.hexlify(dataBytes));

    const withinBounds = await harness.codeAt(pointer, 1, 6);
    expect(withinBounds).to.equal(ethers.hexlify(dataBytes.slice(0, 5)));
  });

  it("reverts when the end offset precedes the start", async function () {
    await expect(harness.codeAt(pointer, 8, 4))
      .to.be.revertedWithCustomError(harness, "InvalidCodeAtRange")
      .withArgs(await harness.codeSize(pointer), 8, 4);
  });

  it("returns no bytes when the target address has no runtime", async function () {
    const empty = await harness.codeAt(ethers.ZeroAddress, 0, 10);
    expect(empty).to.equal("0x");
  });

  it("exposes creation code helpers for completeness", async function () {
    const creation = await harness.creationCode("0xdeadbeef");
    expect(creation.startsWith("0x63")).to.equal(true);
  });

  it("reverts with WriteError when storing empty data", async function () {
    await expect(harness.store("0x"))
      .to.be.revertedWithCustomError(harness, "WriteError");
  });
});
