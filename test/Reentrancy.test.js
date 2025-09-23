const { expect } = require("chai");
const { ethers } = require("hardhat");
const { mintToUsers, purchaseAccess } = require("./utils/mintAndPurchase");

describe("Reentrancy protection", function () {
  const ENTRY_FEE = ethers.parseUnits("100", 18);

  describe("purchaseAccess", function () {
    let accounts;
    let templ;
    let token;

    beforeEach(async function () {
      accounts = await ethers.getSigners();
      const [owner, priest] = accounts;

      const ReentrantToken = await ethers.getContractFactory(
        "contracts/mocks/ReentrantToken.sol:ReentrantToken"
      );
      token = await ReentrantToken.deploy("Reentrant Token", "RNT");
      await token.waitForDeployment();

      const TEMPL = await ethers.getContractFactory("TEMPL");
      templ = await TEMPL.deploy(
        priest.address,
        priest.address,
        await token.getAddress(),
        ENTRY_FEE,
        30,
        30,
        30,
        10,
        33,
        7 * 24 * 60 * 60,
        "0x000000000000000000000000000000000000dEaD",
        false
      );
      await templ.waitForDeployment();

      await token.setTempl(await templ.getAddress());
    });

    it("reverts when purchaseAccess is reentered", async function () {
      const attacker = accounts[2];

      await token.mint(attacker.address, ENTRY_FEE);
      await token
        .connect(attacker)
        .approve(await templ.getAddress(), ENTRY_FEE);

      await token.setCallback(1);

      await expect(
        templ.connect(attacker).purchaseAccess()
      ).to.be.revertedWithCustomError(templ, "ReentrancyGuardReentrantCall");
    });

    it("returns true for normal transfers when no callback is set", async function () {
      const [, sender, receiver] = accounts;

      await token.mint(sender.address, ENTRY_FEE);
      const tx = await token.connect(sender).transfer(receiver.address, ENTRY_FEE);
      await tx.wait();

      expect(await token.balanceOf(receiver.address)).to.equal(ENTRY_FEE);
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
        "contracts/mocks/ReentrantToken.sol:ReentrantToken"
      );
      token = await ReentrantToken.deploy("Reentrant Token", "RNT");
      await token.waitForDeployment();

      const TEMPL = await ethers.getContractFactory("TEMPL");
      templ = await TEMPL.deploy(
        priest.address,
        priest.address,
        await token.getAddress(),
        ENTRY_FEE,
        30,
        30,
        30,
        10,
        33,
        7 * 24 * 60 * 60,
        "0x000000000000000000000000000000000000dEaD",
        false
      );
      await templ.waitForDeployment();

      await token.setTempl(await templ.getAddress());
      await token.joinTempl(ENTRY_FEE);
    });

    it("reverts when claimMemberPool is reentered", async function () {
      const [, member1, member2] = accounts;

      await mintToUsers(token, [member1, member2], ENTRY_FEE);

      await purchaseAccess(templ, token, [member1, member2]);

      await token.setCallback(2);

      await expect(
        templ.connect(member1).claimMemberPool()
      ).to.be.revertedWithCustomError(templ, "ReentrancyGuardReentrantCall");
    });
  });
});
