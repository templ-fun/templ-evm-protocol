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

  it("reverts when protocol recipient is the zero address", async function () {
    const Factory = await ethers.getContractFactory("TemplFactory");
    await expect(Factory.deploy(ethers.ZeroAddress, 10)).to.be.revertedWithCustomError(
      Factory,
      "InvalidRecipient"
    );
  });

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

        const homeLink = "https://templ.fun/example";
        const config = {
            priest: priest.address,
            token: await token.getAddress(),
            entryFee: ENTRY_FEE,
            burnPercent,
            treasuryPercent,
            memberPoolPercent,
            quorumPercent,
            executionDelaySeconds,
            burnAddress: customBurnAddress,
            priestIsDictator: false,
            maxMembers: 0,
            homeLink
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
        expect(await templ.MAX_MEMBERS()).to.equal(0n);
        expect(await templ.templHomeLink()).to.equal(homeLink);

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

    it("enables priest dictatorship when requested in config", async function () {
        const [, priest, protocolRecipient] = await ethers.getSigners();
        const token = await deployToken("Dict", "DICT");

        const Factory = await ethers.getContractFactory("TemplFactory");
        const protocolPercent = 10;
        const factory = await Factory.deploy(protocolRecipient.address, protocolPercent);
        await factory.waitForDeployment();

        const config = {
            priest: priest.address,
            token: await token.getAddress(),
            entryFee: ENTRY_FEE,
            burnPercent: 30,
            treasuryPercent: 30,
            memberPoolPercent: 30,
            quorumPercent: 33,
            executionDelaySeconds: 7 * 24 * 60 * 60,
            burnAddress: ethers.ZeroAddress,
            priestIsDictator: true,
            maxMembers: 0,
            homeLink: "",
        };

        const templAddress = await factory.createTemplWithConfig.staticCall(config);
        const tx = await factory.createTemplWithConfig(config);
        const receipt = await tx.wait();

        const templ = await ethers.getContractAt("TEMPL", templAddress);
        expect(await templ.priestIsDictator()).to.equal(true);

        const templCreated = receipt.logs
            .map((log) => {
                try {
                    return factory.interface.parseLog(log);
                } catch (_) {
                    return null;
                }
            })
            .find((log) => log && log.name === "TemplCreated");

        expect(templCreated).to.not.equal(undefined);
        expect(templCreated.args.priestIsDictator).to.equal(true);
        expect(templCreated.args.maxMembers).to.equal(0n);
        expect(templCreated.args.homeLink).to.equal("");
    });

    it("sets and emits the member limit when provided", async function () {
        const [, priest, protocolRecipient] = await ethers.getSigners();
        const token = await deployToken("Limit", "LIM");

        const Factory = await ethers.getContractFactory("TemplFactory");
        const factory = await Factory.deploy(protocolRecipient.address, 12);
        await factory.waitForDeployment();

        const config = {
            priest: priest.address,
            token: await token.getAddress(),
            entryFee: ENTRY_FEE,
            burnPercent: 30,
            treasuryPercent: 30,
            memberPoolPercent: 28,
            quorumPercent: 33,
            executionDelaySeconds: 7 * 24 * 60 * 60,
            burnAddress: ethers.ZeroAddress,
            priestIsDictator: false,
            maxMembers: 5,
            homeLink: "",
        };

        const templAddress = await factory.createTemplWithConfig.staticCall(config);
        const receipt = await (await factory.createTemplWithConfig(config)).wait();
        const templ = await ethers.getContractAt("TEMPL", templAddress);

        expect(await templ.MAX_MEMBERS()).to.equal(5n);

        const templCreated = receipt.logs
            .map((log) => {
                try {
                    return factory.interface.parseLog(log);
                } catch (_) {
                    return null;
                }
            })
            .find((log) => log && log.name === "TemplCreated");

        expect(templCreated).to.not.equal(undefined);
        expect(templCreated.args.maxMembers).to.equal(5n);
        expect(templCreated.args.homeLink).to.equal("");
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
            burnAddress: ethers.ZeroAddress,
            priestIsDictator: false,
            maxMembers: 0,
            homeLink: ""
        })
        ).to.be.revertedWithCustomError(factory, "InvalidPercentageSplit");
    });

    it("allows explicit zero values in the fee split", async function () {
        const [, priest, protocolRecipient] = await ethers.getSigners();
        const token = await deployToken("Zero", "ZERO");
        const Factory = await ethers.getContractFactory("TemplFactory");
        const protocolPercent = 10;
        const factory = await Factory.deploy(protocolRecipient.address, protocolPercent);
        await factory.waitForDeployment();

        const config = {
            priest: priest.address,
            token: await token.getAddress(),
            entryFee: ENTRY_FEE,
            burnPercent: 0,
            treasuryPercent: 70,
            memberPoolPercent: 20,
            quorumPercent: 33,
            executionDelaySeconds: 7 * 24 * 60 * 60,
            burnAddress: ethers.ZeroAddress,
            priestIsDictator: false,
            maxMembers: 0,
            homeLink: "",
        };

        const templAddress = await factory.createTemplWithConfig.staticCall(config);
        await (await factory.createTemplWithConfig(config)).wait();

        const templ = await ethers.getContractAt("TEMPL", templAddress);

        expect(await templ.burnPercent()).to.equal(0);
        expect(await templ.treasuryPercent()).to.equal(70);
        expect(await templ.memberPoolPercent()).to.equal(20);
        expect(await templ.protocolPercent()).to.equal(protocolPercent);
    });

    it("reverts when negative percentages other than the sentinel are provided", async function () {
        const [, priest, protocolRecipient] = await ethers.getSigners();
        const token = await deployToken("Neg", "NEG");
        const Factory = await ethers.getContractFactory("TemplFactory");
        const factory = await Factory.deploy(protocolRecipient.address, 10);
        await factory.waitForDeployment();

        await expect(
            factory.createTemplWithConfig({
                priest: priest.address,
                token: await token.getAddress(),
                entryFee: ENTRY_FEE,
                burnPercent: -2,
                treasuryPercent: -1,
                memberPoolPercent: -1,
                quorumPercent: 33,
                executionDelaySeconds: 7 * 24 * 60 * 60,
                burnAddress: ethers.ZeroAddress,
                priestIsDictator: false,
                maxMembers: 0,
                homeLink: "",
            })
        ).to.be.revertedWithCustomError(factory, "InvalidPercentage");
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

    it("reverts when deployed with zero protocol recipient", async function () {
        const Factory = await ethers.getContractFactory("TemplFactory");
        await expect(Factory.deploy(ethers.ZeroAddress, 10)).to.be.revertedWithCustomError(
            Factory,
            "InvalidRecipient"
        );
    });

    it("reverts when protocol percent exceeds total", async function () {
        const [, , protocolRecipient] = await ethers.getSigners();
        const Factory = await ethers.getContractFactory("TemplFactory");
        await expect(Factory.deploy(protocolRecipient.address, 101)).to.be.revertedWithCustomError(
            Factory,
            "InvalidPercentageSplit"
        );
    });

    it("reverts when creating templ with missing token", async function () {
        const [, , protocolRecipient] = await ethers.getSigners();
        const Factory = await ethers.getContractFactory("TemplFactory");
        const factory = await Factory.deploy(protocolRecipient.address, 10);
        await factory.waitForDeployment();

        await expect(factory.createTempl(ethers.ZeroAddress, ENTRY_FEE)).to.be.revertedWithCustomError(
            factory,
            "InvalidRecipient"
        );
    });

    it("reverts when creating templ with entry fee below minimum", async function () {
        const [, , protocolRecipient] = await ethers.getSigners();
        const token = await deployToken("LowFee", "LOW");
        const Factory = await ethers.getContractFactory("TemplFactory");
        const factory = await Factory.deploy(protocolRecipient.address, 10);
        await factory.waitForDeployment();

        await expect(factory.createTempl(await token.getAddress(), 9)).to.be.revertedWithCustomError(
            factory,
            "EntryFeeTooSmall"
        );
    });

    it("reverts when creating templ with entry fee not divisible by ten", async function () {
        const [, , protocolRecipient] = await ethers.getSigners();
        const token = await deployToken("Modulo", "MOD");
        const Factory = await ethers.getContractFactory("TemplFactory");
        const factory = await Factory.deploy(protocolRecipient.address, 10);
        await factory.waitForDeployment();

        await expect(
            factory.createTempl(await token.getAddress(), ENTRY_FEE + 5n)
        ).to.be.revertedWithCustomError(factory, "InvalidEntryFee");
    });

    it("reverts when quorum percent exceeds 100", async function () {
        const [, , protocolRecipient] = await ethers.getSigners();
        const token = await deployToken("Quorum", "QRM");
        const Factory = await ethers.getContractFactory("TemplFactory");
        const factory = await Factory.deploy(protocolRecipient.address, 10);
        await factory.waitForDeployment();

        await expect(
            factory.createTemplWithConfig({
                priest: protocolRecipient.address,
                token: await token.getAddress(),
                entryFee: ENTRY_FEE,
                burnPercent: 30,
                treasuryPercent: 30,
                memberPoolPercent: 30,
                quorumPercent: 101,
                executionDelaySeconds: 7 * 24 * 60 * 60,
                burnAddress: ethers.ZeroAddress,
                priestIsDictator: false,
                maxMembers: 0,
                homeLink: ""
            })
        ).to.be.revertedWithCustomError(factory, "InvalidPercentage");
    });

    it("patches optional fields to defaults when config uses sentinel values", async function () {
        const [deployer, , protocolRecipient] = await ethers.getSigners();
        const token = await deployToken("Patched", "PTC");
        const Factory = await ethers.getContractFactory("TemplFactory");
        const factory = await Factory.deploy(protocolRecipient.address, 10);
        await factory.waitForDeployment();

        const config = {
            priest: ethers.ZeroAddress,
            token: await token.getAddress(),
            entryFee: ENTRY_FEE,
            burnPercent: -1,
            treasuryPercent: -1,
            memberPoolPercent: -1,
            quorumPercent: 0,
            executionDelaySeconds: 0,
            burnAddress: ethers.ZeroAddress,
            priestIsDictator: false,
            maxMembers: 0,
            homeLink: ""
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

    it("applies defaults for quorum, delay, and burn address when config omits them", async function () {
        const [, priest, protocolRecipient] = await ethers.getSigners();
        const token = await deployToken("Defaults2", "DEF2");
        const Factory = await ethers.getContractFactory("TemplFactory");
        const factory = await Factory.deploy(protocolRecipient.address, 11);
        await factory.waitForDeployment();

        const config = {
            priest: priest.address,
            token: await token.getAddress(),
            entryFee: ENTRY_FEE,
            burnPercent: 30,
            treasuryPercent: 30,
            memberPoolPercent: 29,
            quorumPercent: 0,
            executionDelaySeconds: 0,
            burnAddress: ethers.ZeroAddress,
            priestIsDictator: false,
            maxMembers: 0,
            homeLink: "",
        };

        const templAddress = await factory.createTemplWithConfig.staticCall(config);
        await factory.createTemplWithConfig(config);
        const templ = await ethers.getContractAt("TEMPL", templAddress);

        expect(await templ.quorumPercent()).to.equal(33n);
        expect(await templ.executionDelayAfterQuorum()).to.equal(7n * 24n * 60n * 60n);
        expect(await templ.burnAddress()).to.equal("0x000000000000000000000000000000000000dEaD");
    });

    it("reverts with DeploymentFailed when the stored init code is missing", async function () {
        const [, , protocolRecipient] = await ethers.getSigners();
        const token = await deployToken("Gas", "GAS");
        const FactoryHarness = await ethers.getContractFactory(
            "contracts/mocks/TemplFactoryHarness.sol:TemplFactoryHarness"
        );
        const factory = await FactoryHarness.deploy(protocolRecipient.address, 10);
        await factory.waitForDeployment();

        const pointer = await factory.exposeInitPointer();
        const originalCode = await ethers.provider.getCode(pointer);
        await ethers.provider.send("hardhat_setCode", [pointer, "0x"]);

        await expect(factory.createTempl(await token.getAddress(), ENTRY_FEE))
            .to.be.revertedWithCustomError(factory, "DeploymentFailed");

        await ethers.provider.send("hardhat_setCode", [pointer, originalCode]);
    });
});
