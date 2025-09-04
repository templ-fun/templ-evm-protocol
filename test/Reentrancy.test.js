const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Reentrancy protection", function () {
  const ENTRY_FEE = ethers.parseUnits("100", 18);

  describe("purchaseAccess", function () {
    let accounts;
    let templ;
    let token;

    beforeEach(async function () {
      accounts = await ethers.getSigners();
      const [owner, priest] = accounts;

      const ReentrantToken = await ethers.getContractFactory("ReentrantToken");
      token = await ReentrantToken.deploy("Reentrant Token", "RNT");
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

      await token.setTempl(await templ.getAddress());
    });

    it("reverts with ReentrantCall when purchaseAccess is reentered", async function () {
      const attacker = accounts[2];

      await token.mint(attacker.address, ENTRY_FEE);
      await token
        .connect(attacker)
        .approve(await templ.getAddress(), ENTRY_FEE);

      await token.setCallback(1);

      await expect(
        templ.connect(attacker).purchaseAccess()
      ).to.be.revertedWithCustomError(templ, "ReentrantCall");
    });
  });

  describe("claimMemberPool", function () {
    let accounts;
    let templ;
    let token;

    beforeEach(async function () {
      accounts = await ethers.getSigners();
      const [owner, priest] = accounts;

      const ReentrantToken = await ethers.getContractFactory(
        "ReentrantToken"
      );
      token = await ReentrantToken.deploy("Reentrant Token", "RNT");
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

      await token.setTempl(await templ.getAddress());
      await token.joinTempl(ENTRY_FEE);
    });

    it("reverts with ReentrantCall when claimMemberPool is reentered", async function () {
      const [, member1, member2] = accounts;

      await token.mint(member1.address, ENTRY_FEE);
      await token.mint(member2.address, ENTRY_FEE);

      await token
        .connect(member1)
        .approve(await templ.getAddress(), ENTRY_FEE);
      await templ.connect(member1).purchaseAccess();

      await token
        .connect(member2)
        .approve(await templ.getAddress(), ENTRY_FEE);
      await templ.connect(member2).purchaseAccess();

      await token.setCallback(2);

      await expect(
        templ.connect(member1).claimMemberPool()
      ).to.be.revertedWithCustomError(templ, "ReentrantCall");
    });
  });
});

