const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, purchaseAccess } = require("./utils/mintAndPurchase");

describe("Donation withdrawal functions", function () {
  let templ;
  let token;
  let donationToken;
  let owner, priest, user1, user2, user3, recipient;
  let accounts;
  const ENTRY_FEE = ethers.parseUnits("100", 18);
  const TOKEN_SUPPLY = ethers.parseUnits("10000", 18);

  beforeEach(async function () {
    ({ templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE }));
    [owner, priest, user1, user2, user3, recipient] = accounts;

    const DonationToken = await ethers.getContractFactory("TestToken");
    donationToken = await DonationToken.deploy("Donation Token", "DON", 18);
    await donationToken.waitForDeployment();

    await mintToUsers(token, [user1, user2, user3], TOKEN_SUPPLY);
    await donationToken.mint(owner.address, TOKEN_SUPPLY);
    await purchaseAccess(templ, token, [user1, user2, user3]);
  });

  describe("withdrawTokenDAO", function () {
    it("withdraws donated ERC20 tokens via proposal", async function () {
      const amount = ethers.parseUnits("50", 18);
      await donationToken.transfer(await templ.getAddress(), amount);

      const iface = new ethers.Interface([
        "function withdrawTokenDAO(address,address,uint256,string)"
      ]);
      const callData = iface.encodeFunctionData("withdrawTokenDAO", [
        await donationToken.getAddress(),
        recipient.address,
        amount,
        "Sweep ERC20"
      ]);

      await templ.connect(user1).createProposal(
        "Sweep token",
        "Sweep donation token",
        callData,
        7 * 24 * 60 * 60
      );
      await templ.connect(user1).vote(0, true);
      await templ.connect(user2).vote(0, true);
      await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
      await ethers.provider.send("evm_mine");

      const recipientBefore = await donationToken.balanceOf(recipient.address);
      await expect(templ.connect(user3).executeProposal(0))
        .to.emit(templ, "TreasuryAction");
      expect(await donationToken.balanceOf(recipient.address)).to.equal(recipientBefore + amount);
    });

    it("reverts when called directly", async function () {
      await expect(
        templ.withdrawTokenDAO(await donationToken.getAddress(), recipient.address, 1n, "bad")
      ).to.be.revertedWithCustomError(templ, "NotDAO");
    });
  });

  describe("withdrawETHDAO", function () {
    it("withdraws donated ETH via proposal", async function () {
      const ethAmount = ethers.parseEther("1");
      await owner.sendTransaction({ to: await templ.getAddress(), value: ethAmount });

      const iface = new ethers.Interface([
        "function withdrawETHDAO(address,uint256,string)"
      ]);
      const callData = iface.encodeFunctionData("withdrawETHDAO", [
        recipient.address,
        ethAmount,
        "Sweep ETH"
      ]);

      await templ.connect(user1).createProposal(
        "Sweep ETH",
        "Sweep donated ETH",
        callData,
        7 * 24 * 60 * 60
      );
      await templ.connect(user1).vote(0, true);
      await templ.connect(user2).vote(0, true);
      await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
      await ethers.provider.send("evm_mine");

      const recipientEthBefore = await ethers.provider.getBalance(recipient.address);
      const tx = await templ.connect(user3).executeProposal(0);
      await tx.wait();
      expect(await ethers.provider.getBalance(recipient.address)).to.equal(recipientEthBefore + ethAmount);
    });

    it("reverts when called directly", async function () {
      await expect(
        templ.withdrawETHDAO(recipient.address, 1n, "bad")
      ).to.be.revertedWithCustomError(templ, "NotDAO");
    });
  });
});

