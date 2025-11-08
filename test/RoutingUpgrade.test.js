const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, joinMembers } = require("./utils/mintAndPurchase");

describe("Routing upgrade via setRoutingModuleDAO", function () {
  const ENTRY_FEE = ethers.parseUnits("100", 18);
  const DAY = 24 * 60 * 60;
  const VOTING_PERIOD = 7 * DAY;

  it("rejects direct EOA call when not dictatorship (NotDAO)", async function () {
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
});
