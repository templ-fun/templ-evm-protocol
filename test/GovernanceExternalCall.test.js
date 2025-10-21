const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, joinMembers } = require("./utils/mintAndPurchase");

describe("Governance external call proposals", function () {
  const ENTRY_FEE = ethers.parseUnits("100", 18);
  const VOTING_PERIOD = 7 * 24 * 60 * 60;

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
    await expect(templ.executeProposal(Number(proposalId)))
      .to.emit(templ, "ProposalExecuted")
      .withArgs(proposalId, true, expectedReturn);

    expect(await target.storedValue()).to.equal(123n);
  });

  it("bubbles up external call reverts", async function () {
    const selector = target.interface.getFunction("willRevert").selector;
    const proposalId = await executeCallProposal({ selector });

    await expect(templ.executeProposal(Number(proposalId)))
      .to.be.revertedWithCustomError(target, "ExternalCallFailure")
      .withArgs(42);
  });

  it("forwards call value to external targets", async function () {
    const selector = target.interface.getFunction("setNumberPayable").selector;
    const params = abiCoder.encode(["uint256"], [777n]);
    const callValue = ethers.parseEther("0.25");

    await owner.sendTransaction({ to: await templ.getAddress(), value: callValue });
    const startingBalance = await ethers.provider.getBalance(await target.getAddress());
    expect(startingBalance).to.equal(0n);

    const proposalId = await executeCallProposal({ selector, params, value: callValue });
    await expect(templ.executeProposal(Number(proposalId)))
      .to.emit(templ, "ProposalExecuted")
      .withArgs(proposalId, true, abiCoder.encode(["uint256"], [777n]));

    const endingBalance = await ethers.provider.getBalance(await target.getAddress());
    expect(endingBalance).to.equal(callValue);
    expect(await target.storedValue()).to.equal(777n);
  });
});
