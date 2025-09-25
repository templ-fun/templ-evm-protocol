const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, purchaseAccess } = require("./utils/mintAndPurchase");
const { encodeSetPausedDAO, encodeWithdrawTreasuryDAO, encodeUpdateConfigDAO } = require("./utils/callDataBuilders");

describe("TEMPL Contract with DAO Governance", function () {
    let templ;
    let token;
    let owner, priest, user1, user2, user3, user4, treasury;
    let accounts;
    const ENTRY_FEE = ethers.parseUnits("100", 18);
    const TOKEN_SUPPLY = ethers.parseUnits("10000", 18);

    beforeEach(async function () {
        ({ templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE }));
        [owner, priest, user1, user2, user3, user4, treasury] = accounts;

        await mintToUsers(token, [user1, user2, user3, user4], TOKEN_SUPPLY);
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

        it("Should revert when entry fee not divisible by 10", async function () {
            const invalidFee = ENTRY_FEE + 5n;
            const TEMPL = await ethers.getContractFactory("TEMPL");
            await expect(
                TEMPL.deploy(
                    priest.address,
                    priest.address,
                    await token.getAddress(),
                    invalidFee,
                    30,
                    30,
                    30,
                    10,
                    33,
                    7 * 24 * 60 * 60,
                    "0x000000000000000000000000000000000000dEaD",
                    false,
                    0,
                    ""
                )
            ).to.be.revertedWithCustomError(TEMPL, "InvalidEntryFee");
        });

        it("Should revert when required address is zero", async function () {
            const TEMPL = await ethers.getContractFactory("TEMPL");
            await expect(
                TEMPL.deploy(
                    ethers.ZeroAddress,
                    priest.address,
                    await token.getAddress(),
                    ENTRY_FEE,
                    30,
                    30,
                    30,
                    10,
                    33,
                    7 * 24 * 60 * 60,
                    "0x000000000000000000000000000000000000dEaD",
                    false,
                    0,
                    ""
                )
            ).to.be.revertedWithCustomError(TEMPL, "InvalidRecipient");
        });

        it("Should revert when protocol fee recipient is zero", async function () {
            const TEMPL = await ethers.getContractFactory("TEMPL");
            await expect(
                TEMPL.deploy(
                    priest.address,
                    ethers.ZeroAddress,
                    await token.getAddress(),
                    ENTRY_FEE,
                    30,
                    30,
                    30,
                    10,
                    33,
                    7 * 24 * 60 * 60,
                    "0x000000000000000000000000000000000000dEaD",
                    false,
                    0,
                    ""
                )
            ).to.be.revertedWithCustomError(TEMPL, "InvalidRecipient");
        });

        it("defaults quorum, execution delay and burn address when zero", async function () {
            const TEMPL = await ethers.getContractFactory("TEMPL");
            const templZero = await TEMPL.deploy(
                priest.address,
                priest.address,
                await token.getAddress(),
                ENTRY_FEE,
                30,
                30,
                30,
                10,
                0,
                0,
                ethers.ZeroAddress,
                false,
                0,
                ""
            );
            await templZero.waitForDeployment();

            expect(await templZero.quorumPercent()).to.equal(33);
            expect(await templZero.executionDelayAfterQuorum()).to.equal(7 * 24 * 60 * 60);
            expect(await templZero.burnAddress()).to.equal("0x000000000000000000000000000000000000dEaD");
        });

        it("reverts when quorum percent exceeds total", async function () {
            const TEMPL = await ethers.getContractFactory("TEMPL");
            await expect(
                TEMPL.deploy(
                    priest.address,
                    priest.address,
                    await token.getAddress(),
                    ENTRY_FEE,
                    30,
                    30,
                    30,
                    10,
                    120,
                    7 * 24 * 60 * 60,
                    "0x000000000000000000000000000000000000dEaD",
                    false,
                    0,
                    ""
                )
            ).to.be.revertedWithCustomError(TEMPL, "InvalidPercentage");
        });

        it("reverts when fee splits do not sum to 100", async function () {
            const TEMPL = await ethers.getContractFactory("TEMPL");
            await expect(
                TEMPL.deploy(
                    priest.address,
                    priest.address,
                    await token.getAddress(),
                    ENTRY_FEE,
                    50,
                    40,
                    30,
                    10,
                    33,
                    7 * 24 * 60 * 60,
                    "0x000000000000000000000000000000000000dEaD",
                    false,
                    0,
                    ""
                )
            ).to.be.revertedWithCustomError(TEMPL, "InvalidPercentageSplit");
        });

        it("Should revert when access token address is zero", async function () {
            const TEMPL = await ethers.getContractFactory("TEMPL");
            await expect(
                TEMPL.deploy(
                    priest.address,
                    priest.address,
                    ethers.ZeroAddress,
                    ENTRY_FEE,
                    30,
                    30,
                    30,
                    10,
                    33,
                    7 * 24 * 60 * 60,
                    "0x000000000000000000000000000000000000dEaD",
                    false,
                    0,
                    ""
                )
            ).to.be.revertedWithCustomError(TEMPL, "InvalidRecipient");
        });

        it("Should revert when entry fee is zero", async function () {
            const TEMPL = await ethers.getContractFactory("TEMPL");
            await expect(
                TEMPL.deploy(
                    priest.address,
                    priest.address,
                    await token.getAddress(),
                    0,
                    30,
                    30,
                    30,
                    10,
                    33,
                    7 * 24 * 60 * 60,
                    "0x000000000000000000000000000000000000dEaD",
                    false,
                    0,
                    ""
                )
            ).to.be.revertedWithCustomError(TEMPL, "AmountZero");
        });
    });

    describe("Access Purchase with 30/30/30/10 Split", function () {
        it("Should correctly split payments: 30% burn, 30% treasury, 30% pool, 10% protocol", async function () {
            
            const priestBalanceBefore = await token.balanceOf(priest.address);
            const deadBalanceBefore = await token.balanceOf("0x000000000000000000000000000000000000dEaD");
            
            await purchaseAccess(templ, token, [user1]);
            
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
            await purchaseAccess(templ, token, [user1]);
            
            expect(await templ.hasAccess(user1.address)).to.be.true;
            expect(await templ.getMemberCount()).to.equal(1);
        });

        it("Should prevent double purchase", async function () {
            await purchaseAccess(templ, token, [user1]);

            await token.connect(user1).approve(await templ.getAddress(), ENTRY_FEE);
            await expect(templ.connect(user1).purchaseAccess())
                .to.be.revertedWithCustomError(templ, "AlreadyPurchased");
        });

        it("Should revert when user has insufficient balance", async function () {
            await expect(templ.connect(owner).purchaseAccess())
                .to.be.revertedWithCustomError(templ, "InsufficientBalance");
        });
    });

    describe("DAO Proposal Creation", function () {
        beforeEach(async function () {
            // User1 becomes a member
            await purchaseAccess(templ, token, [user1]);
        });

        it("Should allow members to create proposals", async function () {
            const title = "Test Proposal";
            const description = "This is a test proposal";
            const votingPeriod = 7 * 24 * 60 * 60; // 7 days

            await expect(templ.connect(user1).createProposalSetPaused(
                false,
                votingPeriod
            )).to.emit(templ, "ProposalCreated");

            expect(await templ.proposalCount()).to.equal(1);
            
            const proposal = await templ.getProposal(0);
            expect(proposal.proposer).to.equal(user1.address);
        });

        it("Should prevent non-members from creating proposals", async function () {
            await expect(templ.connect(user2).createProposalSetPaused(
                false,
                7 * 24 * 60 * 60
            )).to.be.revertedWithCustomError(templ, "NotMember");
        });

        it("Should allow creating a proposal to withdraw treasury funds", async function () {
            await expect(
                templ.connect(user1).createProposalWithdrawTreasury(
                    token.target,
                    treasury.address,
                    ethers.parseUnits("1", 18),
                    "Move funds",
                    7 * 24 * 60 * 60
                )
            ).to.emit(templ, "ProposalCreated");
        });

        // withdrawAll proposal removed

        it("Should enforce minimum voting period", async function () {
            await expect(templ.connect(user1).createProposalSetPaused(
                false,
                6 * 24 * 60 * 60
            )).to.be.revertedWithCustomError(templ, "VotingPeriodTooShort");
        });

        it("Should enforce maximum voting period", async function () {
            await expect(templ.connect(user1).createProposalSetPaused(
                false,
                31 * 24 * 60 * 60
            )).to.be.revertedWithCustomError(templ, "VotingPeriodTooLong");
        });

        it("Should default to standard voting period when none provided", async function () {
            await templ.connect(user1).createProposalSetPaused(
                false,
                0,
                    ""
            );
            const proposal = await templ.proposals(0);
            const defaultPeriod = await templ.DEFAULT_VOTING_PERIOD();
            expect(proposal.endTime - proposal.createdAt).to.equal(defaultPeriod);
        });

        // callData not used in typed interface

        it("Should revert when retrieving a non-existent proposal", async function () {
            await expect(templ.getProposal(0))
                .to.be.revertedWithCustomError(templ, "InvalidProposal");
        });
    });

    describe("DAO Voting", function () {
        beforeEach(async function () {
            // Multiple users become members
            await purchaseAccess(templ, token, [user1]);
            
            await purchaseAccess(templ, token, [user2]);
            
            await purchaseAccess(templ, token, [user3]);

            // Create a proposal
            const callData = encodeWithdrawTreasuryDAO(
                token.target,
                treasury.address,
                ethers.parseUnits("10", 18),
                "Test withdrawal"
            );

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

        it("Should allow changing vote until deadline", async function () {
            // Initial vote YES (note: proposer auto-voted yes at creation, but user1 may re-cast)
            await templ.connect(user1).vote(0, true);
            let proposal = await templ.getProposal(0);
            expect(proposal.yesVotes).to.equal(1);
            expect(proposal.noVotes).to.equal(0);

            // Change to NO
            await templ.connect(user1).vote(0, false);
            proposal = await templ.getProposal(0);
            expect(proposal.yesVotes).to.equal(0);
            expect(proposal.noVotes).to.equal(1);

            // Change back to YES
            await templ.connect(user1).vote(0, true);
            proposal = await templ.getProposal(0);
            expect(proposal.yesVotes).to.equal(1);
            expect(proposal.noVotes).to.equal(0);
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

        it("Should revert when voting on a non-existent proposal", async function () {
            await expect(templ.connect(user1).vote(1, true))
                .to.be.revertedWithCustomError(templ, "InvalidProposal");
        });

        it("Should revert when voting after the voting period has ended", async function () {
            await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine");

            await expect(templ.connect(user1).vote(0, true))
                .to.be.revertedWithCustomError(templ, "VotingEnded");
        });
    });

    describe("DAO Proposal Execution", function () {
        beforeEach(async function () {
            // Setup members
            await purchaseAccess(templ, token, [user1]);
            
            await purchaseAccess(templ, token, [user2]);
            
            await purchaseAccess(templ, token, [user3]);
        });

        it("Should execute passed treasury withdrawal proposal", async function () {
            // Create treasury withdrawal proposal
            const withdrawAmount = ethers.parseUnits("10", 18);
            const callData = encodeWithdrawTreasuryDAO(
                token.target,
                treasury.address,
                withdrawAmount,
                "Test withdrawal"
            );

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
            const callData = encodeWithdrawTreasuryDAO(
                token.target,
                treasury.address,
                ethers.parseUnits("10", 18),
                "Test"
            );

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
            const callData = encodeSetPausedDAO(true);

            await templ.connect(user1).createProposal(
                "Pause",
                "Pause contract",
                callData,
                7 * 24 * 60 * 60
            );

            // Vote yes
            await templ.connect(user1).vote(0, true);
            await templ.connect(user2).vote(0, true);

            // Try to execute immediately: should require delay after quorum
            await expect(templ.connect(user1).executeProposal(0))
                .to.be.revertedWithCustomError(templ, "ExecutionDelayActive");
        });

        it("Should execute config update proposal", async function () {
            const newFee = ethers.parseUnits("200", 18);
            const callData = encodeUpdateConfigDAO(
                ethers.ZeroAddress, // Don't change token
                newFee,
                false,
                0,
                0,
                0
            );

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


        it("Should execute pause/unpause proposal", async function () {
            const callData = encodeSetPausedDAO(true);

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
            const callData = encodeSetPausedDAO(true);

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
            await purchaseAccess(templ, token, [user1]);
            
            await purchaseAccess(templ, token, [user2]);
        });

        it("Should prevent direct treasury withdrawal by priest", async function () {
            // Priest cannot call withdrawTreasuryDAO directly
            await expect(templ.connect(priest).withdrawTreasuryDAO(
                token.target,
                priest.address,
                ethers.parseUnits("10", 18),
                "Unauthorized"
            )).to.be.revertedWithCustomError(templ, "NotDAO");
        });

        it("Should prevent direct treasury withdrawal by members", async function () {
            await expect(templ.connect(user1).withdrawTreasuryDAO(
                token.target,
                user1.address,
                ethers.parseUnits("10", 18),
                "Unauthorized"
            )).to.be.revertedWithCustomError(templ, "NotDAO");
        });

        // withdrawAll DAO call removed


        it("Should only allow treasury withdrawal through passed proposals", async function () {
            const treasuryBalance = await templ.treasuryBalance();
            const withdrawAmount = treasuryBalance / 2n; // Half of treasury

            const callData = encodeWithdrawTreasuryDAO(
                token.target,
                treasury.address,
                withdrawAmount,
                "Approved withdrawal"
            );

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
                ethers.parseUnits("500", 18),
                false,
                0,
                0,
                0
            )).to.be.revertedWithCustomError(templ, "NotDAO");
        });

        it("Should prevent pause without DAO approval", async function () {
            await expect(templ.connect(priest).setPausedDAO(true))
                .to.be.revertedWithCustomError(templ, "NotDAO");
        });
    });

    describe("Paused contract behavior", function () {
        beforeEach(async function () {
            // user1 and user2 become members
            await purchaseAccess(templ, token, [user1]);

            await purchaseAccess(templ, token, [user2]);
            // Add more members so initial auto-yes does not meet quorum
            await purchaseAccess(templ, token, [user3]);
            await purchaseAccess(templ, token, [user4]);

            // interface for pause/unpause proposals
            // create proposal that remains active for voting after pause
            const unpauseData = encodeSetPausedDAO(false);
            await templ.connect(user1).createProposal(
                "Unpause",
                "Resume operations",
                unpauseData,
                14 * 24 * 60 * 60
            );

            // create and execute pause proposal
            const pauseData = encodeSetPausedDAO(true);

            await templ.connect(user2).createProposal(
                "Pause",
                "Emergency pause",
                pauseData,
                7 * 24 * 60 * 60
            );

            await templ.connect(user1).vote(1, true);
            await templ.connect(user2).vote(1, true);

            await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine");

            await templ.executeProposal(1);
            expect(await templ.paused()).to.be.true;
        });

        it("Should revert purchaseAccess when paused", async function () {
            await token.connect(user3).approve(await templ.getAddress(), ENTRY_FEE);
            await expect(templ.connect(user3).purchaseAccess())
                .to.be.revertedWithCustomError(templ, "ContractPausedError");
        });

        it("Should allow createProposal when paused", async function () {
            const callData = encodeSetPausedDAO(false);
            await expect(
                templ.connect(user2).createProposal(
                    "New",
                    "New proposal",
                    callData,
                    7 * 24 * 60 * 60
                )
            ).to.emit(templ, "ProposalCreated");
        });

        it("Should allow vote when paused", async function () {
            await expect(templ.connect(user2).vote(0, true)).to.emit(
                templ,
                "VoteCast"
            );
        });

        it("Should allow executeProposal when paused", async function () {
            await templ.connect(user1).vote(0, true);
            await templ.connect(user2).vote(0, true);

            await ethers.provider.send("evm_increaseTime", [7 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine");

            await expect(templ.executeProposal(0)).to.emit(
                templ,
                "ProposalExecuted"
            );
            expect(await templ.paused()).to.be.false;
        });
    });

    describe("Active Proposals Query", function () {
        beforeEach(async function () {
            // Setup members
            await purchaseAccess(templ, token, [user1]);
            
            // Add user2 as member too (needed for multiple proposal tests)
            await purchaseAccess(templ, token, [user2]);
            // Add more members so initial auto-yes does not meet quorum
            await purchaseAccess(templ, token, [user3]);
            await purchaseAccess(templ, token, [user4]);
        });

        it("Should return active proposals correctly", async function () {
            // Create multiple proposals with different users (due to single proposal restriction)
            const cd1 = encodeSetPausedDAO(false);
            const cd2 = encodeSetPausedDAO(true);
            await templ.connect(user1).createProposal(
                "Active 1",
                "First active",
                cd1,
                7 * 24 * 60 * 60
            );

            await templ.connect(user2).createProposal(
                "Active 2",
                "Second active",
                cd2,
                10 * 24 * 60 * 60
            );

            const activeProposals = await templ.getActiveProposals();
            expect(activeProposals.length).to.equal(2);
            expect(activeProposals[0]).to.equal(0);
            expect(activeProposals[1]).to.equal(1);
        });

        it("Should exclude expired proposals", async function () {
            const cd3 = encodeSetPausedDAO(false);
            await templ.connect(user1).createProposal(
                "Short",
                "Expires soon",
                cd3,
                7 * 24 * 60 * 60 // 7 days
            );

            const cd4 = encodeSetPausedDAO(true);
            await templ.connect(user2).createProposal(
                "Long",
                "Active longer",
                cd4,
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
            const callData = encodeSetPausedDAO(true);

            await templ.connect(user1).createProposal(
                "Execute Me",
                "Will be executed",
                callData,
                7 * 24 * 60 * 60
            );

            const cd5 = encodeSetPausedDAO(false);
            await templ.connect(user2).createProposal(
                "Still Active",
                "Not executed",
                cd5,
                14 * 24 * 60 * 60
            );

            // Need to wait a bit for voting timestamps
            await ethers.provider.send("evm_increaseTime", [10]);
            await ethers.provider.send("evm_mine");

            // Vote and execute first proposal (ensure quorum)
            await templ.connect(user1).vote(0, true);
            await templ.connect(user2).vote(0, true);
            
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
            await purchaseAccess(templ, token, [user1]);

            // Check first member has no claimable (no one joined after them yet)
            expect(await templ.getClaimablePoolAmount(user1.address)).to.equal(0);

            // Second member joins
            await purchaseAccess(templ, token, [user2]);

            // First member should now have claimable rewards (30% of entry fee)
            const thirtyPercent = (ENTRY_FEE * 30n) / 100n;
            expect(await templ.getClaimablePoolAmount(user1.address)).to.equal(thirtyPercent);

            // Second member has no claimable yet
            expect(await templ.getClaimablePoolAmount(user2.address)).to.equal(0);

            // Third member joins
            await purchaseAccess(templ, token, [user3]);

            // Both user1 and user2 should get half of the new member's pool contribution
            const halfShare = thirtyPercent / 2n;
            expect(await templ.getClaimablePoolAmount(user1.address)).to.equal(thirtyPercent + halfShare);
            expect(await templ.getClaimablePoolAmount(user2.address)).to.equal(halfShare);
        });

        it("Should allow members to claim their pool rewards", async function () {
            // Setup: 3 members join
            await purchaseAccess(templ, token, [user1]);

            await purchaseAccess(templ, token, [user2]);

            await purchaseAccess(templ, token, [user3]);

            const claimable = await templ.getClaimablePoolAmount(user1.address);
            const balanceBefore = await token.balanceOf(user1.address);

            await expect(templ.connect(user1).claimMemberPool())
                .to.emit(templ, "MemberPoolClaimed");

            expect(await token.balanceOf(user1.address)).to.equal(balanceBefore + claimable);
            expect(await templ.getClaimablePoolAmount(user1.address)).to.equal(0);
        });

        it("Should prevent claiming when no rewards available", async function () {
            await purchaseAccess(templ, token, [user1]);

            await expect(templ.connect(user1).claimMemberPool())
                .to.be.revertedWithCustomError(templ, "NoRewardsToClaim");
        });

        it("Should track claimed amounts correctly", async function () {
            // Setup members
            await purchaseAccess(templ, token, [user1]);

            await purchaseAccess(templ, token, [user2]);

            // Claim once
            await templ.connect(user1).claimMemberPool();

            // Third member joins
            await purchaseAccess(templ, token, [user3]);

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
                10n, // Minimum allowed
                30,
                30,
                30,
                10,
                33,
                7 * 24 * 60 * 60,
                "0x000000000000000000000000000000000000dEaD",
                false,
                0,
                ""
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
                9,
                30,
                30,
                30,
                10,
                33,
                7 * 24 * 60 * 60,
                "0x000000000000000000000000000000000000dEaD",
                false,
                0,
                    ""
            )).to.be.revertedWithCustomError(factory, "EntryFeeTooSmall");
        });


        // invalid calldata is not applicable anymore
    });

    describe("Additional DAO Functions", function () {
        beforeEach(async function () {
            // Setup members
            await purchaseAccess(templ, token, [user1]);
            
            await purchaseAccess(templ, token, [user2]);
        });

        // withdrawAll proposal path removed

        
    });

    describe("Comprehensive View Functions", function () {
        beforeEach(async function () {
            await purchaseAccess(templ, token, [user1]);
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

        it("Should return 0 claimable for non-members", async function () {
            expect(await templ.getClaimablePoolAmount(user2.address)).to.equal(0);
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
            await purchaseAccess(templ, token, [user1]);
            expect(await templ.getMemberCount()).to.equal(1);

            // User 2 joins
            await purchaseAccess(templ, token, [user2]);
            expect(await templ.getMemberCount()).to.equal(2);

            // User 1 claims rewards
            const claimable = await templ.getClaimablePoolAmount(user1.address);
            expect(claimable).to.be.gt(0);
            await templ.connect(user1).claimMemberPool();

            // User 1 creates proposal
            const callData = encodeWithdrawTreasuryDAO(
                token.target,
                treasury.address,
                ethers.parseUnits("10", 18),
                "Community fund"
            );

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
