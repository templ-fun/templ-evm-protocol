const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTemplModules } = require("./utils/modules");
const { attachTemplInterface } = require("./utils/templ");
const { STATIC_CURVE } = require("./utils/deploy");

describe("Non-vanilla access token handling", function () {
  it("reverts joins for fee-on-transfer access tokens", async function () {
    const accounts = await ethers.getSigners();
    const [, priest, member] = accounts;
    const entryFee = ethers.parseUnits("100", 18);

    const Token = await ethers.getContractFactory("contracts/mocks/FeeOnTransferToken.sol:FeeOnTransferToken");
    const token = await Token.deploy("Fee Token", "FEE", 100);
    await token.waitForDeployment();

    const { membershipModule, treasuryModule, governanceModule, councilModule } = await deployTemplModules();
    const Templ = await ethers.getContractFactory("TEMPL");
    let templ = await Templ.deploy(
      priest.address,
      priest.address,
      await token.getAddress(),
      entryFee,
      3000,
      3000,
      3000,
      1000,
      3300,
      36 * 60 * 60,
      "0x000000000000000000000000000000000000dEaD",
      0,
      "Non-vanilla",
      "",
      "",
      0,
      0,
      5_100,
      10_000,
      false,
      membershipModule,
      treasuryModule,
      governanceModule,
      councilModule,
      STATIC_CURVE
    );
    await templ.waitForDeployment();
    templ = await attachTemplInterface(templ);

    await token.transfer(member.address, entryFee * 2n);
    await token.connect(member).approve(await templ.getAddress(), entryFee);

    await expect(templ.connect(member).join()).to.be.revertedWithCustomError(templ, "NonVanillaToken");
  });
});
