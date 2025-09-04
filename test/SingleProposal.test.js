const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");

describe("Single Active Proposal Restriction", function () {
    let templ;
    let token;
    let owner, priest, member1, member2, member3;
    let accounts;
    const ENTRY_FEE = ethers.parseUnits("100", 18);
    const TOKEN_SUPPLY = ethers.parseUnits("10000", 18);

    beforeEach(async function () {
        ({ templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE }));
        [owner, priest, member1, member2, member3] = accounts;

        await token.mint(member1.address, TOKEN_SUPPLY);
        await token.mint(member2.address, TOKEN_SUPPLY);
        await token.mint(member3.address, TOKEN_SUPPLY);

        await token.connect(member1).approve(await templ.getAddress(), ENTRY_FEE);
        await templ.connect(member1).purchaseAccess();

        await token.connect(member2).approve(await templ.getAddress(), ENTRY_FEE);
        await templ.connect(member2).purchaseAccess();

        await token.connect(member3).approve(await templ.getAddress(), ENTRY_FEE);
        await templ.connect(member3).purchaseAccess();
    });

    describe("Single Proposal Per Account", function () {
        it("Should allow a member to create their first proposal", async function () {
            const iface = new ethers.Interface([
                "function withdrawTreasuryDAO(address,uint256,string)"
            ]);
            const callData = iface.encodeFunctionData("withdrawTreasuryDAO", [
                member1.address,
                ethers.parseUnits("10", 18),
                "Test withdrawal"
            ]);

            await expect(templ.connect(member1).createProposal(
                "First Proposal",
                "Testing single proposal restriction",
                callData,
                7 * 24 * 60 * 60
            )).to.emit(templ, "ProposalCreated");

            expect(await templ.hasActiveProposal(member1.address)).to.be.true;
            expect(await templ.activeProposalId(member1.address)).to.equal(0);
        });

        it("Should prevent creating a second proposal while one is active", async function () {
            const iface2 = new ethers.Interface([
                "function withdrawTreasuryDAO(address,uint256,string)"
            ]);
            const callData = iface2.encodeFunctionData("withdrawTreasuryDAO", [
                member1.address,
                ethers.parseUnits("10", 18),
                "Test"
            ]);

            // Create first proposal
            await templ.connect(member1).createProposal(
                "First Proposal",
                "Description 1",
                callData,
                7 * 24 * 60 * 60
            );

            // Try to create second proposal - should fail
            await expect(templ.connect(member1).createProposal(
                "Second Proposal",
                "Description 2",
                callData,
                7 * 24 * 60 * 60
            )).to.be.revertedWithCustomError(templ, "ActiveProposalExists");
        });

        it("Should allow different members to have active proposals simultaneously", async function () {
            const iface = new ethers.Interface([
                "function withdrawTreasuryDAO(address,uint256,string)"
            ]);
            const callData = iface.encodeFunctionData("withdrawTreasuryDAO", [
                member1.address,
                ethers.parseUnits("10", 18),
                "Test"
            ]);

            // Member 1 creates proposal
            await templ.connect(member1).createProposal(
                "Member 1 Proposal",
                "Description",
                callData,
                7 * 24 * 60 * 60
            );

            // Member 2 creates proposal - should succeed
            await templ.connect(member2).createProposal(
                "Member 2 Proposal",
                "Description",
                callData,
                7 * 24 * 60 * 60
            );

            // Member 3 creates proposal - should succeed
            await templ.connect(member3).createProposal(
                "Member 3 Proposal",
                "Description",
                callData,
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
            const iface = new ethers.Interface([
                "function setPausedDAO(bool)"
            ]);
            const callData1 = iface.encodeFunctionData("setPausedDAO", [true]);
            const callData2 = iface.encodeFunctionData("setPausedDAO", [false]);

            // Create and execute first proposal
            await templ.connect(member1).createProposal(
                "First Proposal",
                "Pause contract",
                callData1,
                7 * 24 * 60 * 60 // 7 days
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

            // Now member1 should be able to create a new proposal
            await expect(templ.connect(member1).createProposal(
                "Second Proposal",
                "Unpause contract",
                callData2,
                7 * 24 * 60 * 60
            )).to.emit(templ, "ProposalCreated");

            expect(await templ.hasActiveProposal(member1.address)).to.be.true;
            expect(await templ.activeProposalId(member1.address)).to.equal(1);
        });

        it("Should allow creating new proposal after previous one expires without execution", async function () {
            const iface = new ethers.Interface([
                "function withdrawTreasuryDAO(address,uint256,string)"
            ]);
            const callData = iface.encodeFunctionData("withdrawTreasuryDAO", [
                member1.address,
                ethers.parseUnits("10", 18),
                "Test"
            ]);

            // Create first proposal
            await templ.connect(member1).createProposal(
                "First Proposal",
                "Will expire",
                callData,
                7 * 24 * 60 * 60 // 7 days
            );

            // Don't vote, let it expire
            await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine");

            // Try to create second proposal - should succeed because first one expired
            await expect(templ.connect(member1).createProposal(
                "Second Proposal",
                "After expiry",
                callData,
                7 * 24 * 60 * 60
            )).to.emit(templ, "ProposalCreated");

            expect(await templ.hasActiveProposal(member1.address)).to.be.true;
            expect(await templ.activeProposalId(member1.address)).to.equal(1);
        });

        it("Should allow creating new proposal if previous one failed to pass", async function () {
            const iface = new ethers.Interface([
                "function withdrawTreasuryDAO(address,uint256,string)"
            ]);
            const callData = iface.encodeFunctionData("withdrawTreasuryDAO", [
                member1.address,
                ethers.parseUnits("10", 18),
                "Test"
            ]);

            // Create first proposal
            await templ.connect(member1).createProposal(
                "First Proposal",
                "Will fail",
                callData,
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
            const iface = new ethers.Interface([
                "function withdrawTreasuryDAO(address,uint256,string)"
            ]);
            const tooMuch = (await templ.treasuryBalance()) + 1n;
            const badCallData = iface.encodeFunctionData("withdrawTreasuryDAO", [
                member1.address,
                tooMuch,
                "Too much"
            ]);

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

            // Now let the proposal expire
            await ethers.provider.send("evm_increaseTime", [7 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine");

            // Now should be able to create another proposal since the first expired
            const iface2 = new ethers.Interface([
                "function withdrawTreasuryDAO(address,uint256,string)"
            ]);
            const callData = iface2.encodeFunctionData("withdrawTreasuryDAO", [
                member1.address,
                ethers.parseUnits("10", 18),
                "Test"
            ]);

            await expect(templ.connect(member1).createProposal(
                "Another Proposal",
                "After expiry",
                callData,
                7 * 24 * 60 * 60
            )).to.emit(templ, "ProposalCreated");
        });
    });

    describe("Edge Cases", function () {
        it("Should handle proposal ID 0 correctly", async function () {
            const iface = new ethers.Interface([
                "function setPausedDAO(bool)"
            ]);
            const callData = iface.encodeFunctionData("setPausedDAO", [true]);

            // First proposal gets ID 0
            await templ.connect(member1).createProposal(
                "Proposal Zero",
                "First proposal",
                callData,
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
            const iface = new ethers.Interface([
                "function setPausedDAO(bool)"
            ]);

            // Cycle 1: Create, pass, execute
            await templ.connect(member1).createProposal(
                "Cycle 1",
                "First cycle",
                iface.encodeFunctionData("setPausedDAO", [true]),
                7 * 24 * 60 * 60
            );
            
            await templ.connect(member1).vote(0, true);
            await templ.connect(member2).vote(0, true);
            await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine");
            await templ.executeProposal(0);

            // Cycle 2: Create, let expire
            await templ.connect(member1).createProposal(
                "Cycle 2",
                "Second cycle",
                iface.encodeFunctionData("setPausedDAO", [false]),
                7 * 24 * 60 * 60
            );
            
            await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine");

            // Cycle 3: Create new one after expiry
            await templ.connect(member1).createProposal(
                "Cycle 3",
                "Third cycle",
                iface.encodeFunctionData("setPausedDAO", [true]),
                7 * 24 * 60 * 60
            );

            expect(await templ.hasActiveProposal(member1.address)).to.be.true;
            expect(await templ.activeProposalId(member1.address)).to.equal(2);
        });
    });
});
