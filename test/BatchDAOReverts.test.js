const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, joinMembers } = require("./utils/mintAndPurchase");

describe("batchDAO invalid input handling", function () {
  const ENTRY_FEE = ethers.parseUnits("100", 18);
  const DAY = 24 * 60 * 60;

  it("onlyDAO direct calls: rejects empty/mismatched arrays and zero targets", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, priest, member] = accounts;

    await mintToUsers(token, [member], ENTRY_FEE * 3n);
    await joinMembers(templ, token, [member]);

    // Enable dictatorship to access onlyDAO APIs directly
    await templ
      .connect(member)
      .createProposalSetDictatorship(true, 7 * DAY, "Enable", "Dictatorship on");
    await templ.connect(member).vote(0, true);
    await ethers.provider.send("evm_increaseTime", [7 * DAY + 1]);
    await ethers.provider.send("evm_mine", []);
    await templ.executeProposal(0);
    expect(await templ.priestIsDictator()).to.equal(true);

    // Empty arrays
    await expect(
      templ.connect(priest).batchDAO([], [], [])
    ).to.be.revertedWithCustomError(templ, "InvalidCallData");

    // Mismatched lengths
    const router = await templ.getAddress();
    await expect(
      templ.connect(priest).batchDAO([router], [], [])
    ).to.be.revertedWithCustomError(templ, "InvalidCallData");

    // Zero target
    await expect(
      templ.connect(priest).batchDAO([ethers.ZeroAddress], [0], ["0x"])
    ).to.be.revertedWithCustomError(templ, "InvalidRecipient");
  });

  it("governance CallExternal path: bubbles InvalidCallData/InvalidRecipient from batchDAO", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE, executionDelay: 2 });
    const [, , m1, m2] = accounts;
    await mintToUsers(token, [m1, m2], ENTRY_FEE * 4n);
    await joinMembers(templ, token, [m1, m2]);

    const router = await templ.getAddress();
    const batchSel = templ.interface.getFunction("batchDAO").selector;

    const abi = ethers.AbiCoder.defaultAbiCoder();
    const enc = (targets, values, calldatas) => abi.encode(["address[]","uint256[]","bytes[]"],[targets, values, calldatas]);

    // 1) Mismatched arrays → InvalidCallData
    await templ
      .connect(m1)
      .createProposalCallExternal(router, 0, batchSel, enc([router], [], []), 0, "batch bad lens", "");
    let id = (await templ.proposalCount()) - 1n;
    await templ.connect(m2).vote(id, true);
    await ethers.provider.send("evm_increaseTime", [3]);
    await ethers.provider.send("evm_mine", []);
    await expect(templ.executeProposal(id)).to.be.revertedWithCustomError(templ, "InvalidCallData");

    // 2) Zero target → InvalidRecipient
    await templ
      .connect(m1)
      .createProposalCallExternal(router, 0, batchSel, enc([ethers.ZeroAddress], [0], ["0x"]), 0, "batch zero", "");
    id = (await templ.proposalCount()) - 1n;
    await templ.connect(m2).vote(id, true);
    await ethers.provider.send("evm_increaseTime", [3]);
    await ethers.provider.send("evm_mine", []);
    await expect(templ.executeProposal(id)).to.be.revertedWithCustomError(templ, "InvalidRecipient");
  });

  it("onlyDAO batch bubbles revert from a later call", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, priest, m] = accounts;
    await mintToUsers(token, [m], ENTRY_FEE * 3n);
    await joinMembers(templ, token, [m]);

    // Enable dictatorship -> onlyDAO allowed
    await templ.connect(m).createProposalSetDictatorship(true, 7 * DAY, "Enable", "");
    await templ.connect(m).vote(0, true);
    await ethers.provider.send("evm_increaseTime", [7 * DAY + 1]);
    await ethers.provider.send("evm_mine", []);
    await templ.executeProposal(0);

    const Target = await ethers.getContractFactory("contracts/mocks/ExternalCallTarget.sol:ExternalCallTarget");
    const target = await Target.deploy();
    await target.waitForDeployment();

    const ok = target.interface.encodeFunctionData("setNumber", [1]);
    const bad = target.interface.getFunction("willRevert").selector + ""; // no params

    // First call succeeds, second reverts -> whole batch reverts bubbling child error
    await expect(
      templ
        .connect(priest)
        .batchDAO([target.target, target.target], [0, 0], [ok, bad])
    ).to.be.revertedWithCustomError(target, "ExternalCallFailure");
  });
});
