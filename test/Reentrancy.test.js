const { expect } = require("chai");
const { ethers } = require("hardhat");
const { STATIC_CURVE } = require("./utils/deploy");
const { mintToUsers, joinMembers } = require("./utils/mintAndPurchase");
const { deployTemplModules } = require("./utils/modules");
const { attachTemplInterface } = require("./utils/templ");

describe("Reentrancy protection", function () {
  const ENTRY_FEE = ethers.parseUnits("100", 18);
  const BURN_BPS = 3000;
  const TREASURY_BPS = 3000;
  const MEMBER_BPS = 3000;
  const PROTOCOL_BPS = 1000;
  const QUORUM_BPS = 3300;
const METADATA = {
  name: "Reentrancy Templ",
  description: "Reentrancy test",
  logo: "https://templ.test/reentrant.png"
};


  describe("join", function () {
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

      const { membershipModule, treasuryModule, governanceModule, councilModule } = await deployTemplModules();

      const TemplFactory = await ethers.getContractFactory("TEMPL");
      templ = await TemplFactory.deploy(
        priest.address,
        priest.address,
        await token.getAddress(),
        ENTRY_FEE,
        BURN_BPS,
        TREASURY_BPS,
        MEMBER_BPS,
        PROTOCOL_BPS,
        QUORUM_BPS,
        7 * 24 * 60 * 60,
        "0x000000000000000000000000000000000000dEaD",
        false,
        0,
      METADATA.name,
      METADATA.description,
      METADATA.logo,
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

      await token.setTempl(await templ.getAddress());
    });

    it("reverts when join is reentered", async function () {
      const attacker = accounts[2];

      await token.mint(attacker.address, ENTRY_FEE);
      await token
        .connect(attacker)
        .approve(await templ.getAddress(), ENTRY_FEE);

      await token.setCallback(1);

      await expect(
        templ.connect(attacker).join()
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

  describe("claimMemberRewards", function () {
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

      const { membershipModule, treasuryModule, governanceModule, councilModule } = await deployTemplModules();

      const TemplFactory = await ethers.getContractFactory("TEMPL");
      templ = await TemplFactory.deploy(
        priest.address,
        priest.address,
        await token.getAddress(),
        ENTRY_FEE,
        BURN_BPS,
        TREASURY_BPS,
        MEMBER_BPS,
        PROTOCOL_BPS,
        QUORUM_BPS,
        7 * 24 * 60 * 60,
        "0x000000000000000000000000000000000000dEaD",
        false,
        0,
      METADATA.name,
      METADATA.description,
      METADATA.logo,
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

      await token.setTempl(await templ.getAddress());
      await token.joinTempl(ENTRY_FEE);
    });

    it("reverts when claimMemberRewards is reentered", async function () {
      const [, member1, member2] = accounts;

      await mintToUsers(token, [member1, member2], ENTRY_FEE);

      await joinMembers(templ, token, [member1, member2]);

      await token.setCallback(2);

      await expect(
        templ.connect(member1).claimMemberRewards()
      ).to.be.revertedWithCustomError(templ, "ReentrancyGuardReentrantCall");
    });
  });

  describe("sweepMemberPoolRemainderDAO", function () {
    let accounts;
    let templ;
    let token;
    let priest;

    beforeEach(async function () {
      accounts = await ethers.getSigners();
      [, priest] = accounts;

      const ReentrantToken = await ethers.getContractFactory(
        "contracts/mocks/ReentrantToken.sol:ReentrantToken"
      );
      token = await ReentrantToken.deploy("Reentrant Token", "RNT");
      await token.waitForDeployment();

      const { membershipModule, treasuryModule, governanceModule, councilModule } = await deployTemplModules();
      const entryFee = 1010n;

      const TemplFactory = await ethers.getContractFactory("TEMPL");
      templ = await TemplFactory.deploy(
        priest.address,
        priest.address,
        await token.getAddress(),
        entryFee,
        2900,
        2900,
        3200,
        PROTOCOL_BPS,
        QUORUM_BPS,
        7 * 24 * 60 * 60,
        "0x000000000000000000000000000000000000dEaD",
        true,
        0,
        METADATA.name,
        METADATA.description,
        METADATA.logo,
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

      await token.setTempl(await templ.getAddress());
    });

    it("reverts when sweeping member pool reenters claimMemberRewards", async function () {
      const entryFee = 1010n;
      const [, , member1, member2, member3, recipient] = accounts;

      await token.joinTempl(entryFee);

      await mintToUsers(token, [member1, member2, member3], entryFee * 10n);
      await joinMembers(templ, token, [member1, member2, member3]);

      const remainder = await templ.memberRewardRemainder();
      expect(remainder).to.be.gt(0n);

      await token.setCallback(2);

      await expect(
        templ.connect(priest).sweepMemberPoolRemainderDAO(recipient.address)
      ).to.be.revertedWithCustomError(templ, "ReentrancyGuardReentrantCall");
    });
  });
});
