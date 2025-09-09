const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, purchaseAccess } = require("./utils/mintAndPurchase");
const {
    encodeWithdrawTreasuryDAO,
    encodeWithdrawAllTreasuryDAO,
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

        await purchaseAccess(templ, token, [user1, user2]);
    });

    describe("withdrawTreasuryDAO", function () {
        it("should revert with InvalidRecipient", async function () {
            const callData = encodeWithdrawTreasuryDAO(
                token.target,
                ethers.ZeroAddress,
                ethers.parseUnits("1", 18),
                "Invalid"
            );

            await templ.connect(user1).createProposal(
                "Bad withdraw",
                "Invalid recipient",
                callData,
                7 * 24 * 60 * 60
            );

            await templ.connect(user1).vote(0, true);
            await templ.connect(user2).vote(0, true);

            await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine");

            await expect(templ.executeProposal(0))
                .to.be.revertedWithCustomError(templ, "InvalidRecipient");
        });

        it("should revert with AmountZero", async function () {
            const callData = encodeWithdrawTreasuryDAO(
                token.target,
                user1.address,
                0,
                "Zero"
            );

            await templ.connect(user1).createProposal(
                "Zero amount",
                "Zero withdrawal",
                callData,
                7 * 24 * 60 * 60
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
            const callData = encodeWithdrawTreasuryDAO(
                token.target,
                user1.address,
                treasury + 1n,
                "Too much"
            );

            await templ.connect(user1).createProposal(
                "Too much",
                "Exceeds balance",
                callData,
                7 * 24 * 60 * 60
            );

            await templ.connect(user1).vote(0, true);
            await templ.connect(user2).vote(0, true);

            await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine");

            await expect(templ.executeProposal(0))
                .to.be.revertedWithCustomError(templ, "InsufficientTreasuryBalance");
        });
    });

    describe("withdrawAllTreasuryDAO", function () {
        it("should revert with InvalidRecipient", async function () {
            const callData = encodeWithdrawAllTreasuryDAO(
                token.target,
                ethers.ZeroAddress,
                "Invalid"
            );

            await templ.connect(user1).createProposal(
                "Withdraw all bad",
                "Invalid recipient",
                callData,
                7 * 24 * 60 * 60
            );

            await templ.connect(user1).vote(0, true);
            await templ.connect(user2).vote(0, true);

            await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine");

            await expect(templ.executeProposal(0))
                .to.be.revertedWithCustomError(templ, "InvalidRecipient");
        });

        it("should revert with NoTreasuryFunds", async function () {
            const callData = encodeWithdrawAllTreasuryDAO(
                token.target,
                user1.address,
                "Valid"
            );

            // First, withdraw all funds to empty treasury
            await templ.connect(user1).createProposal(
                "Withdraw all",
                "Empty treasury",
                callData,
                7 * 24 * 60 * 60
            );

            await templ.connect(user1).vote(0, true);
            await templ.connect(user2).vote(0, true);
            await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine");
            await templ.executeProposal(0);
            expect(await templ.treasuryBalance()).to.equal(0n);

            // Now, attempt another withdrawAll with empty treasury
            await templ.connect(user1).createProposal(
                "Withdraw again",
                "No funds",
                callData,
                7 * 24 * 60 * 60
            );

            await templ.connect(user1).vote(1, true);
            await templ.connect(user2).vote(1, true);
            await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine");

            await expect(templ.executeProposal(1))
                .to.be.revertedWithCustomError(templ, "NoTreasuryFunds");
        });
    });
});

