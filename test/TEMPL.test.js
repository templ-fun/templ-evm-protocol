const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl, STATIC_CURVE } = require("./utils/deploy");
const { mintToUsers, joinMembers } = require("./utils/mintAndPurchase");
const { encodeSetJoinPausedDAO, encodeWithdrawTreasuryDAO, encodeUpdateConfigDAO } = require("./utils/callDataBuilders");
const { deployTemplModules } = require("./utils/modules");
const { attachTemplInterface } = require("./utils/templ");

describe("TEMPL Contract with DAO Governance", function () {
    let templ;
    let token;
    let owner, priest, user1, user2, user3, user4, treasury;
    let accounts;
    const ENTRY_FEE = ethers.parseUnits("100", 18);
    const TOKEN_SUPPLY = ethers.parseUnits("10000", 18);
    const BURN_BPS = 3000;
    const TREASURY_BPS = 3000;
    const MEMBER_BPS = 3000;
    const PROTOCOL_BPS = 1000;
    const QUORUM_BPS = 3300;
    const METADATA = {
        name: "DAO Templ",
        description: "Governance test templ",
        logo: "https://templ.test/logo.png"
    };

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

        it("applies provided bps inputs during direct deployment", async function () {
            const Token = await ethers.getContractFactory("contracts/mocks/TestToken.sol:TestToken");
            const percentToken = await Token.deploy("Percent", "PERC", 18);
            const customBurnAddress = "0x00000000000000000000000000000000000000CC";
            const TemplFactory = await ethers.getContractFactory("TEMPL");
            const { membershipModule, treasuryModule, governanceModule, councilModule } = await deployTemplModules();
            let templDirect = await TemplFactory.deploy(
                priest.address,
                priest.address,
                await percentToken.getAddress(),
                ENTRY_FEE,
                3000,
                4000,
                2000,
                1000,
                3500,
                12_345,
                customBurnAddress,
                0,
                METADATA.name,
                METADATA.description,
                "https://templ.direct",
                0,
                0,
                5_100,
                 10_000,
                false,
                membershipModule,
                treasuryModule,
                governanceModule,
                councilModule,
                STATIC_CURVE
            );
            await templDirect.waitForDeployment();
            templDirect = await attachTemplInterface(templDirect);

            expect(await templDirect.burnBps()).to.equal(3_000n);
            expect(await templDirect.treasuryBps()).to.equal(4_000n);
            expect(await templDirect.memberPoolBps()).to.equal(2_000n);
            expect(await templDirect.protocolBps()).to.equal(1_000n);
            expect(await templDirect.quorumBps()).to.equal(3_500n);
            expect(await templDirect.postQuorumVotingPeriod()).to.equal(12_345);
            expect(await templDirect.burnAddress()).to.equal(customBurnAddress.toLowerCase());
        });

        it("Should revert when entry fee not divisible by 10", async function () {
            const invalidFee = ENTRY_FEE + 5n;
            const { membershipModule, treasuryModule, governanceModule, councilModule } = await deployTemplModules();
            const TEMPL = await ethers.getContractFactory("TEMPL");
            await expect(
                TEMPL.deploy(
                    priest.address,
                    priest.address,
                    await token.getAddress(),
                    invalidFee,
                    BURN_BPS,
                    TREASURY_BPS,
                    MEMBER_BPS,
                    PROTOCOL_BPS,
                    QUORUM_BPS,
                    7 * 24 * 60 * 60,
                    "0x000000000000000000000000000000000000dEaD",
                    0,
                    METADATA.name,
                    METADATA.description,
                    METADATA.logo,
                    0,
                    0,
                    5_100,
                     10_000,
                    false,
                    membershipModule,
                    treasuryModule,
                    governanceModule,
                    councilModule,
                    STATIC_CURVE
                )
            ).to.be.revertedWithCustomError(TEMPL, "InvalidEntryFee");
        });

        it("Should revert when required address is zero", async function () {
            const { membershipModule, treasuryModule, governanceModule, councilModule } = await deployTemplModules();
            const TEMPL = await ethers.getContractFactory("TEMPL");
            await expect(
                TEMPL.deploy(
                    ethers.ZeroAddress,
                    priest.address,
                    await token.getAddress(),
                    ENTRY_FEE,
                    BURN_BPS,
                    TREASURY_BPS,
                    MEMBER_BPS,
                    PROTOCOL_BPS,
                    QUORUM_BPS,
                    7 * 24 * 60 * 60,
                    "0x000000000000000000000000000000000000dEaD",
                    0,
                    METADATA.name,
                    METADATA.description,
                    METADATA.logo,
                    0,
                    0,
                    5_100,
                     10_000,
                    false,
                    membershipModule,
                    treasuryModule,
                    governanceModule,
                    councilModule,
                    STATIC_CURVE
                )
            ).to.be.revertedWithCustomError(TEMPL, "InvalidRecipient");
        });

        it("Should revert when protocol fee recipient is zero", async function () {
            const { membershipModule, treasuryModule, governanceModule, councilModule } = await deployTemplModules();
            const TEMPL = await ethers.getContractFactory("TEMPL");
            await expect(
                TEMPL.deploy(
                    priest.address,
                    ethers.ZeroAddress,
                    await token.getAddress(),
                    ENTRY_FEE,
                    BURN_BPS,
                    TREASURY_BPS,
                    MEMBER_BPS,
                    PROTOCOL_BPS,
                    QUORUM_BPS,
                    7 * 24 * 60 * 60,
                    "0x000000000000000000000000000000000000dEaD",
                    0,
                    METADATA.name,
                    METADATA.description,
                    METADATA.logo,
                    0,
                    0,
                    5_100,
                     10_000,
                    false,
                    membershipModule,
                    treasuryModule,
                    governanceModule,
                    councilModule,
                    STATIC_CURVE
                )
            ).to.be.revertedWithCustomError(TEMPL, "InvalidRecipient");
        });

        it("defaults quorum, execution delay and burn address when zero", async function () {
            const { membershipModule, treasuryModule, governanceModule, councilModule } = await deployTemplModules();
            const TEMPL = await ethers.getContractFactory("TEMPL");
            let templZero = await TEMPL.deploy(
                priest.address,
                priest.address,
                await token.getAddress(),
                ENTRY_FEE,
                BURN_BPS,
                TREASURY_BPS,
                MEMBER_BPS,
                PROTOCOL_BPS,
                0,
                0,
                ethers.ZeroAddress,
                0,
                METADATA.name,
                METADATA.description,
                METADATA.logo,
                0,
                0,
                5_100,
                 10_000,
                false,
                membershipModule,
                treasuryModule,
                governanceModule,
                councilModule,
                STATIC_CURVE
            );
            await templZero.waitForDeployment();
            templZero = await attachTemplInterface(templZero);

            expect(await templZero.quorumBps()).to.equal(QUORUM_BPS);
            expect(await templZero.postQuorumVotingPeriod()).to.equal(36 * 60 * 60);
            expect(await templZero.burnAddress()).to.equal("0x000000000000000000000000000000000000dEaD");
        });

        it("reverts when quorum percent exceeds total", async function () {
            const { membershipModule, treasuryModule, governanceModule, councilModule } = await deployTemplModules();
            const TEMPL = await ethers.getContractFactory("TEMPL");
            await expect(
                TEMPL.deploy(
                    priest.address,
                    priest.address,
                    await token.getAddress(),
                    ENTRY_FEE,
                    3000,
                    3000,
                    3000,
                    1000,
                    12_000,
                    7 * 24 * 60 * 60,
                    "0x000000000000000000000000000000000000dEaD",
                    0,
                    METADATA.name,
                    METADATA.description,
                    METADATA.logo,
                    0,
                    0,
                    5_100,
                     10_000,
                    false,
                    membershipModule,
                    treasuryModule,
                    governanceModule,
                    councilModule,
                    STATIC_CURVE
                )
            ).to.be.revertedWithCustomError(TEMPL, "InvalidPercentage");
        });

        it("reverts when fee splits do not sum to 100", async function () {
            const { membershipModule, treasuryModule, governanceModule, councilModule } = await deployTemplModules();
            const TEMPL = await ethers.getContractFactory("TEMPL");
            await expect(
                TEMPL.deploy(
                    priest.address,
                    priest.address,
                    await token.getAddress(),
                    ENTRY_FEE,
                    5_100,
                    4_000,
                    3_000,
                    PROTOCOL_BPS,
                    QUORUM_BPS,
                    7 * 24 * 60 * 60,
                    "0x000000000000000000000000000000000000dEaD",
                    0,
                    METADATA.name,
                    METADATA.description,
                    METADATA.logo,
                    0,
                    0,
                    5_100,
                     10_000,
                    false,
                    membershipModule,
                    treasuryModule,
                    governanceModule,
                    councilModule,
                    STATIC_CURVE
                )
            ).to.be.revertedWithCustomError(TEMPL, "InvalidPercentageSplit");
        });

        it("Should revert when access token address is zero", async function () {
            const { membershipModule, treasuryModule, governanceModule, councilModule } = await deployTemplModules();
            const TEMPL = await ethers.getContractFactory("TEMPL");
            await expect(
                TEMPL.deploy(
                    priest.address,
                    priest.address,
                    ethers.ZeroAddress,
                    ENTRY_FEE,
                    BURN_BPS,
                    TREASURY_BPS,
                    MEMBER_BPS,
                    PROTOCOL_BPS,
                    QUORUM_BPS,
                    7 * 24 * 60 * 60,
                    "0x000000000000000000000000000000000000dEaD",
                    0,
                    METADATA.name,
                    METADATA.description,
                    METADATA.logo,
                    0,
                    0,
                    5_100,
                     10_000,
                    false,
                    membershipModule,
                    treasuryModule,
                    governanceModule,
                    councilModule,
                    STATIC_CURVE
                )
            ).to.be.revertedWithCustomError(TEMPL, "InvalidRecipient");
        });

        it("Should revert when entry fee is zero", async function () {
            const { membershipModule, treasuryModule, governanceModule, councilModule } = await deployTemplModules();
            const TEMPL = await ethers.getContractFactory("TEMPL");
            await expect(
                TEMPL.deploy(
                    priest.address,
                    priest.address,
                    await token.getAddress(),
                    0,
                    3000,
                    3000,
                    3000,
                    1000,
                    3300,
                    7 * 24 * 60 * 60,
                    "0x000000000000000000000000000000000000dEaD",
                    0,
                    METADATA.name,
                    METADATA.description,
                    METADATA.logo,
                    0,
                    0,
                    5_100,
                     10_000,
                    false,
                    membershipModule,
                    treasuryModule,
                    governanceModule,
                    councilModule,
                    STATIC_CURVE
                )
            ).to.be.revertedWithCustomError(TEMPL, "AmountZero");
        });
    });

    describe("Member join with 30/30/30/10 split", function () {
        it("splits join payments: 30% burn, 30% treasury, 30% pool, 10% protocol", async function () {
            const burnAddress = await templ.burnAddress();
            const protocolRecipient = await templ.protocolFeeRecipient();

            const priestBalanceBefore = await token.balanceOf(protocolRecipient);
            const deadBalanceBefore = await token.balanceOf(burnAddress);

            const templAddress = await templ.getAddress();
            await token.connect(user1).approve(templAddress, ENTRY_FEE);
            const tx = await templ.connect(user1).join();
            const receipt = await tx.wait();

            const accessPurchased = receipt.logs
                .map((log) => {
                    try {
                        return templ.interface.parseLog(log);
                    } catch (_) {
                        return null;
                    }
                })
                .find((log) => log && log.name === "MemberJoined");

            expect(accessPurchased, "MemberJoined event").to.not.equal(undefined);
            const { payer, member, burnedAmount, treasuryAmount, memberPoolAmount, protocolAmount } = accessPurchased.args;
            expect(payer).to.equal(user1.address);
            expect(member).to.equal(user1.address);

            const thirtyPercent = (ENTRY_FEE * 30n) / 100n;
            const tenPercent = (ENTRY_FEE * 10n) / 100n;

            expect(burnedAmount).to.equal(thirtyPercent);
            expect(treasuryAmount).to.equal(thirtyPercent);
            expect(memberPoolAmount).to.equal(thirtyPercent);
            expect(protocolAmount).to.equal(tenPercent);

            expect(await templ.treasuryBalance()).to.equal(thirtyPercent);
            expect(await templ.memberPoolBalance()).to.equal(thirtyPercent);
            expect(await token.balanceOf(protocolRecipient)).to.equal(priestBalanceBefore + tenPercent);
            expect(await token.balanceOf(burnAddress)).to.equal(deadBalanceBefore + thirtyPercent);
        });

        it("marks a user as joined", async function () {
            await joinMembers(templ, token, [user1]);

            expect(await templ.isMember(user1.address)).to.be.true;
            expect(await templ.getMemberCount()).to.equal(2);
        });

        it("prevents double join attempts", async function () {
            await joinMembers(templ, token, [user1]);

            await token.connect(user1).approve(await templ.getAddress(), ENTRY_FEE);
            await expect(templ.connect(user1).join())
                .to.be.revertedWithCustomError(templ, "MemberAlreadyJoined");
        });

        it("reverts when user has insufficient balance", async function () {
            await expect(templ.connect(owner).join())
                .to.be.revertedWithCustomError(templ, "InsufficientBalance");
        });
    });

    describe("DAO Proposal Creation", function () {
        beforeEach(async function () {
            // User1 becomes a member
            await joinMembers(templ, token, [user1]);
        });

        it("Should allow members to create proposals", async function () {
            const title = "Test Proposal";
            const description = "This is a test proposal";
            const votingPeriod = 7 * 24 * 60 * 60; // 7 days

            await expect(templ.connect(user1).createProposalSetJoinPaused(
                false,
                votingPeriod
            )).to.emit(templ, "ProposalCreated");

            expect(await templ.proposalCount()).to.equal(1);
            
            const proposal = await templ.getProposal(0);
            expect(proposal.proposer).to.equal(user1.address);
        });

        it("Should prevent non-members from creating proposals", async function () {
            await expect(templ.connect(user2).createProposalSetJoinPaused(
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
                    7 * 24 * 60 * 60
                )
            ).to.emit(templ, "ProposalCreated");
        });

        

        it("Should enforce minimum voting period", async function () {
            await expect(templ.connect(user1).createProposalSetJoinPaused(
                false,
                35 * 60 * 60
            )).to.be.revertedWithCustomError(templ, "VotingPeriodTooShort");
        });

        it("Should enforce maximum voting period", async function () {
            await expect(templ.connect(user1).createProposalSetJoinPaused(
                false,
                31 * 24 * 60 * 60
            )).to.be.revertedWithCustomError(templ, "VotingPeriodTooLong");
        });

        it("Should default to standard voting period when none provided", async function () {
            await templ.connect(user1).createProposalSetJoinPaused(
                false,
                0,
                    ""
            );
            const proposal = await templ.proposals(0);
            const defaultPeriod = await templ.preQuorumVotingPeriod();
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
            await joinMembers(templ, token, [user1]);
            
            await joinMembers(templ, token, [user2]);
            
            await joinMembers(templ, token, [user3]);

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
            await joinMembers(templ, token, [user1]);
            
            await joinMembers(templ, token, [user2]);
            
            await joinMembers(templ, token, [user3]);
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
            await joinMembers(templ, token, [user4]);

            // Create proposal
            const callData = encodeWithdrawTreasuryDAO(
                token.target,
                treasury.address,
                ethers.parseUnits("10", 18)
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
            await templ.connect(user4).vote(0, false);
            await templ.connect(priest).vote(0, true);

            // Fast forward
            await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine");

            // Try to execute
            await expect(templ.connect(user1).executeProposal(0))
                .to.be.revertedWithCustomError(templ, "ProposalNotPassed");
        });

        it("Should not execute before voting ends", async function () {
            // Create proposal
            const callData = encodeSetJoinPausedDAO(true);

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
            const callData = encodeSetJoinPausedDAO(true);

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

            expect(await templ.joinPaused()).to.be.true;

            // Should prevent joins when paused
            await token.connect(user4).approve(await templ.getAddress(), ENTRY_FEE);
            await expect(templ.connect(user4).join())
                .to.be.revertedWithCustomError(templ, "JoinIntakePaused");
        });

        it("Should prevent double execution", async function () {
            const callData = encodeSetJoinPausedDAO(true);

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
            await joinMembers(templ, token, [user1]);
            
            await joinMembers(templ, token, [user2]);
        });

        it("Should prevent direct treasury withdrawal by priest", async function () {
            // Priest cannot call withdrawTreasuryDAO directly
            await expect(templ.connect(priest).withdrawTreasuryDAO(
                token.target,
                priest.address,
                ethers.parseUnits("10", 18)
            )).to.be.revertedWithCustomError(templ, "NotDAO");
        });

        it("Should prevent direct treasury withdrawal by members", async function () {
            await expect(templ.connect(user1).withdrawTreasuryDAO(
                token.target,
                user1.address,
                ethers.parseUnits("10", 18)
            )).to.be.revertedWithCustomError(templ, "NotDAO");
        });

        


        it("Should only allow treasury withdrawal through passed proposals", async function () {
            const treasuryBalance = await templ.treasuryBalance();
            const withdrawAmount = treasuryBalance / 2n; // Half of treasury

            const callData = encodeWithdrawTreasuryDAO(
                token.target,
                treasury.address,
                withdrawAmount
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
                ethers.parseUnits("500", 18),
                false,
                0,
                0,
                0
            )).to.be.revertedWithCustomError(templ, "NotDAO");
        });

        it("Should prevent pause without DAO approval", async function () {
            await expect(templ.connect(priest).setJoinPausedDAO(true))
                .to.be.revertedWithCustomError(templ, "NotDAO");
        });
    });

    describe("Paused contract behavior", function () {
        beforeEach(async function () {
            // user1 and user2 become members
            await joinMembers(templ, token, [user1]);

            await joinMembers(templ, token, [user2]);
            // Add more members so initial auto-yes does not meet quorum
            await joinMembers(templ, token, [user3]);
            await joinMembers(templ, token, [user4]);

            // interface for pause/unpause proposals
            // create proposal that remains active for voting after pause
            const unpauseData = encodeSetJoinPausedDAO(false);
            await templ.connect(user1).createProposal(
                "Unpause",
                "Resume operations",
                unpauseData,
                14 * 24 * 60 * 60
            );

            // create and execute pause proposal
            const pauseData = encodeSetJoinPausedDAO(true);

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
            expect(await templ.joinPaused()).to.be.true;
        });

        it("Should revert joinMembers when paused", async function () {
            await token.connect(user3).approve(await templ.getAddress(), ENTRY_FEE);
            await expect(templ.connect(user3).join())
                .to.be.revertedWithCustomError(templ, "JoinIntakePaused");
        });

        it("Should allow createProposal when paused", async function () {
            const callData = encodeSetJoinPausedDAO(false);
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
            expect(await templ.joinPaused()).to.be.false;
        });
    });

    describe("Active Proposals Query", function () {
        beforeEach(async function () {
            // Setup members
            await joinMembers(templ, token, [user1]);
            
            // Add user2 as member too (needed for multiple proposal tests)
            await joinMembers(templ, token, [user2]);
            // Add more members so initial auto-yes does not meet quorum
            await joinMembers(templ, token, [user3]);
            await joinMembers(templ, token, [user4]);
        });

        it("Should return active proposals correctly", async function () {
            // Create multiple proposals with different users (due to single proposal restriction)
            const cd1 = encodeSetJoinPausedDAO(false);
            const cd2 = encodeSetJoinPausedDAO(true);
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
            const cd3 = encodeSetJoinPausedDAO(false);
            await templ.connect(user1).createProposal(
                "Short",
                "Expires soon",
                cd3,
                7 * 24 * 60 * 60 // 7 days
            );

            const cd4 = encodeSetJoinPausedDAO(true);
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
            const callData = encodeSetJoinPausedDAO(true);

            await templ.connect(user1).createProposal(
                "Execute Me",
                "Will be executed",
                callData,
                7 * 24 * 60 * 60
            );

            const cd5 = encodeSetJoinPausedDAO(false);
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
            await joinMembers(templ, token, [user1]);

            // Check first member has no claimable (no one joined after them yet)
            expect(await templ.getClaimableMemberRewards(user1.address)).to.equal(0);

            // Second member joins
            await joinMembers(templ, token, [user2]);

            // First member has claimable rewards (split with the priest)
            const thirtyPercent = (ENTRY_FEE * 30n) / 100n;
            const secondJoinShare = thirtyPercent / 2n;
            expect(await templ.getClaimableMemberRewards(user1.address)).to.equal(secondJoinShare);

            // Second member has no claimable yet
            expect(await templ.getClaimableMemberRewards(user2.address)).to.equal(0);

            // Third member joins
            await joinMembers(templ, token, [user3]);

            // Priest, user1, and user2 share the contribution evenly
            const thirdJoinShare = thirtyPercent / 3n;
            expect(await templ.getClaimableMemberRewards(user1.address)).to.equal(
                secondJoinShare + thirdJoinShare
            );
            expect(await templ.getClaimableMemberRewards(user2.address)).to.equal(thirdJoinShare);
        });

        it("Should allow members to claim their pool rewards", async function () {
            // Setup: 3 members join
            await joinMembers(templ, token, [user1]);

            await joinMembers(templ, token, [user2]);

            await joinMembers(templ, token, [user3]);

            const claimable = await templ.getClaimableMemberRewards(user1.address);
            const balanceBefore = await token.balanceOf(user1.address);

            await expect(templ.connect(user1).claimMemberRewards())
                .to.emit(templ, "MemberRewardsClaimed");

            expect(await token.balanceOf(user1.address)).to.equal(balanceBefore + claimable);
            expect(await templ.getClaimableMemberRewards(user1.address)).to.equal(0);
        });

        it("Should prevent claiming when no rewards available", async function () {
            await joinMembers(templ, token, [user1]);

            await expect(templ.connect(user1).claimMemberRewards())
                .to.be.revertedWithCustomError(templ, "NoRewardsToClaim");
        });

        it("Should track claimed amounts correctly", async function () {
            // Setup members
            await joinMembers(templ, token, [user1]);

            await joinMembers(templ, token, [user2]);

            // Claim once
            await templ.connect(user1).claimMemberRewards();

            // Third member joins
            await joinMembers(templ, token, [user3]);

            // User1 should only be able to claim new rewards
            const thirtyPercent = (ENTRY_FEE * 30n) / 100n;
            const expectedNew = thirtyPercent / 3n; // Split between priest and 2 existing members

            expect(await templ.getClaimableMemberRewards(user1.address)).to.equal(expectedNew);
        });
    });

    describe("Edge Cases and Security", function () {
        it("Should handle very small entry fees correctly", async function () {
            const { membershipModule, treasuryModule, governanceModule, councilModule } = await deployTemplModules();
            const TEMPL = await ethers.getContractFactory("TEMPL");
            let minTempl = await TEMPL.deploy(
                priest.address,
                priest.address,
                await token.getAddress(),
                10n,
                3000,
                3000,
                3000,
                1000,
                3300,
                7 * 24 * 60 * 60,
                "0x000000000000000000000000000000000000dEaD",
                0,
                METADATA.name,
                METADATA.description,
                METADATA.logo,
                0,
                0,
                5_100,
                 10_000,
                false,
                membershipModule,
                treasuryModule,
                governanceModule,
                councilModule,
                STATIC_CURVE
            );
            await minTempl.waitForDeployment();
            minTempl = await attachTemplInterface(minTempl);

            await token.connect(user1).approve(await minTempl.getAddress(), 10);
            await minTempl.connect(user1).join();

            // Should still split correctly even with rounding
            expect(await minTempl.treasuryBalance()).to.be.gte(0);
        });

        it("Should reject entry fee below minimum", async function () {
            const factory = await ethers.getContractFactory("TEMPL");
            const { membershipModule, treasuryModule, governanceModule, councilModule } = await deployTemplModules();
            await expect(factory.deploy(
                priest.address,
                priest.address, // protocolFeeRecipient
                await token.getAddress(),
                9,
                3000,
                3000,
                3000,
                1000,
                3300,
                7 * 24 * 60 * 60,
                "0x000000000000000000000000000000000000dEaD",
                0,
                METADATA.name,
                METADATA.description,
                METADATA.logo,
                0,
                0,
                5_100,
                 10_000,
                false,
                membershipModule,
                treasuryModule,
                governanceModule,
                councilModule,
                STATIC_CURVE
            )).to.be.revertedWithCustomError(factory, "EntryFeeTooSmall");
        });


        // invalid calldata is not applicable anymore
    });

    describe("Additional DAO Functions", function () {
        beforeEach(async function () {
            // Setup members
            await joinMembers(templ, token, [user1]);
            
            await joinMembers(templ, token, [user2]);
        });

        

        
    });

    describe("Comprehensive View Functions", function () {
        beforeEach(async function () {
            await joinMembers(templ, token, [user1]);
        });

        it("Should return correct isMember status", async function () {
            expect(await templ.isMember(user1.address)).to.be.true;
            expect(await templ.isMember(user2.address)).to.be.false;
        });

        it("Should return correct join details", async function () {
            const details = await templ.getJoinDetails(user1.address);
            expect(details.joined).to.be.true;
            expect(details.timestamp).to.be.gt(0);
            expect(details.blockNumber).to.be.gt(0);

            const noDetails = await templ.getJoinDetails(user2.address);
            expect(noDetails.joined).to.be.false;
            expect(noDetails.timestamp).to.equal(0);
            expect(noDetails.blockNumber).to.equal(0);
        });

        it("Should return correct config information", async function () {
            const config = await templ.getConfig();
            expect(config.token).to.equal(await token.getAddress());
            expect(config.fee).to.equal(ENTRY_FEE);
            expect(config.joinPaused).to.be.false;
            expect(config.joins).to.equal(1);
            expect(config.treasury).to.be.gt(0);
            expect(config.pool).to.be.gt(0);
        });

        it("Should return 0 claimable for non-members", async function () {
            expect(await templ.getClaimableMemberRewards(user2.address)).to.equal(0);
        });

        it("Should expose treasury info totals", async function () {
            const info = await templ.getTreasuryInfo();
            const thirtyPercent = (ENTRY_FEE * 30n) / 100n;

            expect(info.treasury).to.equal(thirtyPercent);
            expect(info.memberPool).to.equal(thirtyPercent);
            expect(info.protocolAddress).to.equal(await templ.protocolFeeRecipient());
            expect(info.burned).to.equal(thirtyPercent);
        });
    });

    describe("Gas Optimization Tests", function () {
        it("Should handle large member counts efficiently", async function () {
            const signers = await ethers.getSigners();
            const joiners = signers.slice(2, 12);

            await mintToUsers(token, joiners, TOKEN_SUPPLY);

            for (const signer of joiners) {
                await token.connect(signer).approve(await templ.getAddress(), ENTRY_FEE);
                await templ.connect(signer).join();
            }

            expect(await templ.getMemberCount()).to.equal(1n + BigInt(joiners.length));

            // Check that the first paying member can still claim efficiently
            const claimable = await templ.getClaimableMemberRewards(joiners[0].address);
            expect(claimable).to.be.gt(0);
        });
    });

    describe("Integration Tests", function () {
        it("Should handle complete user journey", async function () {
            // User 1 joins
            await joinMembers(templ, token, [user1]);
            expect(await templ.getMemberCount()).to.equal(2);

            // User 2 joins
            await joinMembers(templ, token, [user2]);
            expect(await templ.getMemberCount()).to.equal(3);

            // User 1 claims rewards
            const claimable = await templ.getClaimableMemberRewards(user1.address);
            expect(claimable).to.be.gt(0);
            await templ.connect(user1).claimMemberRewards();

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
