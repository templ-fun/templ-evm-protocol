const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, purchaseAccess } = require("./utils/mintAndPurchase");
const { encodeWithdrawTreasuryDAO } = require("./utils/callDataBuilders");

describe("Vote reverts", function () {
    let templ;
    let token;
    let owner, priest, member1;
    let accounts;
    const ENTRY_FEE = ethers.parseUnits("100", 18);
    const TOKEN_SUPPLY = ethers.parseUnits("10000", 18);

    beforeEach(async function () {
        ({ templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE }));
        [owner, priest, member1] = accounts;

        await mintToUsers(token, [member1], TOKEN_SUPPLY);
        await purchaseAccess(templ, token, [member1]);
    });

    it("reverts when voting on non-existent proposal", async function () {
        await expect(templ.connect(member1).vote(999, true))
            .to.be.revertedWithCustomError(templ, "InvalidProposal");
    });

    it("reverts when voting after endTime", async function () {
        const callData = encodeWithdrawTreasuryDAO(
            token.target,
            member1.address,
            ethers.parseUnits("10", 18),
            "Test"
        );

        await templ.connect(member1).createProposal(
            "Test Proposal",
            "Test description",
            callData,
            7 * 24 * 60 * 60
        );

        await ethers.provider.send("evm_increaseTime", [7 * 24 * 60 * 60 + 1]);
        await ethers.provider.send("evm_mine");

        await expect(templ.connect(member1).vote(0, true))
            .to.be.revertedWithCustomError(templ, "VotingEnded");
    });
});

