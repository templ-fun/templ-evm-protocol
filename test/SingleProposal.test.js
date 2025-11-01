const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, joinMembers } = require("./utils/mintAndPurchase");
const { encodeWithdrawTreasuryDAO, encodeSetJoinPausedDAO } = require("./utils/callDataBuilders");

describe("Single Active Proposal Restriction", function () {
    let templ;
    let token;
    let owner, priest, member1, member2, member3;
    let accounts;
    const ENTRY_FEE = ethers.parseUnits("100", 18);
    const TOKEN_SUPPLY = ethers.parseUnits("10000", 18);
    const META = ["Test proposal", "Ensures single active proposal restrictions"];

    beforeEach(async function () {
        ({ templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE }));
        [owner, priest, member1, member2, member3] = accounts;

        await mintToUsers(token, [member1, member2, member3], TOKEN_SUPPLY);

        await joinMembers(templ, token, [member1, member2, member3]);
    });

    describe("Single Proposal Per Account", function () {
        it("Should allow a member to create their first proposal", async function () {
            const callData = encodeWithdrawTreasuryDAO(
                token.target,
                member1.address,
                ethers.parseUnits("10", 18)
            );

            await expect(templ.connect(member1).createProposalWithdrawTreasury(
                token.target,
                member1.address,
                ethers.parseUnits("10", 18),
                7 * 24 * 60 * 60,
                ...META
            )).to.emit(templ, "ProposalCreated");

            expect(await templ.hasActiveProposal(member1.address)).to.be.true;
            expect(await templ.activeProposalId(member1.address)).to.equal(0);
        });

        it("Should prevent creating a second proposal while one is active", async function () {
            const callData = encodeWithdrawTreasuryDAO(
                token.target,
                member1.address,
                ethers.parseUnits("10", 18)
            );

            // Create first proposal
            await templ.connect(member1).createProposalWithdrawTreasury(
                token.target,
                member1.address,
                ethers.parseUnits("10", 18),
                7 * 24 * 60 * 60,
                ...META
            );

            // Try to create second proposal - should fail
            await expect(templ.connect(member1).createProposalWithdrawTreasury(
                token.target,
                member1.address,
                ethers.parseUnits("10", 18),
                7 * 24 * 60 * 60,
                ...META
            )).to.be.revertedWithCustomError(templ, "ActiveProposalExists");
        });

        it("Should allow different members to have active proposals simultaneously", async function () {
            const callData = encodeWithdrawTreasuryDAO(
                token.target,
                member1.address,
                ethers.parseUnits("10", 18)
            );

            // Member 1 creates proposal
            await templ.connect(member1).createProposalWithdrawTreasury(
                token.target,
                member1.address,
                ethers.parseUnits("10", 18),
                7 * 24 * 60 * 60
            );

            // Member 2 creates proposal - should succeed
            await templ.connect(member2).createProposalWithdrawTreasury(
                token.target,
                member1.address,
                ethers.parseUnits("10", 18),
                7 * 24 * 60 * 60
            );

            // Member 3 creates proposal - should succeed
            await templ.connect(member3).createProposalWithdrawTreasury(
                token.target,
                member1.address,
                ethers.parseUnits("10", 18),
                7 * 24 * 60 * 60
            );

            expect(await templ.hasActiveProposal(member1.address)).to.be.true;
            expect(await templ.hasActiveProposal(member2.address)).to.be.true;
            expect(await templ.hasActiveProposal(member3.address)).to.be.true;
            
            expect(await templ.activeProposalId(member1.address)).to.equal(0);
            expect(await templ.activeProposalId(member2.address)).to.equal(1);
            expect(await templ.activeProposalId(member3.address)).to.equal(2);
        });

        it("Should allow creating new proposal after previous one is executed", async function () {
            const callData1 = encodeSetJoinPausedDAO(true);
            const callData2 = encodeSetJoinPausedDAO(false);

            // Create and execute first proposal
            await templ.connect(member1).createProposalSetJoinPaused(
                true,
                7 * 24 * 60 * 60
            );

            // Vote to pass
            await templ.connect(member1).vote(0, true);
            await templ.connect(member2).vote(0, true);

            // Fast forward and execute
            await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine");

            await templ.executeProposal(0);

            // Check that active proposal is cleared
            expect(await templ.hasActiveProposal(member1.address)).to.be.false;
            expect(await templ.activeProposalId(member1.address)).to.equal(0);

            // At this point member1 can create a new proposal
            await expect(templ.connect(member1).createProposalSetJoinPaused(
                false,
                7 * 24 * 60 * 60
            )).to.emit(templ, "ProposalCreated");

            expect(await templ.hasActiveProposal(member1.address)).to.be.true;
            expect(await templ.activeProposalId(member1.address)).to.equal(1);
        });

        it("Should allow creating new proposal after previous one expires without execution", async function () {
            const callData = encodeWithdrawTreasuryDAO(
                token.target,
                member1.address,
                ethers.parseUnits("10", 18)
            );

            // Create first proposal
            await templ.connect(member1).createProposalWithdrawTreasury(
                token.target,
                member1.address,
                ethers.parseUnits("10", 18),
                7 * 24 * 60 * 60 // 7 days
            );

            // Don't vote, let it expire
            await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine");

            // Try to create second proposal - should succeed because first one expired
            await expect(templ.connect(member1).createProposalWithdrawTreasury(
                token.target,
                member1.address,
                ethers.parseUnits("10", 18),
                7 * 24 * 60 * 60
            )).to.emit(templ, "ProposalCreated");

            expect(await templ.hasActiveProposal(member1.address)).to.be.true;
            expect(await templ.activeProposalId(member1.address)).to.equal(1);
        });

        it("Should allow creating new proposal if previous one failed to pass", async function () {
            const callData = encodeWithdrawTreasuryDAO(
                token.target,
                member1.address,
                ethers.parseUnits("10", 18)
            );

            // Create first proposal
            await templ.connect(member1).createProposalWithdrawTreasury(
                token.target,
                member1.address,
                ethers.parseUnits("10", 18),
                7 * 24 * 60 * 60
            );

            // Vote no to make it fail
            await templ.connect(member1).vote(0, false);
            await templ.connect(member2).vote(0, false);
            await templ.connect(member3).vote(0, false);

            // Fast forward past voting period
            await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine");

            // Proposal failed, should be able to create new one
            await expect(templ.connect(member1).createProposal(
                "Second Proposal",
                "After failed proposal",
                callData,
                7 * 24 * 60 * 60
            )).to.emit(templ, "ProposalCreated");

            expect(await templ.hasActiveProposal(member1.address)).to.be.true;
            expect(await templ.activeProposalId(member1.address)).to.equal(1);
        });

        it("Should properly handle failed execution and maintain active status", async function () {
            // Create proposal with valid selector but invalid params to trigger revert at execution
            const tooMuch = (await templ.treasuryBalance()) + 1n;
            const badCallData = encodeWithdrawTreasuryDAO(
                token.target,
                member1.address,
                tooMuch
            );

            await templ.connect(member1).createProposal(
                "Bad Proposal",
                "Will fail execution",
                badCallData,
                7 * 24 * 60 * 60
            );

            // Need to wait a bit to ensure voting timestamps are after proposal creation
            await ethers.provider.send("evm_increaseTime", [10]);
            await ethers.provider.send("evm_mine");

            // Vote to pass
            await templ.connect(member1).vote(0, true);
            await templ.connect(member2).vote(0, true);

            // Fast forward
            await ethers.provider.send("evm_increaseTime", [7 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine");

            // Try to execute - should fail and keep proposal active
            await expect(templ.executeProposal(0))
                .to.be.revertedWithCustomError(templ, "InsufficientTreasuryBalance");

            // Check that proposal is still marked as active since execution failed
            expect(await templ.hasActiveProposal(member1.address)).to.be.true;
            expect(await templ.activeProposalId(member1.address)).to.equal(0);

            // Get proposal to check it's not executed
            const proposal = await templ.getProposal(0);
            expect(proposal.executed).to.be.false;

            // Allow the proposal to expire
            await ethers.provider.send("evm_increaseTime", [7 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine");

            // Member1 can create another proposal because the first one expired
            await expect(templ.connect(member1).createProposalWithdrawTreasury(
                token.target,
                member1.address,
                ethers.parseUnits("10", 18),
                7 * 24 * 60 * 60
            )).to.emit(templ, "ProposalCreated");
        });
    });

    describe("Edge Cases", function () {
        it("Should handle proposal ID 0 correctly", async function () {
            const callData = encodeSetJoinPausedDAO(true);

            // First proposal gets ID 0
            await templ.connect(member1).createProposalSetJoinPaused(
                true,
                7 * 24 * 60 * 60
            );

            expect(await templ.hasActiveProposal(member1.address)).to.be.true;
            expect(await templ.activeProposalId(member1.address)).to.equal(0);

            // Execute it
            await templ.connect(member1).vote(0, true);
            await templ.connect(member2).vote(0, true);
            
            await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine");
            
            await templ.executeProposal(0);

            // Should be cleared
            expect(await templ.hasActiveProposal(member1.address)).to.be.false;
            // Note: activeProposalId returns 0 when no active proposal, which is why we need hasActiveProposal flag
            expect(await templ.activeProposalId(member1.address)).to.equal(0);
        });

        it("Should track active proposals correctly across multiple cycles", async function () {

            // Cycle 1: Create, pass, execute
            await templ.connect(member1).createProposalSetJoinPaused(
                true,
                7 * 24 * 60 * 60
            );
            
            await templ.connect(member1).vote(0, true);
            await templ.connect(member2).vote(0, true);
            await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine");
            await templ.executeProposal(0);

            // Cycle 2: Create, let expire
            await templ.connect(member1).createProposalSetJoinPaused(
                false,
                7 * 24 * 60 * 60
            );
            
            await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine");

            // Cycle 3: Create new one after expiry
            await templ.connect(member1).createProposalSetJoinPaused(
                true,
                7 * 24 * 60 * 60
            );

            expect(await templ.hasActiveProposal(member1.address)).to.be.true;
            expect(await templ.activeProposalId(member1.address)).to.equal(2);
        });
    });
});
