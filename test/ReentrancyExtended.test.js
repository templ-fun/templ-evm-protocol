const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Extended reentrancy protection", function () {
  const ENTRY_FEE = ethers.parseUnits("100", 18);
  let accounts;
  let templ;
  let token;
  let helper;

  beforeEach(async function () {
    accounts = await ethers.getSigners();
    const [owner, priest] = accounts;

    const Token = await ethers.getContractFactory("TestToken");
    token = await Token.deploy("Test Token", "TT", 18);
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

    const Helper = await ethers.getContractFactory("ReentrancyHelper");
    helper = await Helper.deploy(
      await templ.getAddress(),
      await token.getAddress()
    );
    await helper.waitForDeployment();

    // fund owner and helper
    await token.mint(owner.address, ENTRY_FEE * 2n);
    await token.mint(await helper.getAddress(), ENTRY_FEE * 2n);

    // owner buys access
    await token
      .connect(owner)
      .approve(await templ.getAddress(), ENTRY_FEE);
    await templ.connect(owner).purchaseAccess();

    // helper buys access to become member
    await helper.buyAccess(ENTRY_FEE);
  });

  it("reverts with ReentrantCall when executeProposal is reentered", async function () {
    const proposalId = 0;
    const attackData = helper.interface.encodeFunctionData("attackExecute", [
      proposalId,
    ]);
    const callData = templ.interface.encodeFunctionData("executeDAO", [
      await helper.getAddress(),
      0,
      attackData,
    ]);

    const votingPeriod = 7 * 24 * 60 * 60;
    await templ
      .connect(accounts[0])
      .createProposal("Attack", "Reenter executeProposal", callData, votingPeriod);
    await templ.connect(accounts[0]).vote(proposalId, true);
    await ethers.provider.send("evm_increaseTime", [votingPeriod]);
    await ethers.provider.send("evm_mine", []);

    await expect(templ.executeProposal(proposalId)).to.be.revertedWithCustomError(
      templ,
      "ExternalCallFailed"
    );
  });

  it("reverts with ReentrantCall when claimMemberPool is reentered", async function () {
    const proposalId = 0;
    const attackData = helper.interface.encodeFunctionData("attackClaim");
    const callData = templ.interface.encodeFunctionData("executeDAO", [
      await helper.getAddress(),
      0,
      attackData,
    ]);

    const votingPeriod = 7 * 24 * 60 * 60;
    await templ
      .connect(accounts[0])
      .createProposal("Attack", "Reenter claimMemberPool", callData, votingPeriod);
    await templ.connect(accounts[0]).vote(proposalId, true);
    await ethers.provider.send("evm_increaseTime", [votingPeriod]);
    await ethers.provider.send("evm_mine", []);

    await expect(templ.executeProposal(proposalId)).to.be.revertedWithCustomError(
      templ,
      "ExternalCallFailed"
    );
  });
});

