const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, joinMembers } = require("./utils/mintAndPurchase");

describe("Disband non-access treasury assets", function () {
  const ENTRY_FEE = ethers.parseUnits("100", 18);
  const DAY = 24 * 60 * 60;
  const VOTING_PERIOD = 7 * DAY;

  it("sweeps non-access ERC20 balances to the protocol recipient", async function () {
    const { templ, token, accounts, priest } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, , member1, member2, donor] = accounts;

    await mintToUsers(token, [member1, member2], ENTRY_FEE * 5n);
    await joinMembers(templ, token, [member1, member2]);

    const Other = await ethers.getContractFactory("contracts/mocks/TestToken.sol:TestToken");
    const other = await Other.deploy("Other", "OTH", 18);
    await other.waitForDeployment();

    const donation = ethers.parseUnits("50", 18);
    await other.mint(donor.address, donation);
    await other.connect(donor).transfer(await templ.getAddress(), donation);

    const protocolBefore = await other.balanceOf(priest.address);

    await templ
      .connect(member1)
      .createProposalDisbandTreasury(other.target, VOTING_PERIOD, "Disband treasury", "Sweep ERC20");
    const proposalId = (await templ.proposalCount()) - 1n;
    await templ.connect(member2).vote(proposalId, true);

    await ethers.provider.send("evm_increaseTime", [VOTING_PERIOD + DAY]);
    await ethers.provider.send("evm_mine", []);

    await expect(templ.executeProposal(proposalId))
      .to.emit(templ, "TreasuryDisbanded")
      .withArgs(proposalId, other.target, donation, 0, 0);

    expect(await other.balanceOf(priest.address)).to.equal(protocolBefore + donation);
    expect(await other.balanceOf(await templ.getAddress())).to.equal(0n);
  });

  it("sweeps ETH balances to the protocol recipient for zero-address disbands", async function () {
    const { templ, token, accounts, priest } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, , member1, member2, donor] = accounts;

    await mintToUsers(token, [member1, member2], ENTRY_FEE * 5n);
    await joinMembers(templ, token, [member1, member2]);

    const donation = ethers.parseEther("1");
    await donor.sendTransaction({ to: await templ.getAddress(), value: donation });

    const protocolBefore = await ethers.provider.getBalance(priest.address);

    await templ
      .connect(member1)
      .createProposalDisbandTreasury(ethers.ZeroAddress, VOTING_PERIOD, "Disband treasury", "Sweep ETH");
    const proposalId = (await templ.proposalCount()) - 1n;
    await templ.connect(member2).vote(proposalId, true);

    await ethers.provider.send("evm_increaseTime", [VOTING_PERIOD + DAY]);
    await ethers.provider.send("evm_mine", []);

    await expect(templ.executeProposal(proposalId))
      .to.emit(templ, "TreasuryDisbanded")
      .withArgs(proposalId, ethers.ZeroAddress, donation, 0, 0);

    expect(await ethers.provider.getBalance(priest.address)).to.equal(protocolBefore + donation);
    expect(await ethers.provider.getBalance(await templ.getAddress())).to.equal(0n);
  });
});
