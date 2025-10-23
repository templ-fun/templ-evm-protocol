const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, joinMembers } = require("./utils/mintAndPurchase");

describe("Governance external call batching via executor", function () {
  const ENTRY_FEE = ethers.parseUnits("100", 18);
  const VOTING_PERIOD = 7 * 24 * 60 * 60;

  let templ;
  let token;
  let accounts;
  let owner;
  let m1;
  let m2;

  const abi = ethers.AbiCoder.defaultAbiCoder();

  beforeEach(async function () {
    ({ templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE }));
    [owner, , m1, m2] = accounts;
    await mintToUsers(token, [m1, m2], ENTRY_FEE * 100n);
    await joinMembers(templ, token, [m1, m2]);
  });

  async function pass(proposalId) {
    await templ.connect(m2).vote(Number(proposalId), true);
    await ethers.provider.send("evm_increaseTime", [VOTING_PERIOD + 1]);
    await ethers.provider.send("evm_mine", []);
  }

  it("executes approve + stake atomically in-order via TEMPL batchDAO", async function () {
    // Deploy a staking target
    const Staking = await ethers.getContractFactory("contracts/mocks/MockStaking.sol:MockStaking");
    const staking = await Staking.deploy();
    await staking.waitForDeployment();

    const amount = ENTRY_FEE; // stake an amount templ holds after joins
    const tokenAddr = await token.getAddress();
    const templAddr = await templ.getAddress();
    const stakingAddr = await staking.getAddress();

    // Build batched calls: approve(spender, amount), stake(token, amount)
    const approveSel = token.interface.getFunction("approve").selector;
    const approveParams = abi.encode(["address","uint256"], [stakingAddr, amount]);
    const stakeSel = staking.interface.getFunction("stake").selector;
    const stakeParams = abi.encode(["address","uint256"], [tokenAddr, amount]);

    const targets = [tokenAddr, stakingAddr];
    const values = [0n, 0n];
    const datas = [
      ethers.concat([approveSel, approveParams]),
      ethers.concat([stakeSel, stakeParams])
    ];
    const execSel = templ.interface.getFunction("batchDAO").selector;
    const execParams = abi.encode(["address[]","uint256[]","bytes[]"], [targets, values, datas]);

    const tx = await templ
      .connect(m1)
      .createProposalCallExternal(
        await templ.getAddress(),
        0n,
        execSel,
        execParams,
        VOTING_PERIOD,
        "Approve + Stake",
        "Stake treasury tokens"
      );
    await tx.wait();
    const proposalId = (await templ.proposalCount()) - 1n;

    await pass(proposalId);

    const balBefore = await token.balanceOf(templAddr);
    const stakedBefore = await staking.staked(templAddr);

    await expect(templ.executeProposal(Number(proposalId)))
      .to.emit(templ, "ProposalExecuted");

    const balAfter = await token.balanceOf(templAddr);
    const stakedAfter = await staking.staked(templAddr);

    expect(stakedAfter - stakedBefore).to.equal(amount);
    expect(balBefore - balAfter).to.equal(amount);
  });

  it("reverts atomically when a later call fails via TEMPL batchDAO", async function () {
    const Target = await ethers.getContractFactory("contracts/mocks/ExternalCallTarget.sol:ExternalCallTarget");
    const target = await Target.deploy();
    await target.waitForDeployment();

    const setSel = target.interface.getFunction("setNumber").selector;
    const setParams = abi.encode(["uint256"], [42n]);
    const revertSel = target.interface.getFunction("willRevert").selector;
    const datas = [ethers.concat([setSel, setParams]), ethers.concat([revertSel, "0x"])]
    const execSel = templ.interface.getFunction("batchDAO").selector;
    const execParams = abi.encode(["address[]","uint256[]","bytes[]"], [[await target.getAddress(), await target.getAddress()], [0n,0n], datas]);

    const tx = await templ
      .connect(m1)
      .createProposalCallExternal(
        await templ.getAddress(),
        0n,
        execSel,
        execParams,
        VOTING_PERIOD,
        "Batch with revert",
        "Should bubble revert"
      );
    await tx.wait();
    const proposalId = (await templ.proposalCount()) - 1n;
    await pass(proposalId);

    await expect(templ.executeProposal(Number(proposalId)))
      .to.be.revertedWithCustomError(target, "ExternalCallFailure")
      .withArgs(42);
  });
});
