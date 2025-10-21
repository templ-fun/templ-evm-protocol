const { expect } = require("chai");
const { ethers } = require("hardhat");
const { mintToUsers, joinMembers } = require("./utils/mintAndPurchase");
const { deployTemplModules } = require("./utils/modules");
const { getTemplAt, attachTemplInterface } = require("./utils/templ");

describe("TemplFactory", function () {
    const ENTRY_FEE = ethers.parseUnits("100", 18);
    const BPS_DENOMINATOR = 10_000n;
    const pct = (value) => value * 100;
    const CURVE_STYLE = {
        Static: 0,
        Linear: 1,
        Exponential: 2,
    };

    const DEFAULT_METADATA = {
        name: "Factory Templ",
        description: "Factory metadata",
        logoLink: "https://templ.fun/factory.png"
    };

    const ALT_METADATA = {
        name: "Templ Alt",
        description: "Alternate metadata",
        logoLink: "https://templ.fun/alt.png"
    };

    const defaultCurve = () => ({
        primary: { style: CURVE_STYLE.Exponential, rateBps: 11_000, length: 0 },
        additionalSegments: []
    });

    const zeroCurve = () => ({
        primary: { style: CURVE_STYLE.Static, rateBps: 0, length: 0 },
        additionalSegments: []
    });

    async function deployToken(name = "Test", symbol = "TEST") {
        const Token = await ethers.getContractFactory("contracts/mocks/TestToken.sol:TestToken");
        const token = await Token.deploy(name, symbol, 18);
        await token.waitForDeployment();
        return token;
    }

    let modules;

    beforeEach(async function () {
        modules = await deployTemplModules();
    });

  it("reverts when protocol recipient is the zero address", async function () {
    const Factory = await ethers.getContractFactory("TemplFactory");
    await expect(
      Factory.deploy(
        ethers.ZeroAddress,
        1_000,
        modules.membershipModule,
        modules.treasuryModule,
        modules.governanceModule
      )
    ).to.be.revertedWithCustomError(
      Factory,
      "InvalidRecipient"
    );
  });

  it("deploys templ contracts with fixed protocol config", async function () {
    const [, priest, protocolRecipient, member] = await ethers.getSigners();
    const token = await deployToken();

        const Factory = await ethers.getContractFactory("TemplFactory");
        const protocolPercent = pct(12);
        const factory = await Factory.deploy(
            protocolRecipient.address,
            protocolPercent,
            modules.membershipModule,
            modules.treasuryModule,
            modules.governanceModule
        );
        await factory.waitForDeployment();

        const burnPercent = pct(28);
        const treasuryPercent = pct(40);
        const memberPoolPercent = pct(20);
        const quorumPercent = pct(40);
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
            burnAddress: customBurnAddress,
            priestIsDictator: false,
            maxMembers: 0,
            curveProvided: true,
            curve: defaultCurve(),
            name: DEFAULT_METADATA.name,
            description: DEFAULT_METADATA.description,
            logoLink: DEFAULT_METADATA.logoLink,
            proposalFeeBps: 250,
            referralShareBps: 1_000
        };

        const templAddress = await factory.createTemplWithConfig.staticCall(config);
        const tx = await factory.createTemplWithConfig(config);
        const receipt = await tx.wait();

        const templ = await getTemplAt(templAddress, ethers.provider);

        expect(await templ.priest()).to.equal(priest.address);
        expect(await templ.protocolFeeRecipient()).to.equal(protocolRecipient.address);
        expect(await templ.protocolPercent()).to.equal(BigInt(protocolPercent));
        expect(await templ.burnPercent()).to.equal(BigInt(burnPercent));
        expect(await templ.treasuryPercent()).to.equal(BigInt(treasuryPercent));
        expect(await templ.memberPoolPercent()).to.equal(BigInt(memberPoolPercent));
        expect(await templ.quorumPercent()).to.equal(BigInt(quorumPercent));
        expect(await templ.executionDelayAfterQuorum()).to.equal(executionDelaySeconds);
        expect(await templ.burnAddress()).to.equal(customBurnAddress);
        expect(await templ.MAX_MEMBERS()).to.equal(0n);
        expect(await templ.templName()).to.equal(DEFAULT_METADATA.name);
        expect(await templ.templDescription()).to.equal(DEFAULT_METADATA.description);
        expect(await templ.templLogoLink()).to.equal(DEFAULT_METADATA.logoLink);
        expect(await templ.proposalCreationFeeBps()).to.equal(250n);
        expect(await templ.referralShareBps()).to.equal(1_000n);

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
        expect(templCreated.args.name).to.equal(DEFAULT_METADATA.name);
        expect(templCreated.args.description).to.equal(DEFAULT_METADATA.description);
        expect(templCreated.args.logoLink).to.equal(DEFAULT_METADATA.logoLink);
        expect(templCreated.args.proposalFeeBps).to.equal(250n);
        expect(templCreated.args.referralShareBps).to.equal(1_000n);

        await mintToUsers(token, [member], ENTRY_FEE * 10n);

        const templContractAddress = await templ.getAddress();
        await token.connect(member).approve(templContractAddress, ENTRY_FEE);

        const burnAddress = await templ.burnAddress();
        const protocolRecipientAddress = await templ.protocolFeeRecipient();
        const burnBalanceBefore = await token.balanceOf(burnAddress);
        const protocolBalanceBefore = await token.balanceOf(protocolRecipientAddress);

        const joinTx = await templ.connect(member).join();
        const joinReceipt = await joinTx.wait();
        const memberJoined = joinReceipt.logs
            .map((log) => {
                try {
                    return templ.interface.parseLog(log);
                } catch (_) {
                    return null;
                }
            })
            .find((log) => log && log.name === "MemberJoined");

        expect(memberJoined, "MemberJoined event").to.not.equal(undefined);
        expect(memberJoined.args.payer).to.equal(member.address);
        expect(memberJoined.args.member).to.equal(member.address);

        const burnAmount = (ENTRY_FEE * BigInt(burnPercent)) / BPS_DENOMINATOR;
        const memberPoolAmount = (ENTRY_FEE * BigInt(memberPoolPercent)) / BPS_DENOMINATOR;
        const protocolAmount = (ENTRY_FEE * BigInt(protocolPercent)) / BPS_DENOMINATOR;
        const treasuryAmount = ENTRY_FEE - burnAmount - memberPoolAmount - protocolAmount;

        expect(memberJoined.args.burnedAmount).to.equal(burnAmount);
        expect(memberJoined.args.memberPoolAmount).to.equal(memberPoolAmount);
        expect(memberJoined.args.protocolAmount).to.equal(protocolAmount);
        expect(memberJoined.args.treasuryAmount).to.equal(treasuryAmount);

        expect(await templ.memberPoolBalance()).to.equal(memberPoolAmount);
        expect(await templ.treasuryBalance()).to.equal(treasuryAmount);
        expect(await token.balanceOf(burnAddress)).to.equal(burnBalanceBefore + burnAmount);
        expect(await token.balanceOf(protocolRecipientAddress)).to.equal(protocolBalanceBefore + protocolAmount);
    });

    it("enables priest dictatorship when requested in config", async function () {
        const [, priest, protocolRecipient] = await ethers.getSigners();
        const token = await deployToken("Dict", "DICT");

        const Factory = await ethers.getContractFactory("TemplFactory");
        const protocolPercent = pct(10);
        const factory = await Factory.deploy(
            protocolRecipient.address,
            protocolPercent,
            modules.membershipModule,
            modules.treasuryModule,
            modules.governanceModule
        );
        await factory.waitForDeployment();

        const config = {
            priest: priest.address,
            token: await token.getAddress(),
            entryFee: ENTRY_FEE,
            burnPercent: pct(30),
            treasuryPercent: pct(30),
            memberPoolPercent: pct(30),
            quorumPercent: pct(33),
            executionDelaySeconds: 7 * 24 * 60 * 60,
            burnAddress: ethers.ZeroAddress,
            priestIsDictator: true,
            maxMembers: 0,
            curveProvided: true,
            curve: defaultCurve(),
            name: DEFAULT_METADATA.name,
            description: DEFAULT_METADATA.description,
            logoLink: DEFAULT_METADATA.logoLink,
            proposalFeeBps: 0,
            referralShareBps: 0,
        };

        const templAddress = await factory.createTemplWithConfig.staticCall(config);
        const tx = await factory.createTemplWithConfig(config);
        const receipt = await tx.wait();

        const templ = await getTemplAt(templAddress, ethers.provider);
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
        const curveStyles = templCreated.args.curveStyles.map((value) => Number(value));
        const curveRates = templCreated.args.curveRateBps.map((value) => Number(value));
        const curveLengths = templCreated.args.curveLengths.map((value) => Number(value));
        expect(curveStyles).to.deep.equal([CURVE_STYLE.Exponential]);
        expect(curveRates).to.deep.equal([11_000]);
        expect(curveLengths).to.deep.equal([0]);
        expect(templCreated.args.name).to.equal(DEFAULT_METADATA.name);
        expect(templCreated.args.description).to.equal(DEFAULT_METADATA.description);
        expect(templCreated.args.logoLink).to.equal(DEFAULT_METADATA.logoLink);
        expect(templCreated.args.proposalFeeBps).to.equal(0n);
        expect(templCreated.args.referralShareBps).to.equal(0n);
    });

  it("sets and emits the member limit when provided", async function () {
    const [, priest, protocolRecipient] = await ethers.getSigners();
    const token = await deployToken("Limit", "LIM");

        const Factory = await ethers.getContractFactory("TemplFactory");
        const factory = await Factory.deploy(protocolRecipient.address, pct(12), modules.membershipModule, modules.treasuryModule, modules.governanceModule);
        await factory.waitForDeployment();

        const config = {
            priest: priest.address,
            token: await token.getAddress(),
            entryFee: ENTRY_FEE,
            burnPercent: pct(30),
            treasuryPercent: pct(30),
            memberPoolPercent: pct(28),
            quorumPercent: pct(33),
            executionDelaySeconds: 7 * 24 * 60 * 60,
            burnAddress: ethers.ZeroAddress,
            priestIsDictator: false,
            maxMembers: 5,
            curveProvided: true,
            curve: defaultCurve(),
            name: DEFAULT_METADATA.name,
            description: DEFAULT_METADATA.description,
            logoLink: DEFAULT_METADATA.logoLink,
            proposalFeeBps: 0,
            referralShareBps: 0,
        };

        const templAddress = await factory.createTemplWithConfig.staticCall(config);
        const receipt = await (await factory.createTemplWithConfig(config)).wait();
        const templ = await getTemplAt(templAddress, ethers.provider);

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
        const styles = templCreated.args.curveStyles.map((value) => Number(value));
        const rates = templCreated.args.curveRateBps.map((value) => Number(value));
        const lengths = templCreated.args.curveLengths.map((value) => Number(value));
        expect(styles).to.deep.equal([CURVE_STYLE.Exponential]);
        expect(rates).to.deep.equal([11_000]);
        expect(lengths).to.deep.equal([0]);
        expect(templCreated.args.maxMembers).to.equal(5n);
        expect(templCreated.args.name).to.equal(DEFAULT_METADATA.name);
  });

  it("applies factory defaults when optional fields are omitted", async function () {
    const [deployer, protocolRecipient] = await ethers.getSigners();
    const token = await deployToken("Minimal", "MIN");

    const Factory = await ethers.getContractFactory("TemplFactory");
    const protocolPercent = pct(15);
    const factory = await Factory.deploy(protocolRecipient.address, protocolPercent, modules.membershipModule, modules.treasuryModule, modules.governanceModule);
    await factory.waitForDeployment();

    const config = {
      priest: ethers.ZeroAddress,
      token: await token.getAddress(),
      entryFee: ENTRY_FEE,
      burnPercent: pct(35),
      treasuryPercent: pct(35),
      memberPoolPercent: pct(15),
      quorumPercent: 0,
      executionDelaySeconds: 0,
      burnAddress: ethers.ZeroAddress,
      priestIsDictator: false,
      maxMembers: 0,
      curveProvided: false,
      curve: zeroCurve(),
      name: "",
      description: "",
      logoLink: "",
      proposalFeeBps: 0,
      referralShareBps: 0
    };

    const templAddress = await factory.createTemplWithConfig.staticCall(config);
    await (await factory.createTemplWithConfig(config)).wait();

    const templ = await getTemplAt(templAddress, ethers.provider);

    expect(await templ.priest()).to.equal(deployer.address);
    expect(await templ.burnPercent()).to.equal(3_500n);
    expect(await templ.treasuryPercent()).to.equal(3_500n);
    expect(await templ.memberPoolPercent()).to.equal(1_500n);
    expect(await templ.protocolPercent()).to.equal(BigInt(protocolPercent));
    expect(await templ.quorumPercent()).to.equal(3_300n);
    expect(await templ.executionDelayAfterQuorum()).to.equal(7n * 24n * 60n * 60n);
    expect(await templ.burnAddress()).to.equal("0x000000000000000000000000000000000000dEaD");
  });

    it("reverts when fee split does not sum to 100", async function () {
        const [deployer, , protocolRecipient] = await ethers.getSigners();
        const token = await deployToken("Bad", "BAD");
        const Factory = await ethers.getContractFactory("TemplFactory");
        const factory = await Factory.deploy(protocolRecipient.address, pct(15), modules.membershipModule, modules.treasuryModule, modules.governanceModule);
        await factory.waitForDeployment();

        await expect(
            factory.createTemplWithConfig({
                priest: protocolRecipient.address,
                token: await token.getAddress(),
                entryFee: ENTRY_FEE,
                burnPercent: pct(40),
                treasuryPercent: pct(40),
                memberPoolPercent: pct(10),
                quorumPercent: pct(33),
                executionDelaySeconds: 7 * 24 * 60 * 60,
                burnAddress: ethers.ZeroAddress,
                priestIsDictator: false,
                maxMembers: 0,
                curveProvided: true,
                curve: defaultCurve(),
                name: DEFAULT_METADATA.name,
                description: DEFAULT_METADATA.description,
                logoLink: DEFAULT_METADATA.logoLink,
                proposalFeeBps: 0,
                referralShareBps: 0
        })
        ).to.be.revertedWithCustomError(factory, "InvalidPercentageSplit");
    });

    it("allows explicit zero values in the fee split", async function () {
        const [, priest, protocolRecipient] = await ethers.getSigners();
        const token = await deployToken("Zero", "ZERO");
        const Factory = await ethers.getContractFactory("TemplFactory");
        const protocolPercent = pct(10);
        const factory = await Factory.deploy(protocolRecipient.address, protocolPercent, modules.membershipModule, modules.treasuryModule, modules.governanceModule);
        await factory.waitForDeployment();

        const config = {
            priest: priest.address,
            token: await token.getAddress(),
            entryFee: ENTRY_FEE,
            burnPercent: 0,
            treasuryPercent: pct(70),
            memberPoolPercent: pct(20),
            quorumPercent: pct(33),
            executionDelaySeconds: 7 * 24 * 60 * 60,
            burnAddress: ethers.ZeroAddress,
            priestIsDictator: false,
            maxMembers: 0,
            curveProvided: true,
            curve: defaultCurve(),
            name: DEFAULT_METADATA.name,
            description: DEFAULT_METADATA.description,
            logoLink: DEFAULT_METADATA.logoLink,
            proposalFeeBps: 0,
            referralShareBps: 0,
        };

        const templAddress = await factory.createTemplWithConfig.staticCall(config);
        await (await factory.createTemplWithConfig(config)).wait();

        const templ = await getTemplAt(templAddress, ethers.provider);

        expect(await templ.burnPercent()).to.equal(0);
        expect(await templ.treasuryPercent()).to.equal(BigInt(pct(70)));
        expect(await templ.memberPoolPercent()).to.equal(BigInt(pct(20)));
        expect(await templ.protocolPercent()).to.equal(BigInt(protocolPercent));
    });

    it("reverts when negative percentages other than the sentinel are provided", async function () {
        const [, priest, protocolRecipient] = await ethers.getSigners();
        const token = await deployToken("Neg", "NEG");
        const Factory = await ethers.getContractFactory("TemplFactory");
        const factory = await Factory.deploy(protocolRecipient.address, pct(10), modules.membershipModule, modules.treasuryModule, modules.governanceModule);
        await factory.waitForDeployment();

        await expect(
            factory.createTemplWithConfig({
                priest: priest.address,
                token: await token.getAddress(),
                entryFee: ENTRY_FEE,
                burnPercent: -2,
                treasuryPercent: -1,
                memberPoolPercent: -1,
                quorumPercent: pct(33),
                executionDelaySeconds: 7 * 24 * 60 * 60,
                burnAddress: ethers.ZeroAddress,
                priestIsDictator: false,
                maxMembers: 0,
                curveProvided: true,
                curve: defaultCurve(),
                name: DEFAULT_METADATA.name,
                description: DEFAULT_METADATA.description,
                logoLink: DEFAULT_METADATA.logoLink,
                proposalFeeBps: 0,
                referralShareBps: 0,
            })
        ).to.be.revertedWithCustomError(factory, "InvalidPercentage");
    });

    it("defaults splits, priest, quorum, delay, max members, and curve when using simple create", async function () {
        const [deployer, joiner, protocolRecipient] = await ethers.getSigners();
        const token = await deployToken("Defaults", "DEF");
        const Factory = await ethers.getContractFactory("TemplFactory");
        const factory = await Factory.deploy(protocolRecipient.address, pct(10), modules.membershipModule, modules.treasuryModule, modules.governanceModule);
        await factory.waitForDeployment();

        const templAddress = await factory.createTempl.staticCall(
            await token.getAddress(),
            ENTRY_FEE,
            DEFAULT_METADATA.name,
            DEFAULT_METADATA.description,
            DEFAULT_METADATA.logoLink
        );
        const tx = await factory.createTempl(
            await token.getAddress(),
            ENTRY_FEE,
            DEFAULT_METADATA.name,
            DEFAULT_METADATA.description,
            DEFAULT_METADATA.logoLink
        );
        const receipt = await tx.wait();

        const templ = await getTemplAt(templAddress, ethers.provider);

        expect(await templ.priest()).to.equal(deployer.address);
        expect(await templ.burnPercent()).to.equal(BigInt(pct(30)));
        expect(await templ.treasuryPercent()).to.equal(BigInt(pct(30)));
        expect(await templ.memberPoolPercent()).to.equal(BigInt(pct(30)));
        expect(await templ.protocolFeeRecipient()).to.equal(protocolRecipient.address);
        expect(await templ.protocolPercent()).to.equal(BigInt(pct(10)));
        expect(await templ.quorumPercent()).to.equal(BigInt(pct(33)));
        expect(await templ.executionDelayAfterQuorum()).to.equal(7 * 24 * 60 * 60);
        expect(await templ.burnAddress()).to.equal("0x000000000000000000000000000000000000dEaD");
        expect(await templ.MAX_MEMBERS()).to.equal(249n);

        const templCreated = receipt.logs
            .map((log) => {
                try {
                    return factory.interface.parseLog(log);
                } catch (_) {
                    return null;
                }
            })
            .find((log) => log && log.name === "TemplCreated");

        const curveStyles = templCreated.args.curveStyles.map((value) => Number(value));
        const curveRates = templCreated.args.curveRateBps.map((value) => Number(value));
        const curveLengths = templCreated.args.curveLengths.map((value) => Number(value));
        expect(curveStyles).to.deep.equal([CURVE_STYLE.Exponential]);
        expect(curveRates).to.deep.equal([11_000]);
        expect(curveLengths).to.deep.equal([0]);

        await mintToUsers(token, [joiner], ENTRY_FEE * 5n);
        await token.connect(joiner).approve(templAddress, ENTRY_FEE);
        await templ.connect(joiner).join();

        const expectedNextFee = (ENTRY_FEE * 11_000n) / 10_000n;
        expect(await templ.entryFee()).to.equal(expectedNextFee);
    });

    it("allows templ creation for a delegated priest", async function () {
        const [deployer, delegatedPriest, protocolRecipient] = await ethers.getSigners();
        const token = await deployToken("Delegated", "DLG");

        const Factory = await ethers.getContractFactory("TemplFactory");
        const factory = await Factory.deploy(protocolRecipient.address, pct(10), modules.membershipModule, modules.treasuryModule, modules.governanceModule);
        await factory.waitForDeployment();

        const templAddress = await factory.createTemplFor.staticCall(
            delegatedPriest.address,
            await token.getAddress(),
            ENTRY_FEE,
            DEFAULT_METADATA.name,
            DEFAULT_METADATA.description,
            DEFAULT_METADATA.logoLink,
            0,
            0
        );
        const tx = await factory.createTemplFor(
            delegatedPriest.address,
            await token.getAddress(),
            ENTRY_FEE,
            DEFAULT_METADATA.name,
            DEFAULT_METADATA.description,
            DEFAULT_METADATA.logoLink,
            0,
            0
        );
        const receipt = await tx.wait();

        const templ = await getTemplAt(templAddress, ethers.provider);
        expect(await templ.priest()).to.equal(delegatedPriest.address);

        const templCreated = receipt.logs
            .map((log) => {
                try {
                    return factory.interface.parseLog(log);
                } catch (_) {
                    return null;
                }
            })
            .find((log) => log && log.name === "TemplCreated");

        expect(templCreated.args.creator).to.equal(deployer.address);
        expect(templCreated.args.priest).to.equal(delegatedPriest.address);
        const styles = templCreated.args.curveStyles.map((value) => Number(value));
        const rates = templCreated.args.curveRateBps.map((value) => Number(value));
        const lengths = templCreated.args.curveLengths.map((value) => Number(value));
        expect(styles).to.deep.equal([CURVE_STYLE.Exponential]);
        expect(rates).to.deep.equal([11_000]);
        expect(lengths).to.deep.equal([0]);
    });

  it("reuses the immutable protocol configuration for every templ", async function () {
    const [, priest, protocolRecipient] = await ethers.getSigners();
    const tokenA = await deployToken("Immutable", "IMM");
    const tokenB = await deployToken("ImmutableTwo", "IM2");

    const Factory = await ethers.getContractFactory("TemplFactory");
    const protocolPercent = pct(12);
    const factory = await Factory.deploy(protocolRecipient.address, protocolPercent, modules.membershipModule, modules.treasuryModule, modules.governanceModule);
    await factory.waitForDeployment();

    const firstConfig = {
      priest: priest.address,
      token: await tokenA.getAddress(),
      entryFee: ENTRY_FEE,
      burnPercent: pct(24),
      treasuryPercent: pct(36),
      memberPoolPercent: pct(28),
      quorumPercent: pct(40),
      executionDelaySeconds: 5 * 24 * 60 * 60,
      burnAddress: ethers.ZeroAddress,
      priestIsDictator: false,
      maxMembers: 0,
      curveProvided: true,
      curve: defaultCurve(),
      name: DEFAULT_METADATA.name,
      description: DEFAULT_METADATA.description,
      logoLink: DEFAULT_METADATA.logoLink,
      proposalFeeBps: 0,
      referralShareBps: 0,
    };

    const secondConfig = {
      priest: priest.address,
      token: await tokenB.getAddress(),
      entryFee: ENTRY_FEE * 2n,
      burnPercent: pct(26),
      treasuryPercent: pct(34),
      memberPoolPercent: pct(28),
      quorumPercent: pct(35),
      executionDelaySeconds: 9 * 24 * 60 * 60,
      burnAddress: ethers.ZeroAddress,
      priestIsDictator: true,
      maxMembers: 50,
      curveProvided: true,
      curve: defaultCurve(),
      name: ALT_METADATA.name,
      description: ALT_METADATA.description,
      logoLink: "https://templ.fun/immutability",
      proposalFeeBps: 0,
      referralShareBps: 0,
    };

    const firstTemplAddress = await factory.createTemplWithConfig.staticCall(firstConfig);
    await (await factory.createTemplWithConfig(firstConfig)).wait();

    const secondTemplAddress = await factory.createTemplWithConfig.staticCall(secondConfig);
    await (await factory.createTemplWithConfig(secondConfig)).wait();

    const firstTempl = await getTemplAt(firstTemplAddress, ethers.provider);
    const secondTempl = await getTemplAt(secondTemplAddress, ethers.provider);

    expect(await firstTempl.protocolFeeRecipient()).to.equal(protocolRecipient.address);
    expect(await secondTempl.protocolFeeRecipient()).to.equal(protocolRecipient.address);
    expect(await firstTempl.protocolPercent()).to.equal(BigInt(protocolPercent));
    expect(await secondTempl.protocolPercent()).to.equal(BigInt(protocolPercent));
  });

    it("reverts when deployed with zero protocol recipient", async function () {
        const Factory = await ethers.getContractFactory("TemplFactory");
    await expect(Factory.deploy(ethers.ZeroAddress, pct(10), modules.membershipModule, modules.treasuryModule, modules.governanceModule)).to.be.revertedWithCustomError(
        Factory,
        "InvalidRecipient"
    );
    });

    it("reverts when protocol percent exceeds total", async function () {
        const [, , protocolRecipient] = await ethers.getSigners();
        const Factory = await ethers.getContractFactory("TemplFactory");
        await expect(Factory.deploy(protocolRecipient.address, 10_001, modules.membershipModule, modules.treasuryModule, modules.governanceModule)).to.be.revertedWithCustomError(
            Factory,
            "InvalidPercentageSplit"
        );
    });

    it("reverts when creating templ with missing token", async function () {
        const [, , protocolRecipient] = await ethers.getSigners();
        const Factory = await ethers.getContractFactory("TemplFactory");
        const factory = await Factory.deploy(protocolRecipient.address, pct(10), modules.membershipModule, modules.treasuryModule, modules.governanceModule);
        await factory.waitForDeployment();

        await expect(
            factory.createTempl(
                ethers.ZeroAddress,
                ENTRY_FEE,
                DEFAULT_METADATA.name,
                DEFAULT_METADATA.description,
                DEFAULT_METADATA.logoLink
            )
        ).to.be.revertedWithCustomError(factory, "InvalidRecipient");
    });

    it("reverts when delegated priest address is zero", async function () {
        const [, , protocolRecipient] = await ethers.getSigners();
        const token = await deployToken("ZeroPriest", "ZP");

        const Factory = await ethers.getContractFactory("TemplFactory");
        const factory = await Factory.deploy(protocolRecipient.address, pct(10), modules.membershipModule, modules.treasuryModule, modules.governanceModule);
        await factory.waitForDeployment();

        await expect(
            factory.createTemplFor(
                ethers.ZeroAddress,
                await token.getAddress(),
                ENTRY_FEE,
                DEFAULT_METADATA.name,
                DEFAULT_METADATA.description,
                DEFAULT_METADATA.logoLink,
                0,
                0
            )
        ).to.be.revertedWithCustomError(factory, "InvalidRecipient");
    });

    it("reverts when creating templ with entry fee below minimum", async function () {
        const [, , protocolRecipient] = await ethers.getSigners();
        const token = await deployToken("LowFee", "LOW");
        const Factory = await ethers.getContractFactory("TemplFactory");
        const factory = await Factory.deploy(protocolRecipient.address, pct(10), modules.membershipModule, modules.treasuryModule, modules.governanceModule);
        await factory.waitForDeployment();

        await expect(
            factory.createTempl(
                await token.getAddress(),
                9,
                DEFAULT_METADATA.name,
                DEFAULT_METADATA.description,
                DEFAULT_METADATA.logoLink
            )
        ).to.be.revertedWithCustomError(factory, "EntryFeeTooSmall");
    });

    it("reverts when creating templ with entry fee not divisible by ten", async function () {
        const [, , protocolRecipient] = await ethers.getSigners();
        const token = await deployToken("Modulo", "MOD");
        const Factory = await ethers.getContractFactory("TemplFactory");
        const factory = await Factory.deploy(protocolRecipient.address, pct(10), modules.membershipModule, modules.treasuryModule, modules.governanceModule);
        await factory.waitForDeployment();

        await expect(
            factory.createTempl(
                await token.getAddress(),
                ENTRY_FEE + 5n,
                DEFAULT_METADATA.name,
                DEFAULT_METADATA.description,
                DEFAULT_METADATA.logoLink
            )
        ).to.be.revertedWithCustomError(factory, "InvalidEntryFee");
    });

    it("reverts when quorum percent exceeds 100", async function () {
        const [, , protocolRecipient] = await ethers.getSigners();
        const token = await deployToken("Quorum", "QRM");
        const Factory = await ethers.getContractFactory("TemplFactory");
        const factory = await Factory.deploy(protocolRecipient.address, pct(10), modules.membershipModule, modules.treasuryModule, modules.governanceModule);
        await factory.waitForDeployment();

        await expect(
            factory.createTemplWithConfig({
                priest: protocolRecipient.address,
                token: await token.getAddress(),
                entryFee: ENTRY_FEE,
                burnPercent: pct(30),
                treasuryPercent: pct(30),
                memberPoolPercent: pct(30),
                quorumPercent: pct(101),
                executionDelaySeconds: 7 * 24 * 60 * 60,
                burnAddress: ethers.ZeroAddress,
                priestIsDictator: false,
                maxMembers: 0,
                curveProvided: true,
                curve: defaultCurve(),
                name: DEFAULT_METADATA.name,
                description: DEFAULT_METADATA.description,
                logoLink: DEFAULT_METADATA.logoLink,
                proposalFeeBps: 0,
                referralShareBps: 0
            })
        ).to.be.revertedWithCustomError(factory, "InvalidPercentage");
    });

    it("patches optional fields to defaults when config uses sentinel values", async function () {
        const [deployer, , protocolRecipient] = await ethers.getSigners();
        const token = await deployToken("Patched", "PTC");
        const Factory = await ethers.getContractFactory("TemplFactory");
        const factory = await Factory.deploy(protocolRecipient.address, pct(10), modules.membershipModule, modules.treasuryModule, modules.governanceModule);
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
            curveProvided: false,
            curve: zeroCurve(),
            name: DEFAULT_METADATA.name,
            description: DEFAULT_METADATA.description,
            logoLink: DEFAULT_METADATA.logoLink,
            proposalFeeBps: 0,
            referralShareBps: 0
        };

        const templAddress = await factory.createTemplWithConfig.staticCall(config);
        await (await factory.createTemplWithConfig(config)).wait();

        const templ = await getTemplAt(templAddress, ethers.provider);

        expect(await templ.priest()).to.equal(deployer.address);
        expect(await templ.quorumPercent()).to.equal(BigInt(pct(33)));
        expect(await templ.executionDelayAfterQuorum()).to.equal(7 * 24 * 60 * 60);
        expect(await templ.burnAddress()).to.equal("0x000000000000000000000000000000000000dEaD");
        expect(await templ.burnPercent()).to.equal(BigInt(pct(30)));
        expect(await templ.treasuryPercent()).to.equal(BigInt(pct(30)));
        expect(await templ.memberPoolPercent()).to.equal(BigInt(pct(30)));
    });

    it("applies defaults for quorum, delay, and burn address when config omits them", async function () {
        const [, priest, protocolRecipient] = await ethers.getSigners();
        const token = await deployToken("Defaults2", "DEF2");
        const Factory = await ethers.getContractFactory("TemplFactory");
        const factory = await Factory.deploy(protocolRecipient.address, pct(11), modules.membershipModule, modules.treasuryModule, modules.governanceModule);
        await factory.waitForDeployment();

        const config = {
            priest: priest.address,
            token: await token.getAddress(),
            entryFee: ENTRY_FEE,
            burnPercent: pct(30),
            treasuryPercent: pct(30),
            memberPoolPercent: pct(29),
            quorumPercent: 0,
            executionDelaySeconds: 0,
            burnAddress: ethers.ZeroAddress,
            priestIsDictator: false,
            maxMembers: 0,
            curveProvided: false,
            curve: zeroCurve(),
            name: DEFAULT_METADATA.name,
            description: DEFAULT_METADATA.description,
            logoLink: DEFAULT_METADATA.logoLink,
            proposalFeeBps: 0,
            referralShareBps: 0,
        };

        const templAddress = await factory.createTemplWithConfig.staticCall(config);
        await factory.createTemplWithConfig(config);
        const templ = await getTemplAt(templAddress, ethers.provider);

        expect(await templ.quorumPercent()).to.equal(BigInt(pct(33)));
        expect(await templ.executionDelayAfterQuorum()).to.equal(7n * 24n * 60n * 60n);
        expect(await templ.burnAddress()).to.equal("0x000000000000000000000000000000000000dEaD");
    });

    it("reverts with DeploymentFailed when the stored init code is missing", async function () {
        const [, , protocolRecipient] = await ethers.getSigners();
        const token = await deployToken("Gas", "GAS");
        const FactoryHarness = await ethers.getContractFactory(
            "contracts/mocks/TemplFactoryHarness.sol:TemplFactoryHarness"
        );
        const modules = await deployTemplModules();
        const factory = await FactoryHarness.deploy(
            protocolRecipient.address,
            pct(10),
            modules.membershipModule,
            modules.treasuryModule,
            modules.governanceModule
        );
        await factory.waitForDeployment();

        const pointers = await factory.exposeInitPointers();
        expect(pointers.length).to.be.greaterThan(0);
        const pointer = pointers[0];
        const originalCode = await ethers.provider.getCode(pointer);
        await ethers.provider.send("hardhat_setCode", [pointer, "0x"]);

        await expect(
            factory.createTempl(
                await token.getAddress(),
                ENTRY_FEE,
                DEFAULT_METADATA.name,
                DEFAULT_METADATA.description,
                DEFAULT_METADATA.logoLink
            )
        )
            .to.be.revertedWithCustomError(factory, "DeploymentFailed");

        // Restore pointer with creation code that immediately reverts to hit the post-create check
        const revertInit = "0xfe";
        await ethers.provider.send("hardhat_setCode", [pointer, revertInit]);
        await expect(
            factory.createTempl(
                await token.getAddress(),
                ENTRY_FEE,
                DEFAULT_METADATA.name,
                DEFAULT_METADATA.description,
                DEFAULT_METADATA.logoLink
            )
        )
            .to.be.revertedWithCustomError(factory, "DeploymentFailed");

        await ethers.provider.send("hardhat_setCode", [pointer, originalCode]);
    });

    it("restricts templ creation to the deployer until permissionless mode is enabled", async function () {
        const [deployer, outsider, protocolRecipient] = await ethers.getSigners();
        const token = await deployToken("Access", "ACC");
        const Factory = await ethers.getContractFactory("TemplFactory");
        const factory = await Factory.deploy(protocolRecipient.address, pct(10), modules.membershipModule, modules.treasuryModule, modules.governanceModule);
        await factory.waitForDeployment();

        const tokenAddress = await token.getAddress();
        await expect(
            factory.connect(outsider).createTempl(
                tokenAddress,
                ENTRY_FEE,
                DEFAULT_METADATA.name,
                DEFAULT_METADATA.description,
                DEFAULT_METADATA.logoLink
            )
        ).to.be.revertedWithCustomError(factory, "FactoryAccessRestricted");

        const config = {
            priest: deployer.address,
            token: tokenAddress,
            entryFee: ENTRY_FEE,
            burnPercent: pct(30),
            treasuryPercent: pct(30),
            memberPoolPercent: pct(30),
            quorumPercent: pct(33),
            executionDelaySeconds: 7 * 24 * 60 * 60,
            burnAddress: ethers.ZeroAddress,
            priestIsDictator: false,
            maxMembers: 0,
            curveProvided: true,
            curve: defaultCurve(),
            name: DEFAULT_METADATA.name,
            description: DEFAULT_METADATA.description,
            logoLink: DEFAULT_METADATA.logoLink,
            proposalFeeBps: 0,
            referralShareBps: 0,
        };

        await expect(
            factory.connect(outsider).createTemplWithConfig(config)
        ).to.be.revertedWithCustomError(factory, "FactoryAccessRestricted");

        await expect(factory.connect(outsider).setPermissionless(true)).to.be.revertedWithCustomError(
            factory,
            "NotFactoryDeployer"
        );

        await expect(factory.setPermissionless(true))
            .to.emit(factory, "PermissionlessModeUpdated")
            .withArgs(true);

        expect(await factory.permissionless()).to.equal(true);

        const templAddress = await factory
            .connect(outsider)
            .createTemplWithConfig.staticCall(config);
        await factory.connect(outsider).createTemplWithConfig(config);

        const templ = await getTemplAt(templAddress, ethers.provider);
        expect(await templ.priest()).to.equal(deployer.address);

        await expect(factory.setPermissionless(true)).to.be.revertedWithCustomError(
            factory,
            "PermissionlessUnchanged"
        );

        await expect(factory.setPermissionless(false))
            .to.emit(factory, "PermissionlessModeUpdated")
            .withArgs(false);
    });
});
