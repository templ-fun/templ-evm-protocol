const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, joinMembers } = require("./utils/mintAndPurchase");
const {
    encodeWithdrawTreasuryDAO,
} = require("./utils/callDataBuilders");

describe("Treasury Withdrawal Reverts", function () {
    let templ;
    let token;
    let owner, priest, user1, user2, treasuryRecipient;
    let accounts;
    const ENTRY_FEE = ethers.parseUnits("100", 18);
    const TOKEN_SUPPLY = ethers.parseUnits("10000", 18);

    beforeEach(async function () {
        ({ templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE }));
        [owner, priest, user1, user2, treasuryRecipient] = accounts;

        await mintToUsers(token, [user1, user2], TOKEN_SUPPLY);

        await joinMembers(templ, token, [user1, user2]);
    });

    describe("withdrawTreasuryDAO", function () {
        it("should revert with InvalidRecipient", async function () {
            await templ.connect(user1).createProposalWithdrawTreasury(
                token.target,
                ethers.ZeroAddress,
                ethers.parseUnits("1", 18),
                7 * 24 * 60 * 60,
                "Withdraw treasury",
                "Invalid recipient"
            );

            await templ.connect(user1).vote(0, true);
            await templ.connect(user2).vote(0, true);

            await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine");

            await expect(templ.executeProposal(0))
                .to.be.revertedWithCustomError(templ, "InvalidRecipient");
        });

        it("should revert with AmountZero", async function () {
            await templ.connect(user1).createProposalWithdrawTreasury(
                token.target,
                user1.address,
                0,
                7 * 24 * 60 * 60,
                "Withdraw treasury",
                "Zero amount"
            );

            await templ.connect(user1).vote(0, true);
            await templ.connect(user2).vote(0, true);

            await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine");

            await expect(templ.executeProposal(0))
                .to.be.revertedWithCustomError(templ, "AmountZero");
        });

        it("should revert with InsufficientTreasuryBalance", async function () {
            const treasury = await templ.treasuryBalance();
            await templ.connect(user1).createProposalWithdrawTreasury(
                token.target,
                user1.address,
                treasury + 1n,
                7 * 24 * 60 * 60,
                "Withdraw treasury",
                "Insufficient balance"
            );

            await templ.connect(user1).vote(0, true);
            await templ.connect(user2).vote(0, true);

            await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine");

        await expect(templ.executeProposal(0))
            .to.be.revertedWithCustomError(templ, "InsufficientTreasuryBalance");
        });

        it("should revert for non-held token balance", async function () {
            const OtherToken = await ethers.getContractFactory("TestToken");
            const otherToken = await OtherToken.deploy("Other", "OTH", 18);

            await templ.connect(user1).createProposalWithdrawTreasury(
                otherToken.target,
                user1.address,
                1n,
                7 * 24 * 60 * 60,
                "Withdraw treasury",
                "Token not held"
            );

            await templ.connect(user1).vote(0, true);
            await templ.connect(user2).vote(0, true);
            await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine");

            await expect(templ.executeProposal(0)).to.be.revertedWithCustomError(
                templ,
                "InsufficientTreasuryBalance"
            );
        });
    });

    // withdrawAll reverts no longer applicable
});
