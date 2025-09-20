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
        const protocolPercent = 12;
        const factory = await Factory.deploy(protocolRecipient.address, protocolPercent);
        await factory.waitForDeployment();

        const burnPercent = 28;
        const treasuryPercent = 40;
        const memberPoolPercent = 20;
        const quorumPercent = 40;
        const executionDelaySeconds = 5 * 24 * 60 * 60;
        const customBurnAddress = "0x00000000000000000000000000000000000000AA";

        const config = {
            priest: priest.address,
            token: await token.getAddress(),
            entryFee: ENTRY_FEE,
            burnPercent,
            treasuryPercent,
            memberPoolPercent,
            quorumPercent,
            executionDelaySeconds,
            burnAddress: customBurnAddress
        };

        const templAddress = await factory.createTemplWithConfig.staticCall(config);
        const tx = await factory.createTemplWithConfig(config);
        await tx.wait();

        const templ = await ethers.getContractAt("TEMPL", templAddress);

        expect(await templ.priest()).to.equal(priest.address);
        expect(await templ.protocolFeeRecipient()).to.equal(protocolRecipient.address);
        expect(await templ.protocolPercent()).to.equal(protocolPercent);
        expect(await templ.burnPercent()).to.equal(burnPercent);
        expect(await templ.treasuryPercent()).to.equal(treasuryPercent);
        expect(await templ.memberPoolPercent()).to.equal(memberPoolPercent);
        expect(await templ.quorumPercent()).to.equal(quorumPercent);
        expect(await templ.executionDelayAfterQuorum()).to.equal(executionDelaySeconds);
        expect(await templ.burnAddress()).to.equal(customBurnAddress);

        await mintToUsers(token, [member], ENTRY_FEE * 10n);
        await purchaseAccess(templ, token, [member]);

        const burnAmount = (ENTRY_FEE * BigInt(burnPercent)) / 100n;
        const memberPoolAmount = (ENTRY_FEE * BigInt(memberPoolPercent)) / 100n;
        const protocolAmount = (ENTRY_FEE * BigInt(protocolPercent)) / 100n;

        expect(await templ.totalBurned()).to.equal(burnAmount);
        expect(await templ.totalToMemberPool()).to.equal(memberPoolAmount);
        expect(await templ.totalToProtocol()).to.equal(protocolAmount);
        expect(await templ.totalToTreasury()).to.be.gte((ENTRY_FEE * BigInt(treasuryPercent)) / 100n);
    });

    it("reverts when fee split does not sum to 100", async function () {
        const [deployer, , protocolRecipient] = await ethers.getSigners();
        const token = await deployToken("Bad", "BAD");
        const Factory = await ethers.getContractFactory("TemplFactory");
        const factory = await Factory.deploy(protocolRecipient.address, 15);
        await factory.waitForDeployment();

        await expect(
            factory.createTemplWithConfig({
                priest: protocolRecipient.address,
                token: await token.getAddress(),
                entryFee: ENTRY_FEE,
                burnPercent: 40,
                treasuryPercent: 40,
                memberPoolPercent: 10,
                quorumPercent: 33,
                executionDelaySeconds: 7 * 24 * 60 * 60,
                burnAddress: ethers.ZeroAddress
            })
        ).to.be.revertedWithCustomError(factory, "InvalidPercentageSplit");
    });

    it("defaults splits, priest, quorum and delay when using simple create", async function () {
        const [deployer, , protocolRecipient] = await ethers.getSigners();
        const token = await deployToken("Defaults", "DEF");
        const Factory = await ethers.getContractFactory("TemplFactory");
        const factory = await Factory.deploy(protocolRecipient.address, 10);
        await factory.waitForDeployment();

        const templAddress = await factory.createTempl.staticCall(await token.getAddress(), ENTRY_FEE);
        const tx = await factory.createTempl(await token.getAddress(), ENTRY_FEE);
        await tx.wait();

        const templ = await ethers.getContractAt("TEMPL", templAddress);

        expect(await templ.priest()).to.equal(deployer.address);
        expect(await templ.burnPercent()).to.equal(30);
        expect(await templ.treasuryPercent()).to.equal(30);
        expect(await templ.memberPoolPercent()).to.equal(30);
        expect(await templ.protocolPercent()).to.equal(10);
        expect(await templ.quorumPercent()).to.equal(33);
        expect(await templ.executionDelayAfterQuorum()).to.equal(7 * 24 * 60 * 60);
        expect(await templ.burnAddress()).to.equal("0x000000000000000000000000000000000000dEaD");
    });

    it("patches optional fields to defaults when config omits them", async function () {
        const [deployer, , protocolRecipient] = await ethers.getSigners();
        const token = await deployToken("Patched", "PTC");
        const Factory = await ethers.getContractFactory("TemplFactory");
        const factory = await Factory.deploy(protocolRecipient.address, 10);
        await factory.waitForDeployment();

        const config = {
            priest: ethers.ZeroAddress,
            token: await token.getAddress(),
            entryFee: ENTRY_FEE,
            burnPercent: 0,
            treasuryPercent: 0,
            memberPoolPercent: 0,
            quorumPercent: 0,
            executionDelaySeconds: 0,
            burnAddress: ethers.ZeroAddress
        };

        const templAddress = await factory.createTemplWithConfig.staticCall(config);
        await (await factory.createTemplWithConfig(config)).wait();

        const templ = await ethers.getContractAt("TEMPL", templAddress);

        expect(await templ.priest()).to.equal(deployer.address);
        expect(await templ.quorumPercent()).to.equal(33);
        expect(await templ.executionDelayAfterQuorum()).to.equal(7 * 24 * 60 * 60);
        expect(await templ.burnAddress()).to.equal("0x000000000000000000000000000000000000dEaD");
        expect(await templ.burnPercent()).to.equal(30);
        expect(await templ.treasuryPercent()).to.equal(30);
        expect(await templ.memberPoolPercent()).to.equal(30);
    });
});
