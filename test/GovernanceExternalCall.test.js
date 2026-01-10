const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, joinMembers } = require("./utils/mintAndPurchase");

describe("Governance external call proposals", function () {
  const ENTRY_FEE = ethers.parseUnits("100", 18);
  const VOTING_PERIOD = 7 * 24 * 60 * 60;
  const MAX_EXTERNAL_CALLDATA_BYTES = 4096;

  let templ;
  let token;
  let accounts;
  let target;
  let owner;
  let memberA;
  let memberB;

  const abiCoder = ethers.AbiCoder.defaultAbiCoder();

  beforeEach(async function () {
    ({ templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE }));
    [owner, , memberA, memberB] = accounts;

    await mintToUsers(token, [memberA, memberB], ENTRY_FEE * 10n);
    await joinMembers(templ, token, [memberA, memberB]);

    const Target = await ethers.getContractFactory("contracts/mocks/ExternalCallTarget.sol:ExternalCallTarget");
    target = await Target.deploy();
    await target.waitForDeployment();
  });

  async function executeCallProposal({
    selector,
    params = "0x",
    value = 0n,
    title = "External call",
    description = "Execute external call"
  }) {
    const tx = await templ
      .connect(memberA)
      .createProposalCallExternal(
        await target.getAddress(),
        value,
        selector,
        params,
        VOTING_PERIOD,
        title,
        description
      );
    await tx.wait();
    const proposalId = (await templ.proposalCount()) - 1n;
    await templ.connect(memberB).vote(Number(proposalId), true);
    await ethers.provider.send("evm_increaseTime", [VOTING_PERIOD + 1]);
    await ethers.provider.send("evm_mine", []);
    return proposalId;
  }

  it("executes arbitrary calls and records return data", async function () {
    const selector = target.interface.getFunction("setNumber").selector;
    const params = abiCoder.encode(["uint256"], [123n]);
    const proposalId = await executeCallProposal({ selector, params });

    const expectedReturn = abiCoder.encode(["uint256"], [124n]);
    const expectedHash = ethers.keccak256(expectedReturn);
    await expect(templ.executeProposal(Number(proposalId)))
      .to.emit(templ, "ProposalExecuted")
      .withArgs(proposalId, true, expectedHash);

    expect(await target.storedValue()).to.equal(123n);
  });

  it("bubbles up external call reverts", async function () {
    const selector = target.interface.getFunction("willRevert").selector;
    const proposalId = await executeCallProposal({ selector });

    await expect(templ.executeProposal(Number(proposalId)))
      .to.be.revertedWithCustomError(target, "ExternalCallFailure")
      .withArgs(42);
  });

  it("reverts when call value exceeds the templ ETH balance", async function () {
    const selector = target.interface.getFunction("setNumberPayable").selector;
    const params = abiCoder.encode(["uint256"], [555n]);
    const proposalId = await executeCallProposal({
      selector,
      params,
      value: ethers.parseEther("1"),
      title: "Overdraw",
      description: "Exceeds balance"
    });

    await expect(templ.executeProposal(Number(proposalId))).to.be.reverted;
    expect(await target.storedValue()).to.equal(0n);
  });

  it("forwards call value to external targets", async function () {
    const selector = target.interface.getFunction("setNumberPayable").selector;
    const params = abiCoder.encode(["uint256"], [777n]);
    const callValue = ethers.parseEther("0.25");

    await owner.sendTransaction({ to: await templ.getAddress(), value: callValue });
    const startingBalance = await ethers.provider.getBalance(await target.getAddress());
    expect(startingBalance).to.equal(0n);

    const proposalId = await executeCallProposal({ selector, params, value: callValue });
    const ret = abiCoder.encode(["uint256"], [777n]);
    const retHash = ethers.keccak256(ret);
    await expect(templ.executeProposal(Number(proposalId)))
      .to.emit(templ, "ProposalExecuted")
      .withArgs(proposalId, true, retHash);

    const endingBalance = await ethers.provider.getBalance(await target.getAddress());
    expect(endingBalance).to.equal(callValue);
    expect(await target.storedValue()).to.equal(777n);
  });

  it("does not adjust access-token accounting when CallExternal moves tokens", async function () {
    const recipient = accounts[5];
    const templAddress = await templ.getAddress();
    const tokenAddress = await token.getAddress();

    const poolBefore = await templ.memberPoolBalance();
    const treasuryBefore = await templ.treasuryBalance();
    const balanceBefore = await token.balanceOf(templAddress);
    const available = balanceBefore - poolBefore;
    const transferAmount = available / 2n;

    const selector = token.interface.getFunction("transfer").selector;
    const params = abiCoder.encode(["address", "uint256"], [recipient.address, transferAmount]);

    const tx = await templ
      .connect(memberA)
      .createProposalCallExternal(
        tokenAddress,
        0,
        selector,
        params,
        VOTING_PERIOD,
        "Drain access token",
        "External transfer"
      );
    await tx.wait();
    const proposalId = (await templ.proposalCount()) - 1n;
    await templ.connect(memberB).vote(Number(proposalId), true);
    await ethers.provider.send("evm_increaseTime", [VOTING_PERIOD + 1]);
    await ethers.provider.send("evm_mine", []);

    await templ.executeProposal(Number(proposalId));

    const balanceAfter = await token.balanceOf(templAddress);
    expect(balanceAfter).to.equal(balanceBefore - transferAmount);
    expect(await templ.memberPoolBalance()).to.equal(poolBefore);
    expect(await templ.treasuryBalance()).to.equal(treasuryBefore);

    const info = await templ.getTreasuryInfo();
    expect(info.treasury).to.equal(balanceAfter - poolBefore);
  });

  it("rejects oversized external call calldata", async function () {
    const selector = target.interface.getFunction("setNumber").selector;
    const oversizedParams = `0x${"11".repeat(4093)}`;

    await expect(
      templ
        .connect(memberA)
        .createProposalCallExternal(
          await target.getAddress(),
          0,
          selector,
          oversizedParams,
          VOTING_PERIOD,
          "Oversized calldata",
          ""
        )
    ).to.be.revertedWithCustomError(templ, "InvalidCallData");
  });

  it("accepts max-sized external call params", async function () {
    const selector = target.interface.getFunction("setNumber").selector;
    const value = 123n;
    const encoded = abiCoder.encode(["uint256"], [value]);
    const paddingBytes = MAX_EXTERNAL_CALLDATA_BYTES - 4 - 32;
    const params = `0x${encoded.slice(2)}${"11".repeat(paddingBytes)}`;
    const proposalId = await executeCallProposal({
      selector,
      params,
      title: "Max calldata",
      description: ""
    });

    const proposal = await templ.proposals(proposalId);
    expect(ethers.getBytes(proposal.externalCallData).length).to.equal(MAX_EXTERNAL_CALLDATA_BYTES);

    await templ.executeProposal(Number(proposalId));
    expect(await target.storedValue()).to.equal(value);
  });
});
