const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, joinMembers } = require("./utils/mintAndPurchase");

describe("Join guard", function () {
  const ENTRY_FEE = ethers.parseUnits("100", 18);
  let templ, token;
  let owner, priest, member;
  let accounts;

  beforeEach(async function () {
    ({ templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE }));
    [owner, priest, member] = accounts;

    await mintToUsers(token, [member], ethers.parseUnits("1000", 18));
    await joinMembers(templ, token, [member]);
  });

  it("does not expose arbitrary proposal entrypoints (typed-only governance)", async function () {
    expect(typeof templ.createProposal).to.equal('undefined');
  });

  it("reverts when DAO invokes helper calling join", async function () {
    const Caller = await ethers.getContractFactory(
      "contracts/mocks/JoinCaller.sol:JoinCaller"
    );
    const caller = await Caller.deploy(await templ.getAddress());
    await caller.waitForDeployment();

    const templAddress = await templ.getAddress();
    // fund DAO address with ETH for tx fees
    await owner.sendTransaction({
      to: templAddress,
      value: ethers.parseEther("1"),
    });

    // impersonate DAO
    await ethers.provider.send("hardhat_impersonateAccount", [templAddress]);
    const dao = await ethers.getSigner(templAddress);

    await expect(
      caller.connect(dao).callJoin()
    ).to.be.revertedWithCustomError(templ, "InsufficientBalance");

    await ethers.provider.send("hardhat_stopImpersonatingAccount", [templAddress]);
  });

  it("reverts when DAO calls join directly", async function () {
    const templAddress = await templ.getAddress();

    // fund DAO address with ETH for gas
    await owner.sendTransaction({
      to: templAddress,
      value: ethers.parseEther("1"),
    });

    // impersonate DAO
    await ethers.provider.send("hardhat_impersonateAccount", [templAddress]);
    const dao = await ethers.getSigner(templAddress);

    await expect(
      templ.connect(dao).join()
    ).to.be.revertedWithCustomError(templ, "InvalidSender");

    await ethers.provider.send("hardhat_stopImpersonatingAccount", [templAddress]);
  });
});
