const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, purchaseAccess } = require("./utils/mintAndPurchase");

describe("updateConfigDAO", function () {
    const ENTRY_FEE = ethers.parseUnits("100", 18);
    const TOKEN_SUPPLY = ethers.parseUnits("10000", 18);

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
        await purchaseAccess(templ, token, [member]);
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
                60,
                60,
                10,
                true,
                7 * 24 * 60 * 60
            )
        ).to.be.revertedWithCustomError(templ, "InvalidFeeSplit");
    });

    it("updates fee split when governance approves", async function () {
        const NEW_BURN = 20;
        const NEW_TREASURY = 45;
        const NEW_MEMBER = 25;

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

        expect(await templ.burnBP()).to.equal(NEW_BURN);
        expect(await templ.treasuryBP()).to.equal(NEW_TREASURY);
        expect(await templ.memberPoolBP()).to.equal(NEW_MEMBER);
        expect(await templ.protocolBP()).to.equal(10);

        const beforeBurned = await templ.totalBurned();
        const beforeTreasury = await templ.totalToTreasury();
        const beforeMember = await templ.totalToMemberPool();
        const beforeProtocol = await templ.totalToProtocol();

        await purchaseAccess(templ, token, [secondMember]);

        const burnAmount = (ENTRY_FEE * BigInt(NEW_BURN)) / 100n;
        const treasuryAmount = (ENTRY_FEE * BigInt(NEW_TREASURY)) / 100n;
        const memberPoolAmount = (ENTRY_FEE * BigInt(NEW_MEMBER)) / 100n;
        const protocolAmount = (ENTRY_FEE * 10n) / 100n;

        const afterBurned = await templ.totalBurned();
        const afterTreasury = await templ.totalToTreasury();
        const afterMember = await templ.totalToMemberPool();
        const afterProtocol = await templ.totalToProtocol();

        expect(afterBurned - beforeBurned).to.equal(burnAmount);
        expect(afterMember - beforeMember).to.equal(memberPoolAmount);
        expect(afterProtocol - beforeProtocol).to.equal(protocolAmount);
        expect(afterTreasury - beforeTreasury).to.be.gte(treasuryAmount);
    });
});
