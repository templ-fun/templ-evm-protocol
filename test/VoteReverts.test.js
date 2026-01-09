const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, joinMembers } = require("./utils/mintAndPurchase");
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
        await joinMembers(templ, token, [member1]);
    });

    it("reverts when voting on non-existent proposal", async function () {
        await expect(templ.connect(member1).vote(999, true))
            .to.be.revertedWithCustomError(templ, "InvalidProposal");
    });

    it("reverts when voting after endTime", async function () {
        await templ.connect(member1).createProposalWithdrawTreasury(
            token.target,
            member1.address,
            ethers.parseUnits("10", 18),
            7 * 24 * 60 * 60,
            "Withdraw treasury",
            "Vote after endTime"
        );

        await ethers.provider.send("evm_increaseTime", [7 * 24 * 60 * 60 + 1]);
        await ethers.provider.send("evm_mine");

        await expect(templ.connect(member1).vote(0, true))
            .to.be.revertedWithCustomError(templ, "VotingEnded");
    });

    it("counts first-time yes votes from non-proposers", async function () {
        const member2 = accounts[3];
        await mintToUsers(token, [member2], TOKEN_SUPPLY);
        await joinMembers(templ, token, [member2]);

        await templ.connect(member1).createProposalWithdrawTreasury(
            token.target,
            member1.address,
            ethers.parseUnits("10", 18),
            7 * 24 * 60 * 60,
            "Withdraw treasury",
            "Count yes vote"
        );

        await templ.connect(member2).vote(0, true);
        const proposal = await templ.proposals(0);
        expect(proposal.yesVotes).to.equal(2n);
    });
});
