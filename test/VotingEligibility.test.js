const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Voting Eligibility Based on Join Time", function () {
    let templ;
    let token;
    let owner, priest, member1, member2, member3, member4, lateMember;
    const ENTRY_FEE = ethers.parseUnits("100", 18);
    const TOKEN_SUPPLY = ethers.parseUnits("10000", 18);

    beforeEach(async function () {
        [owner, priest, member1, member2, member3, member4, lateMember] = await ethers.getSigners();

        // Deploy test token
        const Token = await ethers.getContractFactory("TestToken");
        token = await Token.deploy("Test Token", "TEST", 18);
        await token.waitForDeployment();

        // Deploy TEMPL contract
        const TEMPL = await ethers.getContractFactory("TEMPL");
        templ = await TEMPL.deploy(
            priest.address,
            priest.address, // protocolFeeRecipient (same as priest for testing)
            await token.getAddress(),
            ENTRY_FEE,
            10, // priestVoteWeight
            10  // priestWeightThreshold
        );
        await templ.waitForDeployment();

        // Mint tokens to all potential members
        await token.mint(member1.address, TOKEN_SUPPLY);
        await token.mint(member2.address, TOKEN_SUPPLY);
        await token.mint(member3.address, TOKEN_SUPPLY);
        await token.mint(member4.address, TOKEN_SUPPLY);
        await token.mint(lateMember.address, TOKEN_SUPPLY);
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
            const iface = new ethers.Interface([
                "function withdrawTreasuryDAO(address,uint256,string)"
            ]);
            const callData = iface.encodeFunctionData("withdrawTreasuryDAO", [
                member1.address,
                ethers.parseUnits("10", 18),
                "Test"
            ]);

            await templ.connect(member1).createProposal(
                "Test Proposal",
                "Testing voting eligibility",
                callData,
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

        it("Should prevent members who joined after proposal from voting", async function () {
            // Initial members join
            await token.connect(member1).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member1).purchaseAccess();
            
            await token.connect(member2).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member2).purchaseAccess();

            // Wait to ensure clear timestamp
            await ethers.provider.send("evm_increaseTime", [100]);
            await ethers.provider.send("evm_mine");

            // Create proposal
            const iface = new ethers.Interface([
                "function withdrawTreasuryDAO(address,uint256,string)"
            ]);
            const callData = iface.encodeFunctionData("withdrawTreasuryDAO", [
                member1.address,
                ethers.parseUnits("10", 18),
                "Test"
            ]);

            await templ.connect(member1).createProposal(
                "Early Proposal",
                "Only early members can vote",
                callData,
                7 * 24 * 60 * 60
            );

            // Wait a bit
            await ethers.provider.send("evm_increaseTime", [100]);
            await ethers.provider.send("evm_mine");

            // New member joins AFTER proposal was created
            await token.connect(lateMember).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(lateMember).purchaseAccess();

            // Late member should NOT be able to vote
            await expect(templ.connect(lateMember).vote(0, true))
                .to.be.revertedWith("You joined after this proposal was created");

            // But original members still can
            await expect(templ.connect(member1).vote(0, true))
                .to.emit(templ, "VoteCast");
            
            await expect(templ.connect(member2).vote(0, false))
                .to.emit(templ, "VoteCast");
        });

        it("Should track eligible voters correctly", async function () {
            // 3 members join initially
            await token.connect(member1).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member1).purchaseAccess();
            
            await token.connect(member2).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member2).purchaseAccess();
            
            await token.connect(member3).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member3).purchaseAccess();

            expect(await templ.getMemberCount()).to.equal(3);

            // Wait before creating proposal
            await ethers.provider.send("evm_increaseTime", [100]);
            await ethers.provider.send("evm_mine");

            // Create proposal - should have 3 eligible voters
            const iface = new ethers.Interface([
                "function setPausedDAO(bool)"
            ]);
            const callData = iface.encodeFunctionData("setPausedDAO", [true]);

            await templ.connect(member1).createProposal(
                "Pause Proposal",
                "Test eligible voters",
                callData,
                7 * 24 * 60 * 60
            );

            // Now more members join AFTER proposal
            await token.connect(member4).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member4).purchaseAccess();
            
            await token.connect(lateMember).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(lateMember).purchaseAccess();

            // Total members is now 5
            expect(await templ.getMemberCount()).to.equal(5);

            // But only the original 3 can vote
            await ethers.provider.send("evm_increaseTime", [10]);
            await ethers.provider.send("evm_mine");

            // Original members vote
            await templ.connect(member1).vote(0, true);
            await templ.connect(member2).vote(0, true);
            await templ.connect(member3).vote(0, false);

            // New members cannot vote
            await expect(templ.connect(member4).vote(0, true))
                .to.be.revertedWith("You joined after this proposal was created");
            
            await expect(templ.connect(lateMember).vote(0, true))
                .to.be.revertedWith("You joined after this proposal was created");

            // Check final vote tally - should be 2 yes, 1 no (from 3 eligible voters)
            const proposal = await templ.getProposal(0);
            expect(proposal.yesVotes).to.equal(2);
            expect(proposal.noVotes).to.equal(1);
        });

        it("Should prevent gaming the system by adding members after proposal", async function () {
            // Start with just 2 members
            await token.connect(member1).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member1).purchaseAccess();
            
            await token.connect(member2).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member2).purchaseAccess();

            // Wait
            await ethers.provider.send("evm_increaseTime", [100]);
            await ethers.provider.send("evm_mine");

            // Create contentious proposal where member2 would vote no
            const iface = new ethers.Interface([
                "function withdrawTreasuryDAO(address,uint256,string)"
            ]);
            const callData = iface.encodeFunctionData("withdrawTreasuryDAO", [
                member1.address, // Only benefits member1
                ethers.parseUnits("50", 18),
                "Selfish withdrawal"
            ]);

            await templ.connect(member1).createProposal(
                "Contentious Proposal",
                "Member1 wants treasury funds",
                callData,
                7 * 24 * 60 * 60
            );

            // Member1 tries to game by adding friendly members AFTER proposal
            await token.connect(member3).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member3).purchaseAccess();
            
            await token.connect(member4).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member4).purchaseAccess();

            // Wait for voting
            await ethers.provider.send("evm_increaseTime", [100]);
            await ethers.provider.send("evm_mine");

            // Original members vote
            await templ.connect(member1).vote(0, true);
            await templ.connect(member2).vote(0, false);

            // New "friendly" members CANNOT vote to help member1
            await expect(templ.connect(member3).vote(0, true))
                .to.be.revertedWith("You joined after this proposal was created");
            
            await expect(templ.connect(member4).vote(0, true))
                .to.be.revertedWith("You joined after this proposal was created");

            // Result: 1 yes, 1 no - tie means proposal fails
            const proposal = await templ.getProposal(0);
            expect(proposal.yesVotes).to.equal(1);
            expect(proposal.noVotes).to.equal(1);

            // Fast forward to end
            await ethers.provider.send("evm_increaseTime", [7 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine");

            // Proposal should fail execution (not pass with yes <= no)
            await expect(templ.executeProposal(0))
                .to.be.revertedWith("Proposal did not pass");
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
            const iface = new ethers.Interface([
                "function setPausedDAO(bool)"
            ]);
            
            await templ.connect(member1).createProposal(
                "Proposal 1",
                "With 2 members",
                iface.encodeFunctionData("setPausedDAO", [true]),
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
                iface.encodeFunctionData("setPausedDAO", [false]),
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
                .to.be.revertedWith("You joined after this proposal was created");

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
            const iface = new ethers.Interface([
                "function setPausedDAO(bool)"
            ]);
            
            await templ.connect(member1).createProposal(
                "Quick Proposal",
                "Same block test",
                iface.encodeFunctionData("setPausedDAO", [true]),
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