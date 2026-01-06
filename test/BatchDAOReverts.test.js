const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, joinMembers } = require("./utils/mintAndPurchase");
const { deployTemplModules } = require("./utils/modules");
const { attachTemplInterface } = require("./utils/templ");

describe("batchDAO invalid input handling", function () {
  const ENTRY_FEE = ethers.parseUnits("100", 18);

  it("onlyDAO direct calls: rejects empty/mismatched arrays and zero targets", async function () {
    const [, priest, protocol] = await ethers.getSigners();
    const AccessToken = await ethers.getContractFactory("contracts/mocks/TestToken.sol:TestToken");
    const accessToken = await AccessToken.deploy("Access", "ACC", 18);
    await accessToken.waitForDeployment();
    const Harness = await ethers.getContractFactory(
      "contracts/mocks/DaoCallerHarness.sol:DaoCallerHarness"
    );
    const modules = await deployTemplModules();
    let templ = await Harness.deploy(
      priest.address,
      protocol.address,
      accessToken.target,
      ENTRY_FEE,
      modules.membershipModule,
      modules.treasuryModule,
      modules.governanceModule,
      modules.councilModule
    );
    await templ.waitForDeployment();
    templ = await attachTemplInterface(templ);

    // Empty arrays
    await expect(
      templ.daoBatch([], [], [])
    ).to.be.revertedWithCustomError(templ, "InvalidCallData");

    // Mismatched lengths
    const router = await templ.getAddress();
    await expect(
      templ.daoBatch([router], [], [])
    ).to.be.revertedWithCustomError(templ, "InvalidCallData");

    // Zero target
    await expect(
      templ.daoBatch([ethers.ZeroAddress], [0], ["0x"])
    ).to.be.revertedWithCustomError(templ, "InvalidRecipient");
  });

  it("governance CallExternal path: bubbles InvalidCallData/InvalidRecipient from batchDAO", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE, executionDelay: 60 * 60 });
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
    const delay = Number(await templ.postQuorumVotingPeriod());
    await ethers.provider.send("evm_increaseTime", [delay + 1]);
    await ethers.provider.send("evm_mine", []);
    await expect(templ.executeProposal(id)).to.be.revertedWithCustomError(templ, "InvalidCallData");

    // 2) Zero target → InvalidRecipient
    await templ
      .connect(m1)
      .createProposalCallExternal(router, 0, batchSel, enc([ethers.ZeroAddress], [0], ["0x"]), 0, "batch zero", "");
    id = (await templ.proposalCount()) - 1n;
    await templ.connect(m2).vote(id, true);
    await ethers.provider.send("evm_increaseTime", [delay + 1]);
    await ethers.provider.send("evm_mine", []);
    await expect(templ.executeProposal(id)).to.be.revertedWithCustomError(templ, "InvalidRecipient");
  });

  it("onlyDAO batch bubbles revert from a later call", async function () {
    const [, priest, protocol] = await ethers.getSigners();
    const AccessToken = await ethers.getContractFactory("contracts/mocks/TestToken.sol:TestToken");
    const accessToken = await AccessToken.deploy("Access", "ACC", 18);
    await accessToken.waitForDeployment();
    const Harness = await ethers.getContractFactory(
      "contracts/mocks/DaoCallerHarness.sol:DaoCallerHarness"
    );
    const modules = await deployTemplModules();
    let templ = await Harness.deploy(
      priest.address,
      protocol.address,
      accessToken.target,
      ENTRY_FEE,
      modules.membershipModule,
      modules.treasuryModule,
      modules.governanceModule,
      modules.councilModule
    );
    await templ.waitForDeployment();
    templ = await attachTemplInterface(templ);

    const Target = await ethers.getContractFactory("contracts/mocks/ExternalCallTarget.sol:ExternalCallTarget");
    const target = await Target.deploy();
    await target.waitForDeployment();

    const ok = target.interface.encodeFunctionData("setNumber", [1]);
    const bad = target.interface.getFunction("willRevert").selector + ""; // no params

    // First call succeeds, second reverts -> whole batch reverts bubbling child error
    await expect(
      templ.daoBatch([target.target, target.target], [0, 0], [ok, bad])
    ).to.be.revertedWithCustomError(target, "ExternalCallFailure");
  });
});
