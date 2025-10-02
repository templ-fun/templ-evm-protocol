const { expect } = require("chai");
const { ethers } = require("hardhat");
const { mintToUsers, joinMembers } = require("./utils/mintAndPurchase");

describe("TemplFactory", function () {
    const ENTRY_FEE = ethers.parseUnits("100", 18);
    const DEFAULT_FEE_CURVE_SCALE = ethers.parseUnits("1", 18);
    const DEFAULT_FEE_CURVE_SLOPE = ethers.parseUnits("1.1", 18);
    const BPS_DENOMINATOR = 10_000n;
    const pct = (value) => value * 100;

    async function deployToken(name = "Test", symbol = "TEST") {
        const Token = await ethers.getContractFactory("contracts/mocks/TestToken.sol:TestToken");
        const token = await Token.deploy(name, symbol, 18);
        await token.waitForDeployment();
    return token;
  }

  it("reverts when protocol recipient is the zero address", async function () {
    const Factory = await ethers.getContractFactory("TemplFactory");
    await expect(Factory.deploy(ethers.ZeroAddress, 1_000)).to.be.revertedWithCustomError(
      Factory,
      "InvalidRecipient"
    );
  });

  it("deploys templ contracts with fixed protocol config", async function () {
    const [, priest, protocolRecipient, member] = await ethers.getSigners();
    const token = await deployToken();

        const Factory = await ethers.getContractFactory("TemplFactory");
        const protocolPercent = pct(12);
        const factory = await Factory.deploy(protocolRecipient.address, protocolPercent);
        await factory.waitForDeployment();

        const burnPercent = pct(28);
        const treasuryPercent = pct(40);
        const memberPoolPercent = pct(20);
        const quorumPercent = pct(40);
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
        expect(await templ.protocolPercent()).to.equal(BigInt(protocolPercent));
        expect(await templ.burnPercent()).to.equal(BigInt(burnPercent));
        expect(await templ.treasuryPercent()).to.equal(BigInt(treasuryPercent));
        expect(await templ.memberPoolPercent()).to.equal(BigInt(memberPoolPercent));
        expect(await templ.quorumPercent()).to.equal(BigInt(quorumPercent));
        expect(await templ.executionDelayAfterQuorum()).to.equal(executionDelaySeconds);
        expect(await templ.burnAddress()).to.equal(customBurnAddress);
        expect(await templ.MAX_MEMBERS()).to.equal(0n);
        expect(await templ.templHomeLink()).to.equal(homeLink);
        const feeCurveState = await templ.feeCurve();
        expect(feeCurveState[0]).to.equal(2);
        expect(feeCurveState[1]).to.equal(DEFAULT_FEE_CURVE_SLOPE);
        expect(feeCurveState[2]).to.equal(DEFAULT_FEE_CURVE_SCALE);

        await mintToUsers(token, [member], ENTRY_FEE * 10n);

        const templContractAddress = await templ.getAddress();
        const currentMembers = await templ.memberCount();
        let expectedJoinFee = ENTRY_FEE;
        if (currentMembers > 0n) {
            expectedJoinFee = (ENTRY_FEE * DEFAULT_FEE_CURVE_SLOPE) / DEFAULT_FEE_CURVE_SCALE;
        }

        await token.connect(member).approve(templContractAddress, expectedJoinFee);

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

        const burnAmount = (expectedJoinFee * BigInt(burnPercent)) / BPS_DENOMINATOR;
        const memberPoolAmount = (expectedJoinFee * BigInt(memberPoolPercent)) / BPS_DENOMINATOR;
        const protocolAmount = (expectedJoinFee * BigInt(protocolPercent)) / BPS_DENOMINATOR;
        const treasuryAmount = expectedJoinFee - burnAmount - memberPoolAmount - protocolAmount;

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
        const factory = await Factory.deploy(protocolRecipient.address, protocolPercent);
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
        const factory = await Factory.deploy(protocolRecipient.address, pct(12));
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

  it("applies factory defaults when optional fields are omitted", async function () {
    const [deployer, protocolRecipient] = await ethers.getSigners();
    const token = await deployToken("Minimal", "MIN");

    const Factory = await ethers.getContractFactory("TemplFactory");
    const protocolPercent = pct(15);
    const factory = await Factory.deploy(protocolRecipient.address, protocolPercent);
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
      homeLink: ""
    };

    const templAddress = await factory.createTemplWithConfig.staticCall(config);
    await (await factory.createTemplWithConfig(config)).wait();

    const templ = await ethers.getContractAt("TEMPL", templAddress);

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
        const factory = await Factory.deploy(protocolRecipient.address, pct(15));
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
            homeLink: ""
        })
        ).to.be.revertedWithCustomError(factory, "InvalidPercentageSplit");
    });

    it("allows explicit zero values in the fee split", async function () {
        const [, priest, protocolRecipient] = await ethers.getSigners();
        const token = await deployToken("Zero", "ZERO");
        const Factory = await ethers.getContractFactory("TemplFactory");
        const protocolPercent = pct(10);
        const factory = await Factory.deploy(protocolRecipient.address, protocolPercent);
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
            homeLink: "",
        };

        const templAddress = await factory.createTemplWithConfig.staticCall(config);
        await (await factory.createTemplWithConfig(config)).wait();

        const templ = await ethers.getContractAt("TEMPL", templAddress);

        expect(await templ.burnPercent()).to.equal(0);
        expect(await templ.treasuryPercent()).to.equal(BigInt(pct(70)));
        expect(await templ.memberPoolPercent()).to.equal(BigInt(pct(20)));
        expect(await templ.protocolPercent()).to.equal(BigInt(protocolPercent));
    });

    it("reverts when negative percentages other than the sentinel are provided", async function () {
        const [, priest, protocolRecipient] = await ethers.getSigners();
        const token = await deployToken("Neg", "NEG");
        const Factory = await ethers.getContractFactory("TemplFactory");
        const factory = await Factory.deploy(protocolRecipient.address, pct(10));
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
                homeLink: "",
            })
        ).to.be.revertedWithCustomError(factory, "InvalidPercentage");
    });

    it("defaults splits, priest, quorum and delay when using simple create", async function () {
        const [deployer, , protocolRecipient] = await ethers.getSigners();
        const token = await deployToken("Defaults", "DEF");
        const Factory = await ethers.getContractFactory("TemplFactory");
        const factory = await Factory.deploy(protocolRecipient.address, pct(10));
        await factory.waitForDeployment();

        const templAddress = await factory.createTempl.staticCall(await token.getAddress(), ENTRY_FEE);
        const tx = await factory.createTempl(await token.getAddress(), ENTRY_FEE);
        await tx.wait();

        const templ = await ethers.getContractAt("TEMPL", templAddress);

        expect(await templ.priest()).to.equal(deployer.address);
    expect(await templ.burnPercent()).to.equal(BigInt(pct(30)));
    expect(await templ.treasuryPercent()).to.equal(BigInt(pct(30)));
    expect(await templ.memberPoolPercent()).to.equal(BigInt(pct(30)));
    expect(await templ.protocolFeeRecipient()).to.equal(protocolRecipient.address);
    expect(await templ.protocolPercent()).to.equal(BigInt(pct(10)));
    expect(await templ.quorumPercent()).to.equal(BigInt(pct(33)));
        expect(await templ.executionDelayAfterQuorum()).to.equal(7 * 24 * 60 * 60);
        expect(await templ.burnAddress()).to.equal("0x000000000000000000000000000000000000dEaD");
    });

    it("allows templ creation for a delegated priest", async function () {
        const [deployer, delegatedPriest, protocolRecipient] = await ethers.getSigners();
        const token = await deployToken("Delegated", "DLG");

        const Factory = await ethers.getContractFactory("TemplFactory");
        const factory = await Factory.deploy(protocolRecipient.address, pct(10));
        await factory.waitForDeployment();

        const templAddress = await factory.createTemplFor.staticCall(
            delegatedPriest.address,
            await token.getAddress(),
            ENTRY_FEE
        );
        const tx = await factory.createTemplFor(delegatedPriest.address, await token.getAddress(), ENTRY_FEE);
        const receipt = await tx.wait();

        const templ = await ethers.getContractAt("TEMPL", templAddress);
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
    });

  it("reuses the immutable protocol configuration for every templ", async function () {
    const [, priest, protocolRecipient] = await ethers.getSigners();
    const tokenA = await deployToken("Immutable", "IMM");
    const tokenB = await deployToken("ImmutableTwo", "IM2");

    const Factory = await ethers.getContractFactory("TemplFactory");
    const protocolPercent = pct(12);
    const factory = await Factory.deploy(protocolRecipient.address, protocolPercent);
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
      homeLink: "",
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
      homeLink: "https://templ.fun/immutability",
    };

    const firstTemplAddress = await factory.createTemplWithConfig.staticCall(firstConfig);
    await (await factory.createTemplWithConfig(firstConfig)).wait();

    const secondTemplAddress = await factory.createTemplWithConfig.staticCall(secondConfig);
    await (await factory.createTemplWithConfig(secondConfig)).wait();

    const firstTempl = await ethers.getContractAt("TEMPL", firstTemplAddress);
    const secondTempl = await ethers.getContractAt("TEMPL", secondTemplAddress);

    expect(await firstTempl.protocolFeeRecipient()).to.equal(protocolRecipient.address);
    expect(await secondTempl.protocolFeeRecipient()).to.equal(protocolRecipient.address);
    expect(await firstTempl.protocolPercent()).to.equal(BigInt(protocolPercent));
    expect(await secondTempl.protocolPercent()).to.equal(BigInt(protocolPercent));
  });

    it("reverts when deployed with zero protocol recipient", async function () {
        const Factory = await ethers.getContractFactory("TemplFactory");
    await expect(Factory.deploy(ethers.ZeroAddress, pct(10))).to.be.revertedWithCustomError(
        Factory,
        "InvalidRecipient"
    );
    });

    it("reverts when protocol percent exceeds total", async function () {
        const [, , protocolRecipient] = await ethers.getSigners();
        const Factory = await ethers.getContractFactory("TemplFactory");
        await expect(Factory.deploy(protocolRecipient.address, 10_001)).to.be.revertedWithCustomError(
            Factory,
            "InvalidPercentageSplit"
        );
    });

    it("reverts when creating templ with missing token", async function () {
        const [, , protocolRecipient] = await ethers.getSigners();
        const Factory = await ethers.getContractFactory("TemplFactory");
        const factory = await Factory.deploy(protocolRecipient.address, pct(10));
        await factory.waitForDeployment();

        await expect(factory.createTempl(ethers.ZeroAddress, ENTRY_FEE)).to.be.revertedWithCustomError(
            factory,
            "InvalidRecipient"
        );
    });

    it("reverts when delegated priest address is zero", async function () {
        const [, , protocolRecipient] = await ethers.getSigners();
        const token = await deployToken("ZeroPriest", "ZP");

        const Factory = await ethers.getContractFactory("TemplFactory");
        const factory = await Factory.deploy(protocolRecipient.address, pct(10));
        await factory.waitForDeployment();

        await expect(
            factory.createTemplFor(ethers.ZeroAddress, await token.getAddress(), ENTRY_FEE)
        ).to.be.revertedWithCustomError(factory, "InvalidRecipient");
    });

    it("reverts when creating templ with entry fee below minimum", async function () {
        const [, , protocolRecipient] = await ethers.getSigners();
        const token = await deployToken("LowFee", "LOW");
        const Factory = await ethers.getContractFactory("TemplFactory");
        const factory = await Factory.deploy(protocolRecipient.address, pct(10));
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
        const factory = await Factory.deploy(protocolRecipient.address, pct(10));
        await factory.waitForDeployment();

        await expect(
            factory.createTempl(await token.getAddress(), ENTRY_FEE + 5n)
        ).to.be.revertedWithCustomError(factory, "InvalidEntryFee");
    });

    it("reverts when quorum percent exceeds 100", async function () {
        const [, , protocolRecipient] = await ethers.getSigners();
        const token = await deployToken("Quorum", "QRM");
        const Factory = await ethers.getContractFactory("TemplFactory");
        const factory = await Factory.deploy(protocolRecipient.address, pct(10));
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
                homeLink: ""
            })
        ).to.be.revertedWithCustomError(factory, "InvalidPercentage");
    });

    it("patches optional fields to defaults when config uses sentinel values", async function () {
        const [deployer, , protocolRecipient] = await ethers.getSigners();
        const token = await deployToken("Patched", "PTC");
        const Factory = await ethers.getContractFactory("TemplFactory");
        const factory = await Factory.deploy(protocolRecipient.address, pct(10));
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
        const factory = await Factory.deploy(protocolRecipient.address, pct(11));
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
            homeLink: "",
        };

        const templAddress = await factory.createTemplWithConfig.staticCall(config);
        await factory.createTemplWithConfig(config);
        const templ = await ethers.getContractAt("TEMPL", templAddress);

        expect(await templ.quorumPercent()).to.equal(BigInt(pct(33)));
        expect(await templ.executionDelayAfterQuorum()).to.equal(7n * 24n * 60n * 60n);
        expect(await templ.burnAddress()).to.equal("0x000000000000000000000000000000000000dEaD");
    });

    it("restricts templ creation to the deployer until permissionless mode is enabled", async function () {
        const [deployer, outsider, protocolRecipient] = await ethers.getSigners();
        const token = await deployToken("Access", "ACC");
        const Factory = await ethers.getContractFactory("TemplFactory");
        const factory = await Factory.deploy(protocolRecipient.address, pct(10));
        await factory.waitForDeployment();

        const tokenAddress = await token.getAddress();
        await expect(
            factory.connect(outsider).createTempl(tokenAddress, ENTRY_FEE)
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
            homeLink: "",
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

        const templ = await ethers.getContractAt("TEMPL", templAddress);
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
