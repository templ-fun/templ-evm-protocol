const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTemplModules } = require("./utils/modules");

describe("Module delegatecall guard", function () {
  it("reverts on direct module calls (onlyDelegatecall)", async function () {
    const modules = await deployTemplModules();
    const Membership = await ethers.getContractFactory("TemplMembershipModule");
    const membership = Membership.attach(modules.membershipModule);
    await expect(membership.join()).to.be.revertedWithCustomError(membership, "DelegatecallOnly");
  });

  it("reverts on direct module view calls (onlyDelegatecall)", async function () {
    const modules = await deployTemplModules();
    const Membership = await ethers.getContractFactory("TemplMembershipModule");
    const membership = Membership.attach(modules.membershipModule);
    await expect(membership.getMemberCount()).to.be.revertedWithCustomError(membership, "DelegatecallOnly");
  });

});
