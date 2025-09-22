const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, purchaseAccess } = require("./utils/mintAndPurchase");
const {
    encodeWithdrawTreasuryDAO,
    encodeSetPausedDAO,
} = require("./utils/callDataBuilders");

describe("Voting Eligibility Based on Join Time", function () {
    let templ;
    let token;
    let owner, priest, member1, member2, member3, member4, lateMember;
    let accounts;
    const ENTRY_FEE = ethers.parseUnits("100", 18);
    const TOKEN_SUPPLY = ethers.parseUnits("10000", 18);

    beforeEach(async function () {
        ({ templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE }));
        [owner, priest, member1, member2, member3, member4, lateMember] = accounts;

        await mintToUsers(token, [member1, member2, member3, member4, lateMember], TOKEN_SUPPLY);
    });

    describe("Voting Eligibility Rules", function () {
        it("Should allow members who joined before proposal to vote", async function () {
            // Members 1, 2, 3 join
            await token.connect(member1).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member1).purchaseAccess();
            
            await token.connect(member2).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member2).purchaseAccess();
            
            await token.connect(member3).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member3).purchaseAccess();

            // Wait a bit to ensure clear timestamp difference
            await ethers.provider.send("evm_increaseTime", [100]);
            await ethers.provider.send("evm_mine");

            // Member 1 creates proposal
            await templ.connect(member1).createProposalWithdrawTreasury(
                token.target,
                member1.address,
                ethers.parseUnits("10", 18),
                "Test",
                7 * 24 * 60 * 60
            );

            // Wait to ensure voting happens after proposal creation
            await ethers.provider.send("evm_increaseTime", [10]);
            await ethers.provider.send("evm_mine");

            // All three members should be able to vote
            await expect(templ.connect(member1).vote(0, true))
                .to.emit(templ, "VoteCast");
            
            await expect(templ.connect(member2).vote(0, true))
                .to.emit(templ, "VoteCast");
            
            await expect(templ.connect(member3).vote(0, false))
                .to.emit(templ, "VoteCast");

            // Check votes
            const proposal = await templ.getProposal(0);
            expect(proposal.yesVotes).to.equal(2);
            expect(proposal.noVotes).to.equal(1);
        });

        it("Should prevent members who joined after quorum from voting", async function () {
            // Initial members join (ensure no auto-quorum at creation)
            await token.connect(member1).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member1).purchaseAccess();
            await token.connect(member2).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member2).purchaseAccess();
            await token.connect(member3).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member3).purchaseAccess();
            await token.connect(member4).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member4).purchaseAccess();

            // Create proposal (4 members total; auto-yes alone won't meet quorum)
            await templ.connect(member1).createProposalWithdrawTreasury(
                token.target,
                member1.address,
                ethers.parseUnits("10", 18),
                "Test",
                7 * 24 * 60 * 60
            );

            // Reach quorum with pre-quorum members
            await templ.connect(member2).vote(0, true); // yesVotes = 2 of 4 (>=33%)

            // New member joins AFTER quorum is reached
            await token.connect(lateMember).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(lateMember).purchaseAccess();

            // Late member should NOT be able to vote after quorum
            await expect(templ.connect(lateMember).vote(0, true))
                .to.be.revertedWithCustomError(templ, "JoinedAfterProposal");

            // Pre-quorum members can still vote
            await expect(templ.connect(member3).vote(0, false)).to.emit(templ, "VoteCast");
        });

        it("Should allow members who joined earlier in the quorum block to vote", async function () {
            // Four members join to avoid auto-quorum at creation
            await token.connect(member1).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member1).purchaseAccess();
            await token.connect(member2).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member2).purchaseAccess();
            await token.connect(member3).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member3).purchaseAccess();
            await token.connect(member4).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member4).purchaseAccess();

            await templ.connect(member1).createProposalWithdrawTreasury(
                token.target,
                member1.address,
                ethers.parseUnits("10", 18),
                "Test",
                7 * 24 * 60 * 60
            );

            // Batch the quorum-reaching vote and the late join in the same block
            await token.connect(lateMember).approve(await templ.getAddress(), ENTRY_FEE);
            await ethers.provider.send("evm_setAutomine", [false]);

            const voteTxPromise = templ.connect(member2).vote(0, true);
            const joinTxPromise = templ.connect(lateMember).purchaseAccess();

            await ethers.provider.send("evm_mine");
            await ethers.provider.send("evm_setAutomine", [true]);

            const voteTx = await voteTxPromise;
            const joinTx = await joinTxPromise;
            await voteTx.wait();
            await joinTx.wait();

            // Late member joined in the quorum block -> allowed to vote post-quorum
            await expect(templ.connect(lateMember).vote(0, true)).to.emit(templ, "VoteCast");
        });

        it("Should block members who joined after proposal creation until quorum is reached", async function () {
            // 4 members join initially (avoid auto-quorum at creation)
            await token.connect(member1).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member1).purchaseAccess();
            await token.connect(member2).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member2).purchaseAccess();
            await token.connect(member3).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member3).purchaseAccess();
            await token.connect(member4).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member4).purchaseAccess();

            expect(await templ.getMemberCount()).to.equal(4);

            // Wait before creating proposal
            await ethers.provider.send("evm_increaseTime", [100]);
            await ethers.provider.send("evm_mine");

            // Create proposal - starts with 4 eligible voters
            await templ.connect(member1).createProposalSetPaused(
                true,
                7 * 24 * 60 * 60
            );

            // One more member joins after proposal creation
            await token.connect(lateMember).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(lateMember).purchaseAccess();

            // Late member cannot vote before quorum is reached
            await expect(templ.connect(lateMember).vote(0, true))
                .to.be.revertedWithCustomError(templ, "JoinedAfterProposal");

            // Pre-quorum members reach quorum
            await templ.connect(member2).vote(0, true);

            // Late member can vote after quorum since they joined before the quorum transaction
            await expect(templ.connect(lateMember).vote(0, false)).to.emit(templ, "VoteCast");

            const snapshots = await templ.getProposalSnapshots(0);
            expect(snapshots.eligibleVotersPreQuorum).to.equal(4n);
            expect(snapshots.eligibleVotersPostQuorum).to.equal(5n);
        });

        it("Should prevent gaming the system by adding members after quorum", async function () {
            // Start with just 2 members
            await token.connect(member1).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member1).purchaseAccess();
            
            await token.connect(member2).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member2).purchaseAccess();

            // Wait
            await ethers.provider.send("evm_increaseTime", [100]);
            await ethers.provider.send("evm_mine");

            // Create contentious proposal where member2 would vote no
            await templ.connect(member1).createProposalWithdrawTreasury(
                token.target,
                member1.address,
                ethers.parseUnits("50", 18),
                "Selfish withdrawal",
                7 * 24 * 60 * 60
            );

            // Reach quorum immediately with the two existing members
            await templ.connect(member1).vote(0, true);
            // yesVotes = 2 of 2 (auto-yes + member1), quorum reached; now add friendly members
            await token.connect(member3).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member3).purchaseAccess();
            await token.connect(member4).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member4).purchaseAccess();

            // New members cannot vote post-quorum
            await expect(templ.connect(member3).vote(0, true))
                .to.be.revertedWithCustomError(templ, "JoinedAfterProposal");
            await expect(templ.connect(member4).vote(0, true))
                .to.be.revertedWithCustomError(templ, "JoinedAfterProposal");

            // Member2 can still vote (pre-quorum)
            await templ.connect(member2).vote(0, false);

            // Result: 1 yes, 1 no - tie means proposal fails
            const proposal = await templ.getProposal(0);
            expect(proposal.yesVotes).to.equal(1);
            expect(proposal.noVotes).to.equal(1);

            // Fast forward to end
            await ethers.provider.send("evm_increaseTime", [7 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine");

            // Proposal should fail execution (not pass with yes <= no)
            await expect(templ.executeProposal(0))
                .to.be.revertedWithCustomError(templ, "ProposalNotPassed");
        });

        it("Should handle multiple proposals with changing membership correctly", async function () {
            // Initial 2 members
            await token.connect(member1).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member1).purchaseAccess();
            
            await token.connect(member2).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member2).purchaseAccess();

            // Wait
            await ethers.provider.send("evm_increaseTime", [100]);
            await ethers.provider.send("evm_mine");

            // First proposal - 2 eligible voters
            await templ.connect(member1).createProposal(
                "Proposal 1",
                "With 2 members",
                encodeSetPausedDAO(true),
                7 * 24 * 60 * 60
            );

            // Member 3 joins
            await token.connect(member3).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member3).purchaseAccess();

            // Wait for first proposal to end
            await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine");

            // Second proposal - 3 eligible voters
            await templ.connect(member2).createProposal(
                "Proposal 2",
                "With 3 members",
                encodeSetPausedDAO(false),
                7 * 24 * 60 * 60
            );

            // Member 4 joins
            await token.connect(member4).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member4).purchaseAccess();

            // Wait a bit
            await ethers.provider.send("evm_increaseTime", [100]);
            await ethers.provider.send("evm_mine");

            // For proposal 2: members 1, 2, 3 can vote, member 4 cannot
            await templ.connect(member1).vote(1, true);
            await templ.connect(member2).vote(1, true);
            await templ.connect(member3).vote(1, false);
            
            await expect(templ.connect(member4).vote(1, true))
                .to.be.revertedWithCustomError(templ, "JoinedAfterProposal");

            const proposal2 = await templ.getProposal(1);
            expect(proposal2.yesVotes).to.equal(2);
            expect(proposal2.noVotes).to.equal(1);
        });
    });

    describe("Edge Cases", function () {
        it("Should handle proposals created in the same block as membership", async function () {
            // Member 1 joins first
            await token.connect(member1).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member1).purchaseAccess();

            // In a real scenario, these would be in the same block, but we can't
            // perfectly simulate that in tests. The contract should handle it correctly
            // by using < instead of <= for timestamp comparison
            
            await token.connect(member2).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member2).purchaseAccess();
            
            // Create proposal immediately
            await templ.connect(member1).createProposal(
                "Quick Proposal",
                "Same block test",
                encodeSetPausedDAO(true),
                7 * 24 * 60 * 60
            );

            // member2 joined before the proposal, so should be able to vote
            await ethers.provider.send("evm_increaseTime", [100]);
            await ethers.provider.send("evm_mine");
            
            await expect(templ.connect(member2).vote(0, true))
                .to.emit(templ, "VoteCast");
        });
    });
});
