const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, purchaseAccess } = require("./utils/mintAndPurchase");

const ENTRY_FEE = ethers.parseUnits("100", 18);
const DAY = 24 * 60 * 60;
const VOTING_PERIOD = 7 * DAY;

describe("Treasury coverage extras", function () {
  it("reverts changePriest when attempting to keep the same address", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, priest, member] = accounts;

    await mintToUsers(token, [member], ENTRY_FEE * 2n);
    await purchaseAccess(templ, token, [member]);

    await templ
      .connect(member)
      .createProposalChangePriest(priest.address, VOTING_PERIOD);
    await templ.connect(member).vote(0, true);
    await ethers.provider.send("evm_increaseTime", [VOTING_PERIOD + DAY]);
    await ethers.provider.send("evm_mine", []);

    await expect(templ.executeProposal(0)).to.be.revertedWithCustomError(
      templ,
      "InvalidCallData"
    );
  });

  it("restricts DAO-only treasury functions to contract calls", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, , member] = accounts;

    await mintToUsers(token, [member], ENTRY_FEE * 2n);
    await purchaseAccess(templ, token, [member]);

    await expect(
      templ.connect(member).setMaxMembersDAO(10)
    ).to.be.revertedWithCustomError(templ, "NotDAO");

    await expect(
      templ.connect(member).setTemplHomeLinkDAO("https://templ.fun/new-home")
    ).to.be.revertedWithCustomError(templ, "NotDAO");
  });

  it("rejects ETH withdrawals when the recipient reverts", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, priest, member, voter] = accounts;

    await mintToUsers(token, [member, voter], ENTRY_FEE * 4n);
    await purchaseAccess(templ, token, [member, voter]);

    const Rejector = await ethers.getContractFactory("contracts/mocks/RejectEther.sol:RejectEther");
    const rejector = await Rejector.deploy();
    const recipient = await rejector.getAddress();

    const donation = ethers.parseUnits("4", 18);
    await priest.sendTransaction({ to: await templ.getAddress(), value: donation });

    await templ
      .connect(member)
      .createProposalWithdrawTreasury(
        ethers.ZeroAddress,
        recipient,
        donation,
        "fail",
        VOTING_PERIOD
      );
    await templ.connect(member).vote(0, true);
    await templ.connect(voter).vote(0, true);
    await ethers.provider.send("evm_increaseTime", [VOTING_PERIOD + DAY]);
    await ethers.provider.send("evm_mine", []);

    await expect(templ.executeProposal(0)).to.be.revertedWithCustomError(
      templ,
      "ProposalExecutionFailed"
    );
  });

  it("prevents disbanding an already evacuated external reward", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, , memberA, memberB] = accounts;

    await mintToUsers(token, [memberA, memberB], ENTRY_FEE * 4n);
    await purchaseAccess(templ, token, [memberA, memberB]);

    const OtherToken = await ethers.getContractFactory("contracts/mocks/TestToken.sol:TestToken");
    const otherToken = await OtherToken.deploy("Bonus", "BON", 18);
    await otherToken.mint(memberA.address, ethers.parseUnits("6", 18));
    await otherToken.connect(memberA).transfer(await templ.getAddress(), ethers.parseUnits("6", 18));

    await templ
      .connect(memberA)
      .createProposalDisbandTreasury(otherToken.target, VOTING_PERIOD);
    await templ.connect(memberA).vote(0, true);
    await templ.connect(memberB).vote(0, true);
    await ethers.provider.send("evm_increaseTime", [VOTING_PERIOD + DAY]);
    await ethers.provider.send("evm_mine", []);
    await templ.executeProposal(0);

    await templ
      .connect(memberA)
      .createProposalDisbandTreasury(otherToken.target, VOTING_PERIOD);
    await templ.connect(memberA).vote(1, true);
    await templ.connect(memberB).vote(1, true);
    await ethers.provider.send("evm_increaseTime", [VOTING_PERIOD + DAY]);
    await ethers.provider.send("evm_mine", []);

    await expect(templ.executeProposal(1)).to.be.revertedWithCustomError(
      templ,
      "NoTreasuryFunds"
    );
  });

  it("reuses registered external tokens without duplicating entries", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, , memberA, memberB] = accounts;

    await mintToUsers(token, [memberA, memberB], ENTRY_FEE * 6n);
    await purchaseAccess(templ, token, [memberA, memberB]);

    const OtherToken = await ethers.getContractFactory("contracts/mocks/TestToken.sol:TestToken");
    const otherToken = await OtherToken.deploy("Repeat", "RPT", 18);
    await otherToken.mint(memberA.address, ethers.parseUnits("9", 18));
    await otherToken.connect(memberA).transfer(await templ.getAddress(), ethers.parseUnits("9", 18));

    await templ
      .connect(memberA)
      .createProposalDisbandTreasury(otherToken.target, VOTING_PERIOD);
    await templ.connect(memberA).vote(0, true);
    await templ.connect(memberB).vote(0, true);
    await ethers.provider.send("evm_increaseTime", [VOTING_PERIOD + DAY]);
    await ethers.provider.send("evm_mine", []);
    await templ.executeProposal(0);

    await otherToken.mint(memberB.address, ethers.parseUnits("4", 18));
    await otherToken.connect(memberB).transfer(await templ.getAddress(), ethers.parseUnits("4", 18));

    await templ
      .connect(memberB)
      .createProposalDisbandTreasury(otherToken.target, VOTING_PERIOD);
    await templ.connect(memberA).vote(1, true);
    await templ.connect(memberB).vote(1, true);
    await ethers.provider.send("evm_increaseTime", [VOTING_PERIOD + DAY]);
    await ethers.provider.send("evm_mine", []);
    await templ.executeProposal(1);

    const tokens = await templ.getExternalRewardTokens();
    const occurrences = tokens.filter((addr) => addr === otherToken.target).length;
    expect(occurrences).to.equal(1);
  });

  it("reverts when withdrawing more access tokens than available after accounting for the pool", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, priest, member, voter] = accounts;

    await mintToUsers(token, [member, voter], ENTRY_FEE * 6n);
    await purchaseAccess(templ, token, [member, voter]);

    const templAddress = await templ.getAddress();
    const extraDonation = ethers.parseUnits("10", 18);
    await token.connect(member).transfer(templAddress, extraDonation);

    const totalBalance = await token.balanceOf(templAddress);
    const memberPoolBalance = await templ.memberPoolBalance();
    const available = totalBalance - memberPoolBalance;

    await templ
      .connect(member)
      .createProposalWithdrawTreasury(
        await token.getAddress(),
        priest.address,
        available + 1n,
        "too-much",
        VOTING_PERIOD
      );
    await templ.connect(member).vote(0, true);
    await templ.connect(voter).vote(0, true);
    await ethers.provider.send("evm_increaseTime", [VOTING_PERIOD + DAY]);
    await ethers.provider.send("evm_mine", []);

    await expect(templ.executeProposal(0)).to.be.revertedWithCustomError(
      templ,
      "InsufficientTreasuryBalance"
    );
  });
});
