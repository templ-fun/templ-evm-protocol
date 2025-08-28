const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("updateConfigDAO", function () {
    const ENTRY_FEE = ethers.parseUnits("100", 18);
    const TOKEN_SUPPLY = ethers.parseUnits("10000", 18);

    let templ;
    let token;
    let newToken;
    let member;
    let priest;

    beforeEach(async function () {
        [priest, member] = await ethers.getSigners();

        const Token = await ethers.getContractFactory("TestToken");
        token = await Token.deploy("Test Token", "TEST", 18);
        await token.waitForDeployment();
        newToken = await Token.deploy("New Token", "NEW", 18);
        await newToken.waitForDeployment();

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

        await token.mint(member.address, TOKEN_SUPPLY);
        await token.connect(member).approve(await templ.getAddress(), ENTRY_FEE);
        await templ.connect(member).purchaseAccess();
    });

    it("reverts when balances are non-zero", async function () {
        const iface = new ethers.Interface([
            "function updateConfigDAO(address,uint256)"
        ]);
        const callData = iface.encodeFunctionData("updateConfigDAO", [
            await newToken.getAddress(),
            0
        ]);

        await templ.connect(member).createProposal(
            "Change Token",
            "switch token",
            callData,
            7 * 24 * 60 * 60
        );

        await templ.connect(member).vote(0, true);
        await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
        await ethers.provider.send("evm_mine");

        await expect(templ.executeProposal(0))
            .to.be.revertedWithCustomError(templ, "NonZeroBalances");
    });
});

