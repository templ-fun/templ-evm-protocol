const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, joinMembers } = require("./utils/mintAndPurchase");

describe("Routing upgrade via setRoutingModuleDAO", function () {
  const ENTRY_FEE = ethers.parseUnits("100", 18);
  const DAY = 24 * 60 * 60;
  const VOTING_PERIOD = 7 * DAY;

  const encodeRoutingParams = (module, selectors) => {
    const coder = ethers.AbiCoder.defaultAbiCoder();
    return coder.encode(["address", "bytes4[]"], [module, selectors]);
  };

  async function proposeRoutingChange(templ, proposer, voter, module, selectors, title, description) {
    const setRouteFn = templ.interface.getFunction("setRoutingModuleDAO");
    const upgradeSelector = setRouteFn.selector;
    await templ
      .connect(proposer)
      .createProposalCallExternal(
        await templ.getAddress(),
        0,
        upgradeSelector,
        encodeRoutingParams(module, selectors),
        VOTING_PERIOD,
        title,
        description
      );
    const id = (await templ.proposalCount()) - 1n;
    await templ.connect(voter).vote(id, true);
    return id;
  }

  async function executeAfterDelay(templ, proposalId) {
    const delay = Number(await templ.postQuorumVotingPeriod());
    await ethers.provider.send("evm_increaseTime", [delay + 1]);
    await ethers.provider.send("evm_mine", []);
    return templ.executeProposal(proposalId);
  }

  it("rejects direct EOA call to setRoutingModuleDAO (NotDAO)", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, , outsider] = accounts;

    const Mock = await ethers.getContractFactory("contracts/mocks/MockMembershipOverride.sol:MockMembershipOverride");
    const mock = await Mock.deploy();
    await mock.waitForDeployment();

    const getCountIface = new ethers.Interface(["function getMemberCount() view returns (uint256)"]);
    const sel = getCountIface.getFunction("getMemberCount").selector;

    await expect(
      templ.connect(outsider).setRoutingModuleDAO(await mock.getAddress(), [sel])
    ).to.be.revertedWithCustomError(templ, "NotDAO");
  });

  it("re-routes a selector via governance and rolls back", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, priest, m1, m2, m3] = accounts;

    // Seed and join 3 members
    await mintToUsers(token, [m1, m2, m3], ENTRY_FEE * 3n);
    await joinMembers(templ, token, [m1, m2, m3]);

    const initialCount = await templ.getMemberCount();
    // Includes auto-enrolled priest + 3 joined members
    expect(initialCount).to.equal(4n);

    const Mock = await ethers.getContractFactory("contracts/mocks/MockMembershipOverride.sol:MockMembershipOverride");
    const mock = await Mock.deploy();
    await mock.waitForDeployment();
    const mockAddr = await mock.getAddress();

    const getCountIface = new ethers.Interface(["function getMemberCount() view returns (uint256)"]);
    const sel = getCountIface.getFunction("getMemberCount").selector;

    // Build CallExternal params for setRoutingModuleDAO(module, selectors)
    const setRouteFn = templ.interface.getFunction("setRoutingModuleDAO");
    const upgradeSelector = setRouteFn.selector;
    const coder = ethers.AbiCoder.defaultAbiCoder();
    const encodeParams = (module, selectors) => coder.encode(["address", "bytes4[]"], [module, selectors]);

    // Proposal A: route getMemberCount -> mock module
    await templ
      .connect(m1)
      .createProposalCallExternal(
        await templ.getAddress(),
        0,
        upgradeSelector,
        encodeParams(mockAddr, [sel]),
        VOTING_PERIOD,
        "Route getMemberCount",
        "send getMemberCount to mock"
      );
    // Pass
    await templ.connect(m1).vote(0, true);
    await templ.connect(m2).vote(0, true);
    await ethers.provider.send("evm_increaseTime", [VOTING_PERIOD + DAY]);
    await ethers.provider.send("evm_mine", []);
    await templ.executeProposal(0);

    // Selector should now resolve to mock's implementation (constant)
    const mocked = await templ.getMemberCount();
    expect(mocked).to.equal(424242n);

    // Proposal B: rollback routing back to original membership module
    const membershipModule = await templ.MEMBERSHIP_MODULE();
    await templ
      .connect(m2)
      .createProposalCallExternal(
        await templ.getAddress(),
        0,
        upgradeSelector,
        encodeParams(membershipModule, [sel]),
        VOTING_PERIOD,
        "Rollback getMemberCount",
        "restore default routing"
      );
    await templ.connect(m2).vote(1, true);
    await templ.connect(m3).vote(1, true);
    await ethers.provider.send("evm_increaseTime", [VOTING_PERIOD + DAY]);
    await ethers.provider.send("evm_mine", []);
    await templ.executeProposal(1);

    const restored = await templ.getMemberCount();
    expect(restored).to.equal(initialCount);
  });

  it("emits RoutingUpdated event on successful routing change", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, priest, m1, m2] = accounts;

    await mintToUsers(token, [m1, m2], ENTRY_FEE * 3n);
    await joinMembers(templ, token, [m1, m2]);

    const Mock = await ethers.getContractFactory("contracts/mocks/MockMembershipOverride.sol:MockMembershipOverride");
    const mock = await Mock.deploy();
    await mock.waitForDeployment();
    const mockAddr = await mock.getAddress();

    const getCountIface = new ethers.Interface(["function getMemberCount() view returns (uint256)"]);
    const sel = getCountIface.getFunction("getMemberCount").selector;

    const setRouteFn = templ.interface.getFunction("setRoutingModuleDAO");
    const upgradeSelector = setRouteFn.selector;
    const coder = ethers.AbiCoder.defaultAbiCoder();
    const encodeParams = (module, selectors) => coder.encode(["address", "bytes4[]"], [module, selectors]);

    await templ
      .connect(m1)
      .createProposalCallExternal(
        await templ.getAddress(),
        0,
        upgradeSelector,
        encodeParams(mockAddr, [sel]),
        VOTING_PERIOD,
        "Route getMemberCount",
        "send getMemberCount to mock"
      );

    await templ.connect(m1).vote(0, true);
    await templ.connect(m2).vote(0, true);
    await ethers.provider.send("evm_increaseTime", [VOTING_PERIOD + DAY]);
    await ethers.provider.send("evm_mine", []);

    // Execute and check for event emission
    const tx = await templ.executeProposal(0);
    const receipt = await tx.wait();

    // Find the RoutingUpdated event in the logs
    const event = receipt.logs.find(
      (log) => {
        try {
          const parsed = templ.interface.parseLog(log);
          return parsed && parsed.name === "RoutingUpdated";
        } catch {
          return false;
        }
      }
    );

    expect(event).to.not.be.undefined;
    const parsed = templ.interface.parseLog(event);
    expect(parsed.args.module).to.equal(mockAddr);
    expect(parsed.args.selectors).to.deep.equal([sel]);
  });

  it("reverts when module address is zero", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, , proposer, voter] = accounts;
    await mintToUsers(token, [proposer, voter], ENTRY_FEE * 2n);
    await joinMembers(templ, token, [proposer, voter]);

    const getCountIface = new ethers.Interface(["function getMemberCount() view returns (uint256)"]);
    const sel = getCountIface.getFunction("getMemberCount").selector;

    const id = await proposeRoutingChange(
      templ,
      proposer,
      voter,
      ethers.ZeroAddress,
      [sel],
      "Route zero",
      "invalid module"
    );
    await expect(executeAfterDelay(templ, id)).to.be.revertedWithCustomError(templ, "InvalidRecipient");
  });

  it("reverts when module is not a contract (EOA)", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, , proposer, voter, eoa] = accounts;
    await mintToUsers(token, [proposer, voter], ENTRY_FEE * 2n);
    await joinMembers(templ, token, [proposer, voter]);

    const getCountIface = new ethers.Interface(["function getMemberCount() view returns (uint256)"]);
    const sel = getCountIface.getFunction("getMemberCount").selector;

    const id = await proposeRoutingChange(
      templ,
      proposer,
      voter,
      eoa.address,
      [sel],
      "Route EOA",
      "invalid module"
    );
    await expect(executeAfterDelay(templ, id)).to.be.revertedWithCustomError(templ, "InvalidCallData");
  });

  it("reverts when selectors array is empty", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, , proposer, voter] = accounts;
    await mintToUsers(token, [proposer, voter], ENTRY_FEE * 2n);
    await joinMembers(templ, token, [proposer, voter]);

    const Mock = await ethers.getContractFactory("contracts/mocks/MockMembershipOverride.sol:MockMembershipOverride");
    const mock = await Mock.deploy();
    await mock.waitForDeployment();

    const id = await proposeRoutingChange(
      templ,
      proposer,
      voter,
      await mock.getAddress(),
      [],
      "Route empty",
      "empty selectors"
    );
    await expect(executeAfterDelay(templ, id)).to.be.revertedWithCustomError(templ, "InvalidCallData");
  });

  it("updates routing for multiple selectors in a single call", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, , proposer, voter] = accounts;

    await mintToUsers(token, [proposer, voter], ENTRY_FEE * 2n);
    await joinMembers(templ, token, [proposer, voter]);

    const Mock = await ethers.getContractFactory("contracts/mocks/MockMembershipOverride.sol:MockMembershipOverride");
    const mock = await Mock.deploy();
    await mock.waitForDeployment();
    const mockAddr = await mock.getAddress();

    const getCountIface = new ethers.Interface(["function getMemberCount() view returns (uint256)"]);
    const isMemberIface = new ethers.Interface(["function isMember(address) view returns (bool)"]);
    const countSel = getCountIface.getFunction("getMemberCount").selector;
    const memberSel = isMemberIface.getFunction("isMember").selector;

    // Update routing for both selectors at once
    const id = await proposeRoutingChange(
      templ,
      proposer,
      voter,
      mockAddr,
      [countSel, memberSel],
      "Route multiple",
      "multi-selector update"
    );
    await executeAfterDelay(templ, id);

    // Verify both selectors are routed to the mock
    const countModule = await templ.getModuleForSelector(countSel);
    const memberModule = await templ.getModuleForSelector(memberSel);

    expect(countModule).to.equal(mockAddr);
    expect(memberModule).to.equal(mockAddr);
  });

  it("verifies getModuleForSelector reflects routing changes", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, , proposer, voter] = accounts;

    await mintToUsers(token, [proposer, voter], ENTRY_FEE * 2n);
    await joinMembers(templ, token, [proposer, voter]);

    const Mock = await ethers.getContractFactory("contracts/mocks/MockMembershipOverride.sol:MockMembershipOverride");
    const mock = await Mock.deploy();
    await mock.waitForDeployment();
    const mockAddr = await mock.getAddress();

    const getCountIface = new ethers.Interface(["function getMemberCount() view returns (uint256)"]);
    const sel = getCountIface.getFunction("getMemberCount").selector;

    // Check initial routing
    const membershipModule = await templ.MEMBERSHIP_MODULE();
    const initialModule = await templ.getModuleForSelector(sel);
    expect(initialModule).to.equal(membershipModule);

    // Update routing
    const updateId = await proposeRoutingChange(
      templ,
      proposer,
      voter,
      mockAddr,
      [sel],
      "Route single",
      "update module"
    );
    await executeAfterDelay(templ, updateId);

    // Verify new routing
    const updatedModule = await templ.getModuleForSelector(sel);
    expect(updatedModule).to.equal(mockAddr);

    // Rollback
    const rollbackId = await proposeRoutingChange(
      templ,
      proposer,
      voter,
      membershipModule,
      [sel],
      "Rollback",
      "restore module"
    );
    await executeAfterDelay(templ, rollbackId);

    // Verify rollback
    const rolledBackModule = await templ.getModuleForSelector(sel);
    expect(rolledBackModule).to.equal(membershipModule);
  });
});
