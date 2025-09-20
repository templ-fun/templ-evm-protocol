const { expect } = require("chai");
const { ethers } = require("hardhat");
const { mintToUsers, purchaseAccess } = require("./utils/mintAndPurchase");

describe("TemplFactory", function () {
    const ENTRY_FEE = ethers.parseUnits("100", 18);

    async function deployToken(name = "Test", symbol = "TEST") {
        const Token = await ethers.getContractFactory("contracts/mocks/TestToken.sol:TestToken");
        const token = await Token.deploy(name, symbol, 18);
        await token.waitForDeployment();
        return token;
    }

    it("deploys templ contracts with fixed protocol config", async function () {
        const [, priest, protocolRecipient, member] = await ethers.getSigners();
        const token = await deployToken();

        const Factory = await ethers.getContractFactory("TemplFactory");
        const protocolBP = 12;
        const factory = await Factory.deploy(protocolRecipient.address, protocolBP);
        await factory.waitForDeployment();

        const burnBP = 28;
        const treasuryBP = 40;
        const memberPoolBP = 20;

        const templAddress = await factory.createTempl.staticCall(
            priest.address,
            await token.getAddress(),
            ENTRY_FEE,
            burnBP,
            treasuryBP,
            memberPoolBP
        );
        const tx = await factory.createTempl(
            priest.address,
            await token.getAddress(),
            ENTRY_FEE,
            burnBP,
            treasuryBP,
            memberPoolBP
        );
        await tx.wait();

        const templ = await ethers.getContractAt("TEMPL", templAddress);

        expect(await templ.priest()).to.equal(priest.address);
        expect(await templ.protocolFeeRecipient()).to.equal(protocolRecipient.address);
        expect(await templ.protocolBP()).to.equal(protocolBP);
        expect(await templ.burnBP()).to.equal(burnBP);
        expect(await templ.treasuryBP()).to.equal(treasuryBP);
        expect(await templ.memberPoolBP()).to.equal(memberPoolBP);

        await mintToUsers(token, [member], ENTRY_FEE * 10n);
        await purchaseAccess(templ, token, [member]);

        const burnAmount = (ENTRY_FEE * BigInt(burnBP)) / 100n;
        const memberPoolAmount = (ENTRY_FEE * BigInt(memberPoolBP)) / 100n;
        const protocolAmount = (ENTRY_FEE * BigInt(protocolBP)) / 100n;

        expect(await templ.totalBurned()).to.equal(burnAmount);
        expect(await templ.totalToMemberPool()).to.equal(memberPoolAmount);
        expect(await templ.totalToProtocol()).to.equal(protocolAmount);
        expect(await templ.totalToTreasury()).to.be.gte((ENTRY_FEE * BigInt(treasuryBP)) / 100n);
    });

    it("reverts when fee split does not sum to 100", async function () {
        const [, , protocolRecipient] = await ethers.getSigners();
        const token = await deployToken("Bad", "BAD");
        const Factory = await ethers.getContractFactory("TemplFactory");
        const factory = await Factory.deploy(protocolRecipient.address, 15);
        await factory.waitForDeployment();

        await expect(
            factory.createTempl(
                protocolRecipient.address,
                await token.getAddress(),
                ENTRY_FEE,
                40,
                40,
                10
            )
        ).to.be.revertedWithCustomError(factory, "InvalidFeeSplit");
    });
});
