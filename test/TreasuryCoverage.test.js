const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, joinMembers } = require("./utils/mintAndPurchase");

const ENTRY_FEE = ethers.parseUnits("100", 18);
const DAY = 24 * 60 * 60;
const VOTING_PERIOD = 7 * DAY;

describe("Treasury coverage extras", function () {
  it("reverts changePriest when attempting to keep the same address", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, priest, member] = accounts;

    await mintToUsers(token, [member], ENTRY_FEE * 2n);
    await joinMembers(templ, token, [member]);

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
    await joinMembers(templ, token, [member]);

    await expect(
      templ.connect(member).setMaxMembersDAO(10)
    ).to.be.revertedWithCustomError(templ, "NotDAO");

    await expect(
      templ.connect(member).setTemplMetadataDAO("DAO", "Update", "https://templ.fun/new-home.png")
    ).to.be.revertedWithCustomError(templ, "NotDAO");
  });

  it("rejects ETH withdrawals when the recipient reverts", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, priest, member, voter] = accounts;

    await mintToUsers(token, [member, voter], ENTRY_FEE * 4n);
    await joinMembers(templ, token, [member, voter]);

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

  it("reverts when withdrawing more access tokens than available after accounting for the pool", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, priest, member, voter] = accounts;

    await mintToUsers(token, [member, voter], ENTRY_FEE * 6n);
    await joinMembers(templ, token, [member, voter]);

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
