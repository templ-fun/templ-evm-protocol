const { expect } = require("chai");
const { ethers } = require("hardhat");
const { mintToUsers, joinMembers } = require("./utils/mintAndPurchase");
const { deployTemplModules, deployTemplDeployer } = require("./utils/modules");
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

    const withCouncilDefaults = (config) => ({
        yesVoteThresholdBps: 5_000,
        councilMode: false,
        instantQuorumBps: 10_000,
        ...config,
    });

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
    let templDeployer;

    beforeEach(async function () {
        modules = await deployTemplModules();
        templDeployer = await deployTemplDeployer();
    });

  it("reverts when protocol recipient is the zero address", async function () {
    const Factory = await ethers.getContractFactory("TemplFactory");
    await expect(
      Factory.deploy(
        (await ethers.getSigners())[0].address,
        ethers.ZeroAddress,
        1_000,
        modules.membershipModule,
        modules.treasuryModule,
        modules.governanceModule,
        modules.councilModule,
        templDeployer
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
        const protocolBps = pct(12);
        const factory = await Factory.deploy(
            (await ethers.getSigners())[0].address,
            protocolRecipient.address,
            protocolBps,
            modules.membershipModule,
            modules.treasuryModule,
            modules.governanceModule,
            modules.councilModule,
            templDeployer
        );
        await factory.waitForDeployment();

        const burnBps = pct(28);
        const treasuryBps = pct(40);
        const memberPoolBps = pct(20);
        const quorumBps = pct(40);
        const executionDelaySeconds = 5 * 24 * 60 * 60;
        const customBurnAddress = "0x00000000000000000000000000000000000000AA";

        const config = withCouncilDefaults({
            priest: priest.address,
            token: await token.getAddress(),
            entryFee: ENTRY_FEE,
            burnBps,
            treasuryBps,
            memberPoolBps,
            quorumBps,
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
        });

        const templAddress = await factory.createTemplWithConfig.staticCall(config);
        const tx = await factory.createTemplWithConfig(config);
        const receipt = await tx.wait();

        const templ = await getTemplAt(templAddress, ethers.provider);

        expect(await templ.priest()).to.equal(priest.address);
        expect(await templ.protocolFeeRecipient()).to.equal(protocolRecipient.address);
        expect(await templ.protocolBps()).to.equal(BigInt(protocolBps));
        expect(await templ.burnBps()).to.equal(BigInt(burnBps));
        expect(await templ.treasuryBps()).to.equal(BigInt(treasuryBps));
        expect(await templ.memberPoolBps()).to.equal(BigInt(memberPoolBps));
        expect(await templ.quorumBps()).to.equal(BigInt(quorumBps));
        expect(await templ.postQuorumVotingPeriod()).to.equal(executionDelaySeconds);
        expect(await templ.burnAddress()).to.equal(customBurnAddress);
        expect(await templ.maxMembers()).to.equal(0n);
        expect(await templ.templName()).to.equal(DEFAULT_METADATA.name);
        expect(await templ.templDescription()).to.equal(DEFAULT_METADATA.description);
        expect(await templ.templLogoLink()).to.equal(DEFAULT_METADATA.logoLink);
        expect(await templ.proposalCreationFeeBps()).to.equal(250n);
        expect(await templ.referralShareBps()).to.equal(1_000n);
        expect(await templ.yesVoteThresholdBps()).to.equal(5_000n);
        expect(await templ.instantQuorumBps()).to.equal(10_000n);

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
        expect(templCreated.args.yesVoteThresholdBps).to.equal(5_000n);
        expect(templCreated.args.instantQuorumBps).to.equal(10_000n);
        expect(templCreated.args.councilMode).to.equal(false);

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

        const burnAmount = (ENTRY_FEE * BigInt(burnBps)) / BPS_DENOMINATOR;
        const memberPoolAmount = (ENTRY_FEE * BigInt(memberPoolBps)) / BPS_DENOMINATOR;
        const protocolAmount = (ENTRY_FEE * BigInt(protocolBps)) / BPS_DENOMINATOR;
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

    it("configures council mode and YES threshold via factory config", async function () {
        const [, priest, protocolRecipient] = await ethers.getSigners();
        const token = await deployToken("Council", "CNCL");

        const Factory = await ethers.getContractFactory("TemplFactory");
        const factory = await Factory.deploy(
            (await ethers.getSigners())[0].address,
            protocolRecipient.address,
            pct(10),
            modules.membershipModule,
            modules.treasuryModule,
            modules.governanceModule,
            modules.councilModule,
            templDeployer
        );
        await factory.waitForDeployment();

        const config = withCouncilDefaults({
            priest: priest.address,
            token: await token.getAddress(),
            entryFee: ENTRY_FEE,
            burnBps: pct(30),
            treasuryBps: pct(30),
            memberPoolBps: pct(30),
            quorumBps: pct(35),
            executionDelaySeconds: 2 * 24 * 60 * 60,
            burnAddress: "0x00000000000000000000000000000000000000BB",
            priestIsDictator: false,
            maxMembers: 0,
            curveProvided: true,
            curve: zeroCurve(),
            name: ALT_METADATA.name,
            description: ALT_METADATA.description,
            logoLink: ALT_METADATA.logoLink,
            proposalFeeBps: 0,
            referralShareBps: 500,
            yesVoteThresholdBps: 6_000,
            councilMode: true,
            instantQuorumBps: 7_500
        });

        const templAddress = await factory.createTemplWithConfig.staticCall(config);
        const receipt = await (await factory.createTemplWithConfig(config)).wait();

        const templ = await getTemplAt(templAddress, ethers.provider);
        expect(await templ.yesVoteThresholdBps()).to.equal(6_000n);
        expect(await templ.instantQuorumBps()).to.equal(7_500n);
        expect(await templ.councilModeEnabled()).to.equal(true);
        expect(await templ.councilMemberCount()).to.equal(1n);

        const templCreated = receipt.logs
            .map((log) => {
                try {
                    return factory.interface.parseLog(log);
                } catch (_) {
                    return null;
                }
            })
            .find((log) => log && log.name === "TemplCreated");

        expect(templCreated.args.yesVoteThresholdBps).to.equal(6_000n);
        expect(templCreated.args.instantQuorumBps).to.equal(7_500n);
        expect(templCreated.args.councilMode).to.equal(true);
    });

    it("enables priest dictatorship when requested in config", async function () {
        const [, priest, protocolRecipient] = await ethers.getSigners();
        const token = await deployToken("Dict", "DICT");

        const Factory = await ethers.getContractFactory("TemplFactory");
        const protocolBps = pct(10);
        const factory = await Factory.deploy(
            (await ethers.getSigners())[0].address,
            protocolRecipient.address,
            protocolBps,
            modules.membershipModule,
            modules.treasuryModule,
            modules.governanceModule,
            modules.councilModule,
            templDeployer
        );
        await factory.waitForDeployment();

        const config = withCouncilDefaults({
            priest: priest.address,
            token: await token.getAddress(),
            entryFee: ENTRY_FEE,
            burnBps: pct(30),
            treasuryBps: pct(30),
            memberPoolBps: pct(30),
            quorumBps: pct(33),
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
        });

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
        const factory = await Factory.deploy((await ethers.getSigners())[0].address, protocolRecipient.address, pct(12), modules.membershipModule, modules.treasuryModule, modules.governanceModule, modules.councilModule, templDeployer);
        await factory.waitForDeployment();

        const config = withCouncilDefaults({
            priest: priest.address,
            token: await token.getAddress(),
            entryFee: ENTRY_FEE,
            burnBps: pct(30),
            treasuryBps: pct(30),
            memberPoolBps: pct(28),
            quorumBps: pct(33),
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
        });

        const templAddress = await factory.createTemplWithConfig.staticCall(config);
        const receipt = await (await factory.createTemplWithConfig(config)).wait();
        const templ = await getTemplAt(templAddress, ethers.provider);

        expect(await templ.maxMembers()).to.equal(5n);

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
    const protocolBps = pct(15);
    const factory = await Factory.deploy((await ethers.getSigners())[0].address, protocolRecipient.address, protocolBps, modules.membershipModule, modules.treasuryModule, modules.governanceModule, modules.councilModule, templDeployer);
    await factory.waitForDeployment();

    const config = withCouncilDefaults({
      priest: ethers.ZeroAddress,
      token: await token.getAddress(),
      entryFee: ENTRY_FEE,
      burnBps: pct(35),
      treasuryBps: pct(35),
      memberPoolBps: pct(15),
      quorumBps: 0,
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
    });

    const templAddress = await factory.createTemplWithConfig.staticCall(config);
    await (await factory.createTemplWithConfig(config)).wait();

    const templ = await getTemplAt(templAddress, ethers.provider);

    expect(await templ.priest()).to.equal(deployer.address);
    expect(await templ.burnBps()).to.equal(3_500n);
    expect(await templ.treasuryBps()).to.equal(3_500n);
    expect(await templ.memberPoolBps()).to.equal(1_500n);
    expect(await templ.protocolBps()).to.equal(BigInt(protocolBps));
    expect(await templ.quorumBps()).to.equal(3_300n);
    expect(await templ.postQuorumVotingPeriod()).to.equal(36n * 60n * 60n);
    expect(await templ.burnAddress()).to.equal("0x000000000000000000000000000000000000dEaD");
  });

    it("reverts when fee split does not sum to 100", async function () {
        const [deployer, , protocolRecipient] = await ethers.getSigners();
        const token = await deployToken("Bad", "BAD");
        const Factory = await ethers.getContractFactory("TemplFactory");
        const factory = await Factory.deploy((await ethers.getSigners())[0].address, protocolRecipient.address, pct(15), modules.membershipModule, modules.treasuryModule, modules.governanceModule, modules.councilModule, templDeployer);
        await factory.waitForDeployment();

        await expect(
            factory.createTemplWithConfig(
                withCouncilDefaults({
                    priest: protocolRecipient.address,
                    token: await token.getAddress(),
                    entryFee: ENTRY_FEE,
                    burnBps: pct(40),
                    treasuryBps: pct(40),
                    memberPoolBps: pct(10),
                    quorumBps: pct(33),
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
            )
        ).to.be.revertedWithCustomError(factory, "InvalidPercentageSplit");
    });

    it("allows explicit zero values in the fee split", async function () {
        const [, priest, protocolRecipient] = await ethers.getSigners();
        const token = await deployToken("Zero", "ZERO");
        const Factory = await ethers.getContractFactory("TemplFactory");
        const protocolBps = pct(10);
        const factory = await Factory.deploy((await ethers.getSigners())[0].address, protocolRecipient.address, protocolBps, modules.membershipModule, modules.treasuryModule, modules.governanceModule, modules.councilModule, templDeployer);
        await factory.waitForDeployment();

        const config = withCouncilDefaults({
            priest: priest.address,
            token: await token.getAddress(),
            entryFee: ENTRY_FEE,
            burnBps: 0,
            treasuryBps: pct(70),
            memberPoolBps: pct(20),
            quorumBps: pct(33),
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
        });

        const templAddress = await factory.createTemplWithConfig.staticCall(config);
        await (await factory.createTemplWithConfig(config)).wait();

        const templ = await getTemplAt(templAddress, ethers.provider);

        expect(await templ.burnBps()).to.equal(0);
        expect(await templ.treasuryBps()).to.equal(BigInt(pct(70)));
        expect(await templ.memberPoolBps()).to.equal(BigInt(pct(20)));
        expect(await templ.protocolBps()).to.equal(BigInt(protocolBps));
    });

    it("reverts when negative percentages other than the sentinel are provided", async function () {
        const [, priest, protocolRecipient] = await ethers.getSigners();
        const token = await deployToken("Neg", "NEG");
    const Factory = await ethers.getContractFactory("TemplFactory");
    const factory = await Factory.deploy((await ethers.getSigners())[0].address, protocolRecipient.address, pct(10), modules.membershipModule, modules.treasuryModule, modules.governanceModule, modules.councilModule, templDeployer);
        await factory.waitForDeployment();

        await expect(
            factory.createTemplWithConfig(withCouncilDefaults({
                priest: priest.address,
                token: await token.getAddress(),
                entryFee: ENTRY_FEE,
                burnBps: -2,
                treasuryBps: -1,
                memberPoolBps: -1,
                quorumBps: pct(33),
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
            }))
        ).to.be.revertedWithCustomError(factory, "InvalidPercentage");
    });

    it("defaults splits, priest, quorum, delay, max members, and curve when using simple create", async function () {
        const [deployer, joiner, protocolRecipient] = await ethers.getSigners();
        const token = await deployToken("Defaults", "DEF");
        const Factory = await ethers.getContractFactory("TemplFactory");
        const factory = await Factory.deploy((await ethers.getSigners())[0].address, protocolRecipient.address, pct(10), modules.membershipModule, modules.treasuryModule, modules.governanceModule, modules.councilModule, templDeployer);
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
        expect(await templ.burnBps()).to.equal(BigInt(pct(30)));
        expect(await templ.treasuryBps()).to.equal(BigInt(pct(30)));
        expect(await templ.memberPoolBps()).to.equal(BigInt(pct(30)));
        expect(await templ.protocolFeeRecipient()).to.equal(protocolRecipient.address);
        expect(await templ.protocolBps()).to.equal(BigInt(pct(10)));
        expect(await templ.quorumBps()).to.equal(BigInt(pct(33)));
        expect(await templ.postQuorumVotingPeriod()).to.equal(36 * 60 * 60);
        expect(await templ.burnAddress()).to.equal("0x000000000000000000000000000000000000dEaD");
        expect(await templ.maxMembers()).to.equal(249n);
        expect(await templ.councilModeEnabled()).to.equal(true);
        expect(await templ.councilMemberCount()).to.equal(1n);

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
        expect(curveStyles).to.deep.equal([CURVE_STYLE.Exponential, CURVE_STYLE.Static]);
        expect(curveRates).to.deep.equal([10_094, 0]);
        expect(curveLengths).to.deep.equal([248, 0]);
        expect(templCreated.args.councilMode).to.equal(true);

        await mintToUsers(token, [joiner], ENTRY_FEE * 5n);
        await token.connect(joiner).approve(templAddress, ENTRY_FEE);
        await templ.connect(joiner).join();

        const expectedNextFee = (ENTRY_FEE * 10_094n) / 10_000n;
        expect(await templ.entryFee()).to.equal(expectedNextFee);
    });

    it("allows templ creation for a delegated priest", async function () {
        const [deployer, delegatedPriest, protocolRecipient] = await ethers.getSigners();
        const token = await deployToken("Delegated", "DLG");

        const Factory = await ethers.getContractFactory("TemplFactory");
        const factory = await Factory.deploy((await ethers.getSigners())[0].address, protocolRecipient.address, pct(10), modules.membershipModule, modules.treasuryModule, modules.governanceModule, modules.councilModule, templDeployer);
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
        expect(await templ.councilModeEnabled()).to.equal(true);
        expect(await templ.councilMemberCount()).to.equal(1n);

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
        expect(styles).to.deep.equal([CURVE_STYLE.Exponential, CURVE_STYLE.Static]);
        expect(rates).to.deep.equal([10_094, 0]);
        expect(lengths).to.deep.equal([248, 0]);
        expect(templCreated.args.councilMode).to.equal(true);
        expect(templCreated.args.instantQuorumBps).to.equal(10_000n);
    });

  it("reuses the immutable protocol configuration for every templ", async function () {
    const [, priest, protocolRecipient] = await ethers.getSigners();
    const tokenA = await deployToken("Immutable", "IMM");
    const tokenB = await deployToken("ImmutableTwo", "IM2");

    const Factory = await ethers.getContractFactory("TemplFactory");
    const protocolBps = pct(12);
    const factory = await Factory.deploy((await ethers.getSigners())[0].address, protocolRecipient.address, protocolBps, modules.membershipModule, modules.treasuryModule, modules.governanceModule, modules.councilModule, templDeployer);
    await factory.waitForDeployment();

    const firstConfig = withCouncilDefaults({
      priest: priest.address,
      token: await tokenA.getAddress(),
      entryFee: ENTRY_FEE,
      burnBps: pct(24),
      treasuryBps: pct(36),
      memberPoolBps: pct(28),
      quorumBps: pct(40),
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
    });

    const secondConfig = withCouncilDefaults({
      priest: priest.address,
      token: await tokenB.getAddress(),
      entryFee: ENTRY_FEE * 2n,
      burnBps: pct(26),
      treasuryBps: pct(34),
      memberPoolBps: pct(28),
      quorumBps: pct(35),
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
    });

    const firstTemplAddress = await factory.createTemplWithConfig.staticCall(firstConfig);
    await (await factory.createTemplWithConfig(firstConfig)).wait();

    const secondTemplAddress = await factory.createTemplWithConfig.staticCall(secondConfig);
    await (await factory.createTemplWithConfig(secondConfig)).wait();

    const firstTempl = await getTemplAt(firstTemplAddress, ethers.provider);
    const secondTempl = await getTemplAt(secondTemplAddress, ethers.provider);

    expect(await firstTempl.protocolFeeRecipient()).to.equal(protocolRecipient.address);
    expect(await secondTempl.protocolFeeRecipient()).to.equal(protocolRecipient.address);
    expect(await firstTempl.protocolBps()).to.equal(BigInt(protocolBps));
    expect(await secondTempl.protocolBps()).to.equal(BigInt(protocolBps));
  });

  it("does not allow changing access token via updateConfig (ignored)", async function () {
    const [, priest, protocolRecipient, member] = await ethers.getSigners();
    const tokenA = await deployToken("TokenA", "TKA");
    const tokenB = await deployToken("TokenB", "TKB");

    const Factory = await ethers.getContractFactory("TemplFactory");
    const protocolBps = pct(10);
    const factory = await Factory.deploy((await ethers.getSigners())[0].address, protocolRecipient.address, protocolBps, modules.membershipModule, modules.treasuryModule, modules.governanceModule, modules.councilModule, templDeployer);
    await factory.waitForDeployment();

    const config = withCouncilDefaults({
      priest: priest.address,
      token: await tokenA.getAddress(),
      entryFee: ENTRY_FEE,
      burnBps: -1,
      treasuryBps: -1,
      memberPoolBps: -1,
      quorumBps: 0,
      executionDelaySeconds: 0,
      burnAddress: ethers.ZeroAddress,
      priestIsDictator: false,
      maxMembers: 0,
      curveProvided: false,
      curve: defaultCurve(),
      name: DEFAULT_METADATA.name,
      description: DEFAULT_METADATA.description,
      logoLink: DEFAULT_METADATA.logoLink,
      proposalFeeBps: 0,
      referralShareBps: 0,
      councilMode: false
    });

    const templAddress = await factory.createTemplWithConfig.staticCall(config);
    await factory.createTemplWithConfig(config);
    const templ = await getTemplAt(templAddress, ethers.provider);

    // Join a member for governance
    await mintToUsers(tokenA, [member], ENTRY_FEE * 2n);
    await tokenA.connect(member).approve(templAddress, ENTRY_FEE);
    await templ.connect(member).join();

    // Propose update config attempting to change token to tokenB (should be ignored)
    await templ
      .connect(member)
      .createProposalUpdateConfig(
        0,
        0,
        0,
        0,
        false,
        36 * 60 * 60,
        "Ignore token change",
        "Token immutable"
      );
    const pid = (await templ.proposalCount()) - 1n;
    await templ.connect(member).vote(pid, true);
    const delay = Number(await templ.postQuorumVotingPeriod());
    await ethers.provider.send("evm_increaseTime", [delay + 1]);
    await ethers.provider.send("evm_mine", []);
    await expect(templ.connect(member).executeProposal(pid)).to.not.be.reverted;

    // Access token remains unchanged
    expect(await templ.accessToken()).to.equal(await tokenA.getAddress());
  });

    it("reverts when deployed with zero protocol recipient", async function () {
        const Factory = await ethers.getContractFactory("TemplFactory");
        await expect(Factory.deploy((await ethers.getSigners())[0].address, ethers.ZeroAddress, pct(10), modules.membershipModule, modules.treasuryModule, modules.governanceModule, modules.councilModule, templDeployer)).to.be.revertedWithCustomError(
            Factory,
            "InvalidRecipient"
        );
    });

    it("reverts when protocol percent exceeds total", async function () {
        const [, , protocolRecipient] = await ethers.getSigners();
        const Factory = await ethers.getContractFactory("TemplFactory");
        await expect(Factory.deploy((await ethers.getSigners())[0].address, protocolRecipient.address, 10_001, modules.membershipModule, modules.treasuryModule, modules.governanceModule, modules.councilModule, templDeployer)).to.be.revertedWithCustomError(
            Factory,
            "InvalidPercentageSplit"
        );
    });

    it("reverts when creating templ with missing token", async function () {
        const [, , protocolRecipient] = await ethers.getSigners();
        const Factory = await ethers.getContractFactory("TemplFactory");
        const factory = await Factory.deploy((await ethers.getSigners())[0].address, protocolRecipient.address, pct(10), modules.membershipModule, modules.treasuryModule, modules.governanceModule, modules.councilModule, templDeployer);
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
        const factory = await Factory.deploy((await ethers.getSigners())[0].address, protocolRecipient.address, pct(10), modules.membershipModule, modules.treasuryModule, modules.governanceModule, modules.councilModule, templDeployer);
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
        const factory = await Factory.deploy((await ethers.getSigners())[0].address, protocolRecipient.address, pct(10), modules.membershipModule, modules.treasuryModule, modules.governanceModule, modules.councilModule, templDeployer);
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
        const factory = await Factory.deploy((await ethers.getSigners())[0].address, protocolRecipient.address, pct(10), modules.membershipModule, modules.treasuryModule, modules.governanceModule, modules.councilModule, templDeployer);
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
        const factory = await Factory.deploy((await ethers.getSigners())[0].address, protocolRecipient.address, pct(10), modules.membershipModule, modules.treasuryModule, modules.governanceModule, modules.councilModule, templDeployer);
        await factory.waitForDeployment();

        await expect(
            factory.createTemplWithConfig(
                withCouncilDefaults({
                    priest: protocolRecipient.address,
                    token: await token.getAddress(),
                    entryFee: ENTRY_FEE,
                    burnBps: pct(30),
                    treasuryBps: pct(30),
                    memberPoolBps: pct(30),
                    quorumBps: pct(101),
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
            )
        ).to.be.revertedWithCustomError(factory, "InvalidPercentage");
    });

    it("reverts when instant quorum bps is below the quorum threshold", async function () {
        const [, , protocolRecipient] = await ethers.getSigners();
        const token = await deployToken("InstantMismatch", "INST");
        const Factory = await ethers.getContractFactory("TemplFactory");
        const factory = await Factory.deploy((await ethers.getSigners())[0].address, protocolRecipient.address, pct(10), modules.membershipModule, modules.treasuryModule, modules.governanceModule, modules.councilModule, templDeployer);
        await factory.waitForDeployment();

        await expect(
            factory.createTemplWithConfig(
                withCouncilDefaults({
                    priest: protocolRecipient.address,
                    token: await token.getAddress(),
                    entryFee: ENTRY_FEE,
                    burnBps: pct(30),
                    treasuryBps: pct(30),
                    memberPoolBps: pct(30),
                    quorumBps: pct(40),
                    instantQuorumBps: pct(30),
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
            )
        ).to.be.revertedWithCustomError(factory, "InstantQuorumBelowQuorum");
    });

    it("patches optional fields to defaults when config uses sentinel values", async function () {
        const [deployer, , protocolRecipient] = await ethers.getSigners();
        const token = await deployToken("Patched", "PTC");
        const Factory = await ethers.getContractFactory("TemplFactory");
        const factory = await Factory.deploy((await ethers.getSigners())[0].address, protocolRecipient.address, pct(10), modules.membershipModule, modules.treasuryModule, modules.governanceModule, modules.councilModule, templDeployer);
        await factory.waitForDeployment();

        const config = withCouncilDefaults({
            priest: ethers.ZeroAddress,
            token: await token.getAddress(),
            entryFee: ENTRY_FEE,
            burnBps: -1,
            treasuryBps: -1,
            memberPoolBps: -1,
            quorumBps: 0,
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
        });

        const templAddress = await factory.createTemplWithConfig.staticCall(config);
        await (await factory.createTemplWithConfig(config)).wait();

        const templ = await getTemplAt(templAddress, ethers.provider);

        expect(await templ.priest()).to.equal(deployer.address);
        expect(await templ.quorumBps()).to.equal(BigInt(pct(33)));
        expect(await templ.postQuorumVotingPeriod()).to.equal(36 * 60 * 60);
        expect(await templ.burnAddress()).to.equal("0x000000000000000000000000000000000000dEaD");
        expect(await templ.burnBps()).to.equal(BigInt(pct(30)));
        expect(await templ.treasuryBps()).to.equal(BigInt(pct(30)));
        expect(await templ.memberPoolBps()).to.equal(BigInt(pct(30)));
    });

    it("applies defaults for quorum, delay, and burn address when config omits them", async function () {
        const [, priest, protocolRecipient] = await ethers.getSigners();
        const token = await deployToken("Defaults2", "DEF2");
        const Factory = await ethers.getContractFactory("TemplFactory");
        const factory = await Factory.deploy((await ethers.getSigners())[0].address, protocolRecipient.address, pct(11), modules.membershipModule, modules.treasuryModule, modules.governanceModule, modules.councilModule, templDeployer);
        await factory.waitForDeployment();

        const config = withCouncilDefaults({
            priest: priest.address,
            token: await token.getAddress(),
            entryFee: ENTRY_FEE,
            burnBps: pct(30),
            treasuryBps: pct(30),
            memberPoolBps: pct(29),
            quorumBps: 0,
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
        });

        const templAddress = await factory.createTemplWithConfig.staticCall(config);
        await factory.createTemplWithConfig(config);
        const templ = await getTemplAt(templAddress, ethers.provider);

        expect(await templ.quorumBps()).to.equal(BigInt(pct(33)));
        expect(await templ.postQuorumVotingPeriod()).to.equal(36n * 60n * 60n);
        expect(await templ.burnAddress()).to.equal("0x000000000000000000000000000000000000dEaD");
    });

    

    it("restricts templ creation to the deployer until permissionless mode is enabled", async function () {
        const [deployer, outsider, protocolRecipient] = await ethers.getSigners();
        const token = await deployToken("Access", "ACC");
        const Factory = await ethers.getContractFactory("TemplFactory");
        const factory = await Factory.deploy(deployer.address, protocolRecipient.address, pct(10), modules.membershipModule, modules.treasuryModule, modules.governanceModule, modules.councilModule, templDeployer);
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

        const config = withCouncilDefaults({
            priest: deployer.address,
            token: tokenAddress,
            entryFee: ENTRY_FEE,
            burnBps: pct(30),
            treasuryBps: pct(30),
            memberPoolBps: pct(30),
            quorumBps: pct(33),
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
        });

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

    it("allows the factory deployer to transfer deployer role", async function () {
        const [deployer, newDeployer, outsider, protocolRecipient] = await ethers.getSigners();
        const Factory = await ethers.getContractFactory("TemplFactory");
        const factory = await Factory.deploy(deployer.address, protocolRecipient.address, pct(10), modules.membershipModule, modules.treasuryModule, modules.governanceModule, modules.councilModule, templDeployer);
        await factory.waitForDeployment();

        await expect(factory.connect(outsider).transferDeployer(newDeployer.address)).to.be.revertedWithCustomError(
            factory,
            "NotFactoryDeployer"
        );

        await expect(factory.transferDeployer(ethers.ZeroAddress)).to.be.revertedWithCustomError(
            factory,
            "InvalidRecipient"
        );

        await expect(factory.transferDeployer(deployer.address)).to.be.revertedWithCustomError(
            factory,
            "PermissionlessUnchanged"
        );

        await expect(factory.transferDeployer(newDeployer.address))
            .to.emit(factory, "DeployerTransferred")
            .withArgs(deployer.address, newDeployer.address);

        await expect(factory.setPermissionless(true)).to.be.revertedWithCustomError(factory, "NotFactoryDeployer");
        await expect(factory.connect(newDeployer).setPermissionless(true))
            .to.emit(factory, "PermissionlessModeUpdated")
            .withArgs(true);
    });
});
