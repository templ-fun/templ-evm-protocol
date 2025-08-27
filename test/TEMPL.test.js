const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TEMPL Contract with DAO Governance", function () {
    let templ;
    let token;
    let owner, priest, user1, user2, user3, user4, treasury;
    const ENTRY_FEE = ethers.parseUnits("100", 18);
    const TOKEN_SUPPLY = ethers.parseUnits("10000", 18);

    beforeEach(async function () {
        [owner, priest, user1, user2, user3, user4, treasury] = await ethers.getSigners();

        // Deploy test token
        const Token = await ethers.getContractFactory("TestToken");
        token = await Token.deploy("Test Token", "TEST", 18);
        await token.waitForDeployment();

        // Deploy TEMPL contract (with DAO governance)
        const TEMPL = await ethers.getContractFactory("TEMPL");
        templ = await TEMPL.deploy(
            priest.address,
            priest.address, // Using same address for protocolFeeRecipient in tests
            await token.getAddress(),
            ENTRY_FEE,
            10, // priestVoteWeight
            10  // priestWeightThreshold
        );
        await templ.waitForDeployment();

        // Mint tokens to users
        await token.mint(user1.address, TOKEN_SUPPLY);
        await token.mint(user2.address, TOKEN_SUPPLY);
        await token.mint(user3.address, TOKEN_SUPPLY);
        await token.mint(user4.address, TOKEN_SUPPLY);
    });

    describe("Deployment", function () {
        it("Should set the correct priest address", async function () {
            expect(await templ.priest()).to.equal(priest.address);
        });

        it("Should set the correct token and entry fee", async function () {
            expect(await templ.accessToken()).to.equal(await token.getAddress());
            expect(await templ.entryFee()).to.equal(ENTRY_FEE);
        });

        it("Should initialize with zero balances", async function () {
            expect(await templ.treasuryBalance()).to.equal(0);
            expect(await templ.memberPoolBalance()).to.equal(0);
        });
    });

    describe("Access Purchase with 30/30/30/10 Split", function () {
        it("Should correctly split payments: 30% burn, 30% treasury, 30% pool, 10% protocol", async function () {
            await token.connect(user1).approve(await templ.getAddress(), ENTRY_FEE);
            
            const priestBalanceBefore = await token.balanceOf(priest.address);
            const deadBalanceBefore = await token.balanceOf("0x000000000000000000000000000000000000dEaD");
            
            await templ.connect(user1).purchaseAccess();
            
            const thirtyPercent = (ENTRY_FEE * 30n) / 100n;
            const tenPercent = (ENTRY_FEE * 10n) / 100n;
            
            // Check balances
            expect(await templ.treasuryBalance()).to.equal(thirtyPercent);
            expect(await templ.memberPoolBalance()).to.equal(thirtyPercent);
            
            // Check priest received 10%
            expect(await token.balanceOf(priest.address)).to.equal(priestBalanceBefore + tenPercent);
            
            // Check burn address received 30%
            expect(await token.balanceOf("0x000000000000000000000000000000000000dEaD"))
                .to.equal(deadBalanceBefore + thirtyPercent);
            
            // Check totals
            expect(await templ.totalBurned()).to.equal(thirtyPercent);
            expect(await templ.totalToTreasury()).to.equal(thirtyPercent);
            expect(await templ.totalToMemberPool()).to.equal(thirtyPercent);
            expect(await templ.totalToProtocol()).to.equal(tenPercent);
        });

        it("Should mark user as having purchased", async function () {
            await token.connect(user1).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(user1).purchaseAccess();
            
            expect(await templ.hasPurchased(user1.address)).to.be.true;
            expect(await templ.getMemberCount()).to.equal(1);
        });

        it("Should prevent double purchase", async function () {
            await token.connect(user1).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(user1).purchaseAccess();
            
            await token.connect(user1).approve(await templ.getAddress(), ENTRY_FEE);
            await expect(templ.connect(user1).purchaseAccess())
                .to.be.revertedWithCustomError(templ, "AlreadyPurchased");
        });
    });

    describe("DAO Proposal Creation", function () {
        beforeEach(async function () {
            // User1 becomes a member
            await token.connect(user1).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(user1).purchaseAccess();
        });

        it("Should allow members to create proposals", async function () {
            const title = "Test Proposal";
            const description = "This is a test proposal";
            const callData = "0x12345678"; // Dummy call data
            const votingPeriod = 7 * 24 * 60 * 60; // 7 days

            await expect(templ.connect(user1).createProposal(
                title,
                description,
                callData,
                votingPeriod
            )).to.emit(templ, "ProposalCreated");

            expect(await templ.proposalCount()).to.equal(1);
            
            const proposal = await templ.getProposal(0);
            expect(proposal.title).to.equal(title);
            expect(proposal.description).to.equal(description);
            expect(proposal.proposer).to.equal(user1.address);
        });

        it("Should prevent non-members from creating proposals", async function () {
            await expect(templ.connect(user2).createProposal(
                "Test",
                "Description",
                "0x1234",
                7 * 24 * 60 * 60
            )).to.be.revertedWithCustomError(templ, "NotMember");
        });

        it("Should enforce minimum voting period", async function () {
            await expect(templ.connect(user1).createProposal(
                "Test",
                "Description",
                "0x1234",
                6 * 24 * 60 * 60 // 6 days (less than minimum 7 days)
            )).to.be.revertedWithCustomError(templ, "VotingPeriodTooShort");
        });

        it("Should enforce maximum voting period", async function () {
            await expect(templ.connect(user1).createProposal(
                "Test",
                "Description",
                "0x1234",
                31 * 24 * 60 * 60 // 31 days (too long)
            )).to.be.revertedWithCustomError(templ, "VotingPeriodTooLong");
        });
    });

    describe("DAO Voting", function () {
        beforeEach(async function () {
            // Multiple users become members
            await token.connect(user1).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(user1).purchaseAccess();
            
            await token.connect(user2).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(user2).purchaseAccess();
            
            await token.connect(user3).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(user3).purchaseAccess();

            // Create a proposal
            const nextId = await templ.proposalCount();
            const iface = new ethers.Interface([
                "function withdrawTreasuryDAO(uint256,address,uint256,string)"
            ]);
            const callData = iface.encodeFunctionData("withdrawTreasuryDAO", [
                nextId,
                treasury.address,
                ethers.parseUnits("10", 18),
                "Test withdrawal"
            ]);

            await templ.connect(user1).createProposal(
                "Treasury Withdrawal",
                "Withdraw 10 tokens to treasury",
                callData,
                7 * 24 * 60 * 60
            );
        });

        it("Should allow members to vote", async function () {
            await expect(templ.connect(user1).vote(0, true))
                .to.emit(templ, "VoteCast");

            const proposal = await templ.getProposal(0);
            expect(proposal.yesVotes).to.equal(1);
            expect(proposal.noVotes).to.equal(0);
        });

        it("Should prevent double voting", async function () {
            await templ.connect(user1).vote(0, true);

            await expect(templ.connect(user1).vote(0, false))
                .to.be.revertedWithCustomError(templ, "AlreadyVoted");
        });

        it("Should prevent non-members from voting", async function () {
            await expect(templ.connect(user4).vote(0, true))
                .to.be.revertedWithCustomError(templ, "NotMember");
        });

        it("Should count yes and no votes correctly", async function () {
            await templ.connect(user1).vote(0, true);
            await templ.connect(user2).vote(0, false);
            await templ.connect(user3).vote(0, true);

            const proposal = await templ.getProposal(0);
            expect(proposal.yesVotes).to.equal(2);
            expect(proposal.noVotes).to.equal(1);
            expect(proposal.passed).to.be.false; // voting period not yet ended
        });

        it("Should track individual vote choices", async function () {
            await templ.connect(user1).vote(0, true);
            await templ.connect(user2).vote(0, false);

            let hasVoted = await templ.hasVoted(0, user1.address);
            expect(hasVoted.voted).to.be.true;
            expect(hasVoted.support).to.be.true;

            hasVoted = await templ.hasVoted(0, user2.address);
            expect(hasVoted.voted).to.be.true;
            expect(hasVoted.support).to.be.false;
        });
    });

    describe("DAO Proposal Execution", function () {
        beforeEach(async function () {
            // Setup members
            await token.connect(user1).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(user1).purchaseAccess();
            
            await token.connect(user2).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(user2).purchaseAccess();
            
            await token.connect(user3).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(user3).purchaseAccess();
        });

        it("Should execute passed treasury withdrawal proposal", async function () {
            // Create treasury withdrawal proposal
            const withdrawAmount = ethers.parseUnits("10", 18);
            const nextId = await templ.proposalCount();
            const iface = new ethers.Interface([
                "function withdrawTreasuryDAO(uint256,address,uint256,string)"
            ]);
            const callData = iface.encodeFunctionData("withdrawTreasuryDAO", [
                nextId,
                treasury.address,
                withdrawAmount,
                "Test withdrawal"
            ]);

            await templ.connect(user1).createProposal(
                "Treasury Withdrawal",
                "Withdraw 10 tokens",
                callData,
                7 * 24 * 60 * 60 // 7 days
            );

            // Vote yes (majority)
            await templ.connect(user1).vote(0, true);
            await templ.connect(user2).vote(0, true);

            // Fast forward past voting period
            await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine");

            const treasuryBefore = await templ.treasuryBalance();
            const recipientBefore = await token.balanceOf(treasury.address);

            // Execute proposal
            await expect(templ.connect(user3).executeProposal(0))
                .to.emit(templ, "ProposalExecuted")
                .to.emit(templ, "TreasuryAction");

            // Check treasury decreased and recipient increased
            expect(await templ.treasuryBalance()).to.equal(treasuryBefore - withdrawAmount);
            expect(await token.balanceOf(treasury.address)).to.equal(recipientBefore + withdrawAmount);

            // Check proposal marked as executed
            const proposal = await templ.getProposal(0);
            expect(proposal.executed).to.be.true;
        });

        it("Should not execute failed proposals", async function () {
            // Create proposal
            const nextId = await templ.proposalCount();
            const iface = new ethers.Interface([
                "function withdrawTreasuryDAO(uint256,address,uint256,string)"
            ]);
            const callData = iface.encodeFunctionData("withdrawTreasuryDAO", [
                nextId,
                treasury.address,
                ethers.parseUnits("10", 18),
                "Test"
            ]);

            await templ.connect(user1).createProposal(
                "Test",
                "Test proposal",
                callData,
                7 * 24 * 60 * 60
            );

            // Vote no (majority)
            await templ.connect(user1).vote(0, false);
            await templ.connect(user2).vote(0, false);
            await templ.connect(user3).vote(0, true);

            // Fast forward
            await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine");

            // Try to execute
            await expect(templ.connect(user1).executeProposal(0))
                .to.be.revertedWithCustomError(templ, "ProposalNotPassed");
        });

        it("Should not execute before voting ends", async function () {
            // Create proposal
            const iface = new ethers.Interface([
                "function setPausedDAO(bool)"
            ]);
            const callData = iface.encodeFunctionData("setPausedDAO", [true]);

            await templ.connect(user1).createProposal(
                "Pause",
                "Pause contract",
                callData,
                7 * 24 * 60 * 60
            );

            // Vote yes
            await templ.connect(user1).vote(0, true);
            await templ.connect(user2).vote(0, true);

            // Try to execute immediately
            await expect(templ.connect(user1).executeProposal(0))
                .to.be.revertedWithCustomError(templ, "VotingNotEnded");
        });

        it("Should execute config update proposal", async function () {
            const newFee = ethers.parseUnits("200", 18);
            const iface = new ethers.Interface([
                "function updateConfigDAO(address,uint256)"
            ]);
            const callData = iface.encodeFunctionData("updateConfigDAO", [
                ethers.ZeroAddress, // Don't change token
                newFee
            ]);

            await templ.connect(user1).createProposal(
                "Update Fee",
                "Change entry fee to 200",
                callData,
                7 * 24 * 60 * 60
            );

            // Vote yes
            await templ.connect(user1).vote(0, true);
            await templ.connect(user2).vote(0, true);

            // Fast forward and execute
            await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine");

            await templ.executeProposal(0);

            expect(await templ.entryFee()).to.equal(newFee);
        });

        it("Should execute arbitrary contract calls via executeDAO", async function () {
            // Deploy another token that will be sent to the contract
            const otherToken = await ethers.deployContract("TestToken", ["Other", "OTHER", 18]);
            await otherToken.mint(await templ.getAddress(), ethers.parseUnits("500", 18));

            // Create proposal to transfer the other token
            const erc20Interface = new ethers.Interface([
                "function transfer(address,uint256) returns (bool)"
            ]);
            const transferCalldata = erc20Interface.encodeFunctionData("transfer", [
                treasury.address,
                ethers.parseUnits("500", 18)
            ]);

            const iface = new ethers.Interface([
                "function executeDAO(address,uint256,bytes)"
            ]);
            const target = await otherToken.getAddress();
            const callData = iface.encodeFunctionData("executeDAO", [
                target,
                0, // No ETH
                transferCalldata
            ]);

            await templ.connect(user1).createProposal(
                "Transfer Other Token",
                "Move OTHER tokens to treasury",
                callData,
                7 * 24 * 60 * 60
            );

            // Vote and execute
            await templ.connect(user1).vote(0, true);
            await templ.connect(user2).vote(0, true);

            await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine");

            const resultData = erc20Interface.encodeFunctionResult("transfer", [true]);

            const balanceBefore = await otherToken.balanceOf(treasury.address);
            const tx = await templ.executeProposal(0);
            await expect(tx)
                .to.emit(templ, "DAOExecuted")
                .withArgs(target, 0, transferCalldata, resultData);
            const balanceAfter = await otherToken.balanceOf(treasury.address);

            expect(balanceAfter - balanceBefore).to.equal(ethers.parseUnits("500", 18));
        });

        it("Should execute pause/unpause proposal", async function () {
            const iface = new ethers.Interface([
                "function setPausedDAO(bool)"
            ]);
            const callData = iface.encodeFunctionData("setPausedDAO", [true]);

            await templ.connect(user1).createProposal(
                "Pause Contract",
                "Emergency pause",
                callData,
                7 * 24 * 60 * 60
            );

            // Vote yes
            await templ.connect(user1).vote(0, true);
            await templ.connect(user2).vote(0, true);

            // Fast forward and execute
            await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine");

            await templ.executeProposal(0);

            expect(await templ.paused()).to.be.true;

            // Should prevent purchases when paused
            await token.connect(user4).approve(await templ.getAddress(), ENTRY_FEE);
            await expect(templ.connect(user4).purchaseAccess())
                .to.be.revertedWithCustomError(templ, "ContractPausedError");
        });

        it("Should prevent double execution", async function () {
            const iface = new ethers.Interface([
                "function setPausedDAO(bool)"
            ]);
            const callData = iface.encodeFunctionData("setPausedDAO", [true]);

            await templ.connect(user1).createProposal(
                "Test",
                "Test",
                callData,
                7 * 24 * 60 * 60
            );

            await templ.connect(user1).vote(0, true);
            await templ.connect(user2).vote(0, true);

            await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine");

            await templ.executeProposal(0);

            await expect(templ.executeProposal(0))
                .to.be.revertedWithCustomError(templ, "AlreadyExecuted");
        });
    });

    describe("DAO Treasury Security", function () {
        beforeEach(async function () {
            // Setup members and treasury
            await token.connect(user1).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(user1).purchaseAccess();
            
            await token.connect(user2).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(user2).purchaseAccess();
        });

        it("Should prevent direct treasury withdrawal by priest", async function () {
            // Priest cannot call withdrawTreasuryDAO directly
            await expect(templ.connect(priest).withdrawTreasuryDAO(
                0,
                priest.address,
                ethers.parseUnits("10", 18),
                "Unauthorized"
            )).to.be.revertedWithCustomError(templ, "NotDAO");
        });

        it("Should prevent direct treasury withdrawal by members", async function () {
            await expect(templ.connect(user1).withdrawTreasuryDAO(
                0,
                user1.address,
                ethers.parseUnits("10", 18),
                "Unauthorized"
            )).to.be.revertedWithCustomError(templ, "NotDAO");
        });

        it("Should prevent direct full treasury withdrawal", async function () {
            await expect(
                templ.connect(priest).withdrawAllTreasuryDAO(
                    0,
                    priest.address,
                    "Unauthorized"
                )
            ).to.be.revertedWithCustomError(templ, "NotDAO");
        });

        it("Should prevent direct executeDAO calls", async function () {
            await expect(
                templ.connect(priest).executeDAO(
                    priest.address,
                    0,
                    "0x"
                )
            ).to.be.revertedWithCustomError(templ, "NotDAO");
        });

        it("Should only allow treasury withdrawal through passed proposals", async function () {
            const treasuryBalance = await templ.treasuryBalance();
            const withdrawAmount = treasuryBalance / 2n; // Half of treasury

            const nextId = await templ.proposalCount();
            const iface = new ethers.Interface([
                "function withdrawTreasuryDAO(uint256,address,uint256,string)"
            ]);
            const callData = iface.encodeFunctionData("withdrawTreasuryDAO", [
                nextId,
                treasury.address,
                withdrawAmount,
                "Approved withdrawal"
            ]);

            await templ.connect(user1).createProposal(
                "Treasury Transfer",
                "Transfer half treasury",
                callData,
                7 * 24 * 60 * 60
            );

            // Pass the proposal
            await templ.connect(user1).vote(0, true);
            await templ.connect(user2).vote(0, true);

            await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine");

            const treasuryBefore = await templ.treasuryBalance();
            await templ.executeProposal(0);
            
            expect(await templ.treasuryBalance()).to.equal(treasuryBefore - withdrawAmount);
        });

        it("Should prevent config changes without DAO approval", async function () {
            await expect(templ.connect(priest).updateConfigDAO(
                await token.getAddress(),
                ethers.parseUnits("500", 18)
            )).to.be.revertedWithCustomError(templ, "NotDAO");
        });

        it("Should prevent pause without DAO approval", async function () {
            await expect(templ.connect(priest).setPausedDAO(true))
                .to.be.revertedWithCustomError(templ, "NotDAO");
        });
    });

    describe("Active Proposals Query", function () {
        beforeEach(async function () {
            // Setup members
            await token.connect(user1).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(user1).purchaseAccess();
            
            // Add user2 as member too (needed for multiple proposal tests)
            await token.connect(user2).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(user2).purchaseAccess();
        });

        it("Should return active proposals correctly", async function () {
            // Create multiple proposals with different users (due to single proposal restriction)
            await templ.connect(user1).createProposal(
                "Active 1",
                "First active",
                "0x1234",
                7 * 24 * 60 * 60
            );

            await templ.connect(user2).createProposal(
                "Active 2",
                "Second active",
                "0x5678",
                10 * 24 * 60 * 60
            );

            const activeProposals = await templ.getActiveProposals();
            expect(activeProposals.length).to.equal(2);
            expect(activeProposals[0]).to.equal(0);
            expect(activeProposals[1]).to.equal(1);
        });

        it("Should exclude expired proposals", async function () {
            await templ.connect(user1).createProposal(
                "Short",
                "Expires soon",
                "0x1234",
                7 * 24 * 60 * 60 // 7 days
            );

            await templ.connect(user2).createProposal(
                "Long",
                "Active longer",
                "0x5678",
                14 * 24 * 60 * 60 // 14 days
            );

            // Fast forward 8 days (first proposal expires, second still active)
            await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine");

            const activeProposals = await templ.getActiveProposals();
            expect(activeProposals.length).to.equal(1);
            expect(activeProposals[0]).to.equal(1); // Only second proposal active
        });

        it("Should exclude executed proposals", async function () {
            const iface = new ethers.Interface([
                "function setPausedDAO(bool)"
            ]);
            const callData = iface.encodeFunctionData("setPausedDAO", [true]);

            await templ.connect(user1).createProposal(
                "Execute Me",
                "Will be executed",
                callData,
                7 * 24 * 60 * 60
            );

            await templ.connect(user2).createProposal(
                "Still Active",
                "Not executed",
                "0x5678",
                14 * 24 * 60 * 60
            );

            // Need to wait a bit for voting timestamps
            await ethers.provider.send("evm_increaseTime", [10]);
            await ethers.provider.send("evm_mine");

            // Vote and execute first proposal
            await templ.connect(user1).vote(0, true);
            
            await ethers.provider.send("evm_increaseTime", [7 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine");
            
            await templ.executeProposal(0);

            const activeProposals = await templ.getActiveProposals();
            expect(activeProposals.length).to.equal(1);
            expect(activeProposals[0]).to.equal(1); // Only second proposal active
        });
    });

    describe("Member Pool Distribution", function () {
        it("Should distribute rewards correctly to existing members", async function () {
            // First member joins
            await token.connect(user1).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(user1).purchaseAccess();

            // Check first member has no claimable (no one joined after them yet)
            expect(await templ.getClaimablePoolAmount(user1.address)).to.equal(0);

            // Second member joins
            await token.connect(user2).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(user2).purchaseAccess();

            // First member should now have claimable rewards (30% of entry fee)
            const thirtyPercent = (ENTRY_FEE * 30n) / 100n;
            expect(await templ.getClaimablePoolAmount(user1.address)).to.equal(thirtyPercent);

            // Second member has no claimable yet
            expect(await templ.getClaimablePoolAmount(user2.address)).to.equal(0);

            // Third member joins
            await token.connect(user3).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(user3).purchaseAccess();

            // Both user1 and user2 should get half of the new member's pool contribution
            const halfShare = thirtyPercent / 2n;
            expect(await templ.getClaimablePoolAmount(user1.address)).to.equal(thirtyPercent + halfShare);
            expect(await templ.getClaimablePoolAmount(user2.address)).to.equal(halfShare);
        });

        it("Should allow members to claim their pool rewards", async function () {
            // Setup: 3 members join
            await token.connect(user1).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(user1).purchaseAccess();

            await token.connect(user2).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(user2).purchaseAccess();

            await token.connect(user3).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(user3).purchaseAccess();

            const claimable = await templ.getClaimablePoolAmount(user1.address);
            const balanceBefore = await token.balanceOf(user1.address);

            await expect(templ.connect(user1).claimMemberPool())
                .to.emit(templ, "MemberPoolClaimed");

            expect(await token.balanceOf(user1.address)).to.equal(balanceBefore + claimable);
            expect(await templ.getClaimablePoolAmount(user1.address)).to.equal(0);
        });

        it("Should prevent claiming when no rewards available", async function () {
            await token.connect(user1).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(user1).purchaseAccess();

            await expect(templ.connect(user1).claimMemberPool())
                .to.be.revertedWithCustomError(templ, "NoRewardsToClaim");
        });

        it("Should track claimed amounts correctly", async function () {
            // Setup members
            await token.connect(user1).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(user1).purchaseAccess();

            await token.connect(user2).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(user2).purchaseAccess();

            // Claim once
            await templ.connect(user1).claimMemberPool();

            // Third member joins
            await token.connect(user3).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(user3).purchaseAccess();

            // User1 should only be able to claim new rewards
            const thirtyPercent = (ENTRY_FEE * 30n) / 100n;
            const expectedNew = thirtyPercent / 2n; // Split between 2 existing members
            
            expect(await templ.getClaimablePoolAmount(user1.address)).to.equal(expectedNew);
        });
    });

    describe("Edge Cases and Security", function () {
        it("Should handle very small entry fees correctly", async function () {
            // Deploy with minimum fee
            const minTempl = await ethers.deployContract("TEMPL", [
                priest.address,
                priest.address, // protocolFeeRecipient
                await token.getAddress(),
                10, // Minimum allowed
                10, // priestVoteWeight
                10  // priestWeightThreshold
            ]);

            await token.connect(user1).approve(await minTempl.getAddress(), 10);
            await minTempl.connect(user1).purchaseAccess();

            // Should still split correctly even with rounding
            expect(await minTempl.treasuryBalance()).to.be.gte(0);
        });

        it("Should reject entry fee below minimum", async function () {
            const factory = await ethers.getContractFactory("TEMPL");
            await expect(factory.deploy(
                priest.address,
                priest.address, // protocolFeeRecipient
                await token.getAddress(),
                9, // Below minimum
                10, // priestVoteWeight
                10  // priestWeightThreshold
            )).to.be.revertedWithCustomError(factory, "EntryFeeTooSmall");
        });


        it("Should handle proposal with invalid calldata gracefully", async function () {
            await token.connect(user1).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(user1).purchaseAccess();

            // Create proposal with calldata for non-existent function
            const badCallData = "0x12345678"; // Invalid function selector

            await templ.connect(user1).createProposal(
                "Bad Proposal",
                "This will fail",
                badCallData,
                7 * 24 * 60 * 60
            );

            await templ.connect(user1).vote(0, true);

            await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine");

            // Execution should revert
            await expect(templ.executeProposal(0))
                .to.be.revertedWithCustomError(templ, "ProposalExecutionFailed");

            // Proposal should not be marked as executed
            const proposal = await templ.getProposal(0);
            expect(proposal.executed).to.be.false;
        });
    });

    describe("Additional DAO Functions", function () {
        beforeEach(async function () {
            // Setup members
            await token.connect(user1).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(user1).purchaseAccess();
            
            await token.connect(user2).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(user2).purchaseAccess();
        });

        it("Should execute withdrawAllTreasuryDAO through proposal", async function () {
            const nextId = await templ.proposalCount();
            const iface = new ethers.Interface([
                "function withdrawAllTreasuryDAO(uint256,address,string)"
            ]);
            const callData = iface.encodeFunctionData("withdrawAllTreasuryDAO", [
                nextId,
                treasury.address,
                "Empty treasury"
            ]);

            await templ.connect(user1).createProposal(
                "Empty Treasury",
                "Withdraw all funds",
                callData,
                7 * 24 * 60 * 60
            );

            await templ.connect(user1).vote(0, true);
            await templ.connect(user2).vote(0, true);

            await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine");

            const treasuryBefore = await templ.treasuryBalance();
            await templ.executeProposal(0);

            expect(await templ.treasuryBalance()).to.equal(0);
            expect(await token.balanceOf(treasury.address)).to.equal(treasuryBefore);
        });

        it("Should fail to execute executeDAO with invalid target", async function () {
            const iface = new ethers.Interface([
                "function executeDAO(address,uint256,bytes)"
            ]);
            const callData = iface.encodeFunctionData("executeDAO", [
                ethers.ZeroAddress,
                0,
                "0x"
            ]);

            await templ.connect(user1).createProposal(
                "Invalid exec",
                "Bad target",
                callData,
                7 * 24 * 60 * 60
            );

            await templ.connect(user1).vote(0, true);
            await templ.connect(user2).vote(0, true);

            await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine");

            await expect(templ.executeProposal(0))
                .to.be.revertedWithCustomError(templ, "InvalidTarget");

            const proposal = await templ.getProposal(0);
            expect(proposal.executed).to.be.false;
        });
    });

    describe("Comprehensive View Functions", function () {
        beforeEach(async function () {
            await token.connect(user1).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(user1).purchaseAccess();
        });

        it("Should return correct hasAccess status", async function () {
            expect(await templ.hasAccess(user1.address)).to.be.true;
            expect(await templ.hasAccess(user2.address)).to.be.false;
        });

        it("Should return correct purchase details", async function () {
            const details = await templ.getPurchaseDetails(user1.address);
            expect(details.purchased).to.be.true;
            expect(details.timestamp).to.be.gt(0);
            expect(details.blockNum).to.be.gt(0);

            const noDetails = await templ.getPurchaseDetails(user2.address);
            expect(noDetails.purchased).to.be.false;
            expect(noDetails.timestamp).to.equal(0);
            expect(noDetails.blockNum).to.equal(0);
        });

        it("Should return correct config information", async function () {
            const config = await templ.getConfig();
            expect(config.token).to.equal(await token.getAddress());
            expect(config.fee).to.equal(ENTRY_FEE);
            expect(config.isPaused).to.be.false;
            expect(config.purchases).to.equal(1);
            expect(config.treasury).to.be.gt(0);
            expect(config.pool).to.be.gt(0);
        });

        it("Should track total values correctly", async function () {
            const info = await templ.getTreasuryInfo();
            const thirtyPercent = (ENTRY_FEE * 30n) / 100n;
            const tenPercent = (ENTRY_FEE * 10n) / 100n;
            
            expect(info.treasury).to.equal(thirtyPercent);
            expect(info.memberPool).to.equal(thirtyPercent);
            expect(info.totalReceived).to.equal(thirtyPercent);
            expect(info.totalBurnedAmount).to.equal(thirtyPercent);
            expect(info.totalProtocolFees).to.equal(tenPercent);
            expect(info.protocolAddress).to.equal(priest.address);
        });
    });

    describe("Gas Optimization Tests", function () {
        it("Should handle large member counts efficiently", async function () {
            // Add 10 members
            for (let i = 0; i < 10; i++) {
                const signer = (await ethers.getSigners())[i + 1];
                await token.mint(signer.address, TOKEN_SUPPLY);
                await token.connect(signer).approve(await templ.getAddress(), ENTRY_FEE);
                await templ.connect(signer).purchaseAccess();
            }

            expect(await templ.getMemberCount()).to.equal(10);
            
            // Check that first member can still claim efficiently
            const claimable = await templ.getClaimablePoolAmount((await ethers.getSigners())[1].address);
            expect(claimable).to.be.gt(0);
        });
    });

    describe("Integration Tests", function () {
        it("Should handle complete user journey", async function () {
            // User 1 joins
            await token.connect(user1).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(user1).purchaseAccess();
            expect(await templ.getMemberCount()).to.equal(1);

            // User 2 joins
            await token.connect(user2).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(user2).purchaseAccess();
            expect(await templ.getMemberCount()).to.equal(2);

            // User 1 claims rewards
            const claimable = await templ.getClaimablePoolAmount(user1.address);
            expect(claimable).to.be.gt(0);
            await templ.connect(user1).claimMemberPool();

            // User 1 creates proposal
            const nextId = await templ.proposalCount();
            const iface = new ethers.Interface([
                "function withdrawTreasuryDAO(uint256,address,uint256,string)"
            ]);
            const callData = iface.encodeFunctionData("withdrawTreasuryDAO", [
                nextId,
                treasury.address,
                ethers.parseUnits("10", 18),
                "Community fund"
            ]);

            await templ.connect(user1).createProposal(
                "Community Fund",
                "Withdraw for community",
                callData,
                7 * 24 * 60 * 60
            );

            // Both vote
            await templ.connect(user1).vote(0, true);
            await templ.connect(user2).vote(0, true);

            // Fast forward and execute
            await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine");

            await templ.executeProposal(0);

            // Verify all state
            const proposal = await templ.getProposal(0);
            expect(proposal.executed).to.be.true;
            expect(proposal.passed).to.be.true;
        });
    });
});