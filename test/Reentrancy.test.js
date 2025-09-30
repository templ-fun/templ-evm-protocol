const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, purchaseAccess } = require("./utils/mintAndPurchase");

describe("Reentrancy protection", function () {
  const ENTRY_FEE = ethers.parseUnits("100", 18);
  const BURN_BPS = 3000;
  const TREASURY_BPS = 3000;
  const MEMBER_BPS = 3000;
  const PROTOCOL_BPS = 1000;
  const QUORUM_BPS = 3300;

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
        BURN_BPS,
        TREASURY_BPS,
        MEMBER_BPS,
        PROTOCOL_BPS,
        QUORUM_BPS,
        7 * 24 * 60 * 60,
        "0x000000000000000000000000000000000000dEaD",
        false,
        0,
        ""
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
        BURN_BPS,
        TREASURY_BPS,
        MEMBER_BPS,
        PROTOCOL_BPS,
        QUORUM_BPS,
        7 * 24 * 60 * 60,
        "0x000000000000000000000000000000000000dEaD",
        false,
        0,
        ""
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

  describe("claimExternalToken", function () {
    const VOTING_PERIOD = 7 * 24 * 60 * 60;

    it("reverts when claimExternalToken is reentered", async function () {
      const { templ, token, accounts, priest } = await deployTempl({ entryFee: ENTRY_FEE });
      const [, , member, donor] = accounts;

      const ReentrantToken = await ethers.getContractFactory(
        "contracts/mocks/ReentrantToken.sol:ReentrantToken"
      );
      const rewardToken = await ReentrantToken.deploy("Reentrant Reward", "RRW");
      await rewardToken.waitForDeployment();
      await rewardToken.setTempl(await templ.getAddress());

      await mintToUsers(token, [priest, member], ENTRY_FEE * 4n);
      await purchaseAccess(templ, token, [priest, member]);

      await token.mint(await rewardToken.getAddress(), ENTRY_FEE);
      await rewardToken.joinTemplWithAccessToken(await token.getAddress(), ENTRY_FEE);

      expect(await templ.hasAccess(priest.address)).to.equal(true);
      expect(await templ.hasAccess(member.address)).to.equal(true);
      expect(await templ.hasAccess(await rewardToken.getAddress())).to.equal(true);

      const donation = ethers.parseUnits("30", 18);
      await rewardToken.mint(donor.address, donation);
      await rewardToken.connect(donor).transfer(await templ.getAddress(), donation);

      await templ
        .connect(priest)
        .createProposalDisbandTreasury(rewardToken.target, VOTING_PERIOD, "Disband", "Handle rewards");

      await ethers.provider.send("evm_increaseTime", [VOTING_PERIOD + 1]);
      await ethers.provider.send("evm_mine", []);
      await templ.executeProposal(0);

      expect(await templ.hasAccess(member.address)).to.equal(true);

      await rewardToken.setCallback(3);
      await rewardToken.setCallbackToken(await rewardToken.getAddress());

      await expect(
        templ.connect(member).claimExternalToken(rewardToken.target)
      ).to.be.revertedWithCustomError(templ, "ReentrancyGuardReentrantCall");
    });

    it("invokes the claimExternal callback when configured", async function () {
      const ReentrantToken = await ethers.getContractFactory(
        "contracts/mocks/ReentrantToken.sol:ReentrantToken"
      );
      const rewardToken = await ReentrantToken.deploy("Reentrant Reward", "RRW");
      await rewardToken.waitForDeployment();

      const Target = await ethers.getContractFactory(
        "contracts/mocks/ClaimExternalTarget.sol:ClaimExternalTarget"
      );
      const target = await Target.deploy();
      await target.waitForDeployment();

      await rewardToken.setTempl(await target.getAddress());
      await rewardToken.mint((await ethers.getSigners())[0].address, ENTRY_FEE);

      await rewardToken.setCallback(3);

      await expect(rewardToken.transfer((await ethers.getSigners())[1].address, ENTRY_FEE))
        .to.emit(target, "ExternalClaim")
        .withArgs(await rewardToken.getAddress(), await rewardToken.getAddress());
    });
  });
});
