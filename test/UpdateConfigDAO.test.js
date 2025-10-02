const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, joinMembers } = require("./utils/mintAndPurchase");

describe("updateConfigDAO", function () {
    const ENTRY_FEE = ethers.parseUnits("100", 18);
    const TOKEN_SUPPLY = ethers.parseUnits("10000", 18);
    const BPS_DENOMINATOR = 10_000n;
    const pct = (value) => value * 100;
    const computeJoinFee = async (templ, prospectiveCount) => {
        const entry = await templ.entryFee();
        const curve = await templ.feeCurve();
        const formula = Number(curve[0]);
        if (formula === 0) {
            return entry;
        }
        const count = typeof prospectiveCount === "bigint" ? prospectiveCount : BigInt(prospectiveCount);
        return entry + (curve[1] * count) / curve[2];
    };

    let templ;
    let token;
    let member;
    let secondMember;
    let priest;
    let accounts;

    beforeEach(async function () {
        ({ templ, token, accounts, priest } = await deployTempl({ entryFee: ENTRY_FEE }));
        [, , member, secondMember] = accounts;

        await mintToUsers(token, [member, secondMember], TOKEN_SUPPLY);
        await joinMembers(templ, token, [member]);
    });

    it("reverts when entry fee is less than 10", async function () {
        await expect(
            templ.connect(member).createProposalUpdateConfig(
                5,
                0,
                0,
                0,
                false,
                7 * 24 * 60 * 60
            )
        ).to.be.revertedWithCustomError(templ, "EntryFeeTooSmall");
    });

    it("reverts when entry fee is not divisible by 10", async function () {
        await expect(
            templ.connect(member).createProposalUpdateConfig(
                ENTRY_FEE + 5n,
                0,
                0,
                0,
                false,
                7 * 24 * 60 * 60
            )
        ).to.be.revertedWithCustomError(templ, "InvalidEntryFee");
    });

    it("updateConfig proposal executes when token unchanged", async function () {
        await templ.connect(member).createProposalUpdateConfig(
            ENTRY_FEE + 10n,
            0,
            0,
            0,
            false,
            7 * 24 * 60 * 60
        );
        await templ.connect(member).vote(0, true);
        await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
        await ethers.provider.send("evm_mine");
        await expect(templ.executeProposal(0)).to.not.be.reverted;
    });

    it("reverts when fee split values are invalid", async function () {
        await expect(
            templ.connect(member).createProposalUpdateConfig(
                0,
                pct(60),
                pct(60),
                pct(10),
                true,
                7 * 24 * 60 * 60
            )
        ).to.be.revertedWithCustomError(templ, "InvalidPercentageSplit");
    });

    it("updates fee split when governance approves", async function () {
        const NEW_BURN = pct(20);
        const NEW_TREASURY = pct(45);
        const NEW_MEMBER = pct(25);

        await templ.connect(member).createProposalUpdateConfig(
            0,
            NEW_BURN,
            NEW_TREASURY,
            NEW_MEMBER,
            true,
            7 * 24 * 60 * 60
        );
        await templ.connect(member).vote(0, true);
        await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
        await ethers.provider.send("evm_mine");
        await templ.executeProposal(0);

        expect(await templ.burnPercent()).to.equal(BigInt(NEW_BURN));
        expect(await templ.treasuryPercent()).to.equal(BigInt(NEW_TREASURY));
        expect(await templ.memberPoolPercent()).to.equal(BigInt(NEW_MEMBER));
        expect(await templ.protocolPercent()).to.equal(BigInt(pct(10)));

        const burnAddress = await templ.burnAddress();
        const protocolRecipient = await templ.protocolFeeRecipient();

        const burnBalanceBefore = await token.balanceOf(burnAddress);
        const treasuryBefore = await templ.treasuryBalance();
        const memberPoolBefore = await templ.memberPoolBalance();
        const protocolBalanceBefore = await token.balanceOf(protocolRecipient);

        const templAddress = await templ.getAddress();
        await token.connect(secondMember).approve(templAddress, ENTRY_FEE);
        const joinTx = await templ.connect(secondMember).join();
        await joinTx.wait();

        const burnAmount = (ENTRY_FEE * BigInt(NEW_BURN)) / BPS_DENOMINATOR;
        const treasuryAmount = (ENTRY_FEE * BigInt(NEW_TREASURY)) / BPS_DENOMINATOR;
        const memberPoolAmount = (ENTRY_FEE * BigInt(NEW_MEMBER)) / BPS_DENOMINATOR;
        const protocolAmount = (ENTRY_FEE * BigInt(pct(10))) / BPS_DENOMINATOR;

        const burnBalanceAfter = await token.balanceOf(burnAddress);
        const treasuryAfter = await templ.treasuryBalance();
        const memberPoolAfter = await templ.memberPoolBalance();
        const protocolBalanceAfter = await token.balanceOf(protocolRecipient);

        expect(burnBalanceAfter - burnBalanceBefore).to.equal(burnAmount);
    expect(memberPoolAfter - memberPoolBefore).to.equal(memberPoolAmount);
    expect(protocolBalanceAfter - protocolBalanceBefore).to.equal(protocolAmount);
    expect(treasuryAfter - treasuryBefore).to.equal(treasuryAmount);
  });

    it("updates the fee curve when governance approves", async function () {
        const slope = ethers.parseUnits("2", 18);
        const scale = 1n;

        expect(await computeJoinFee(templ, await templ.memberCount())).to.equal(ENTRY_FEE);

        await templ.connect(member).createProposalSetFeeCurve(
            1,
            slope,
            scale,
            7 * 24 * 60 * 60,
            "Linear fee curve",
            "Increase join cost by 2 tokens per member"
        );
        await templ.connect(member).vote(0, true);
        await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
        await ethers.provider.send("evm_mine");
        await templ.executeProposal(0);

        const curve = await templ.feeCurve();
        expect(curve[0]).to.equal(1);
        expect(curve[1]).to.equal(slope);
        expect(curve[2]).to.equal(scale);

        const expectedNextFee = ENTRY_FEE + (slope * 2n) / scale;
        expect(await computeJoinFee(templ, await templ.memberCount())).to.equal(expectedNextFee);

        const templAddress = await templ.getAddress();
        await token.connect(secondMember).approve(templAddress, expectedNextFee);
        const joinTx = await templ.connect(secondMember).join();
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

        expect(memberJoined).to.not.equal(undefined);
        expect(memberJoined.args.totalAmount).to.equal(expectedNextFee);

        const futureFee = await computeJoinFee(templ, await templ.memberCount());
        expect(futureFee).to.equal(ENTRY_FEE + (slope * 3n) / scale);
    });

    it("validates scale and slope when creating fee curve proposals", async function () {
        await expect(
            templ.connect(member).createProposalSetFeeCurve(
                1,
                1n,
                0,
                7 * 24 * 60 * 60,
                "Bad",
                "Zero scale"
            )
        ).to.be.revertedWithCustomError(templ, "InvalidFeeCurve");

        await expect(
            templ.connect(member).createProposalSetFeeCurve(
                0,
                1n,
                ethers.parseUnits("1", 18),
                7 * 24 * 60 * 60,
                "Bad",
                "Constant with slope"
            )
        ).to.be.revertedWithCustomError(templ, "InvalidFeeCurve");
    });
});
