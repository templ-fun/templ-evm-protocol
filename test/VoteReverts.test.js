const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Vote reverts", function () {
    let templ;
    let token;
    let owner, priest, member1;
    const ENTRY_FEE = ethers.parseUnits("100", 18);
    const TOKEN_SUPPLY = ethers.parseUnits("10000", 18);

    beforeEach(async function () {
        [owner, priest, member1] = await ethers.getSigners();

        const Token = await ethers.getContractFactory("TestToken");
        token = await Token.deploy("Test Token", "TEST", 18);
        await token.waitForDeployment();

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

        await token.mint(member1.address, TOKEN_SUPPLY);
        await token.connect(member1).approve(await templ.getAddress(), ENTRY_FEE);
        await templ.connect(member1).purchaseAccess();
    });

    it("reverts when voting on non-existent proposal", async function () {
        await expect(templ.connect(member1).vote(999, true))
            .to.be.revertedWithCustomError(templ, "InvalidProposal");
    });

    it("reverts when voting after endTime", async function () {
        const iface = new ethers.Interface([
            "function withdrawTreasuryDAO(address,uint256,string)"
        ]);
        const callData = iface.encodeFunctionData("withdrawTreasuryDAO", [
            member1.address,
            ethers.parseUnits("10", 18),
            "Test"
        ]);

        await templ.connect(member1).createProposal(
            "Test Proposal",
            "Test description",
            callData,
            7 * 24 * 60 * 60
        );

        await ethers.provider.send("evm_increaseTime", [7 * 24 * 60 * 60 + 1]);
        await ethers.provider.send("evm_mine");

        await expect(templ.connect(member1).vote(0, true))
            .to.be.revertedWithCustomError(templ, "VotingEnded");
    });
});

