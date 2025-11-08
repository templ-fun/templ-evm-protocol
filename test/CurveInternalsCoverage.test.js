const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTemplModules } = require("./utils/modules");
const { attachTemplInterface } = require("./utils/templ");

describe("Curve internals coverage via harness", function () {
  it("covers _scaleInverse divisor=0, overflow, and saturation branches; and _scaleForward overflow", async function () {
    const accounts = await ethers.getSigners();
    const [, priest] = accounts;
    const modules = await deployTemplModules();
    const Harness = await ethers.getContractFactory("contracts/mocks/TemplHarness.sol:TemplHarness");
    // Minimal deploy; access token not used here
    const accessAddr = ethers.getAddress("0x000000000000000000000000000000000000ac00");
    const templ = await Harness.deploy(
      priest.address,
      priest.address,
      accessAddr,
      1000n,
      3000,
      3000,
      3000,
      1000,
      3300,
      36 * 60 * 60,
      "0x000000000000000000000000000000000000dEaD",
      false,
      0,
      "Harness",
      "Harness",
      "https://logo",
      0,
      0,
      modules.membershipModule,
      modules.treasuryModule,
      modules.governanceModule
    );
    await templ.waitForDeployment();
    const h = await attachTemplInterface(templ);

    // divisor == 0 -> revert InvalidCurveConfig
    await expect(h.harnessScaleInverse(123, 0)).to.be.revertedWithCustomError(h, "InvalidCurveConfig");

    // overflow path: amount * BPS_DENOMINATOR overflows -> returns MAX_ENTRY_FEE
    const MAX256 = (1n << 256n) - 1n;
    const overflowResult = await h.harnessScaleInverse(MAX256, 1);
    const MAX128 = (1n << 128n) - 1n;
    expect(overflowResult).to.equal(MAX128);

    // saturation path: r > MAX_ENTRY_FEE -> returns MAX_ENTRY_FEE
    const satResult = await h.harnessScaleInverse(MAX128, 1);
    expect(satResult).to.equal(MAX128);

    // _scaleForward overflow path -> returns MAX_ENTRY_FEE
    const fwdOverflow = await h.harnessScaleForward(42, (1n << 256n) - 1n);
    expect(fwdOverflow).to.equal(MAX128);

    // _mulWouldOverflow true/false
    expect(await h.harnessMulWouldOverflow(MAX256, 2)).to.equal(true);
    expect(await h.harnessMulWouldOverflow(0, 42)).to.equal(false);
    expect(await h.harnessMulWouldOverflow(1, 1)).to.equal(false);
  });
});

