const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, purchaseAccess } = require("./utils/mintAndPurchase");
const {
    encodeUpdateConfigDAO,
    encodeWithdrawAllTreasuryDAO,
} = require("./utils/callDataBuilders");

describe("updateConfigDAO", function () {
    const ENTRY_FEE = ethers.parseUnits("100", 18);
    const TOKEN_SUPPLY = ethers.parseUnits("10000", 18);

    let templ;
    let token;
    let member;
    let priest;
    let accounts;

    beforeEach(async function () {
        ({ templ, token, accounts, priest } = await deployTempl({ entryFee: ENTRY_FEE }));
        [, , member] = accounts;

        await mintToUsers(token, [member], TOKEN_SUPPLY);
        await purchaseAccess(templ, token, [member]);
    });

    it("reverts when entry fee is less than 10", async function () {
        const smallFee = 5;
        const callData = encodeUpdateConfigDAO(
            ethers.ZeroAddress,
            smallFee
        );

        await templ.connect(member).createProposal(
            "Small Fee",
            "desc",
            callData,
            7 * 24 * 60 * 60
        );

        await templ.connect(member).vote(0, true);
        await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
        await ethers.provider.send("evm_mine");

        await expect(templ.executeProposal(0))
            .to.be.revertedWithCustomError(templ, "EntryFeeTooSmall");
    });

    it("reverts when entry fee is not divisible by 10", async function () {
        const invalidFee = ENTRY_FEE + 5n;
        const callData = encodeUpdateConfigDAO(
            ethers.ZeroAddress,
            invalidFee
        );

        await templ.connect(member).createProposal(
            "Invalid Fee",
            "desc",
            callData,
            7 * 24 * 60 * 60
        );

        await templ.connect(member).vote(0, true);
        await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
        await ethers.provider.send("evm_mine");

        await expect(templ.executeProposal(0))
            .to.be.revertedWithCustomError(templ, "InvalidEntryFee");
    });

    it("reverts on token change attempts (token change disabled)", async function () {
        const fakeToken = accounts[9];
        const callData = encodeUpdateConfigDAO(
            fakeToken.address,
            0
        );

        await templ.connect(member).createProposal(
            "Try Token Change",
            "should revert",
            callData,
            7 * 24 * 60 * 60
        );

        await templ.connect(member).vote(0, true);
        await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
        await ethers.provider.send("evm_mine");

        await expect(templ.executeProposal(0))
            .to.be.revertedWithCustomError(templ, "TokenChangeDisabled");
    });
});
