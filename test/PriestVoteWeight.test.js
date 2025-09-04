const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const templInterface = require("./utils/templInterface");

describe("Priest Vote Weight Feature", function () {
    let templ;
    let token;
    let owner, priest, member1, member2, member3, member4, member5, member6, member7, member8, member9, member10;
    let accounts;
    const ENTRY_FEE = ethers.parseUnits("100", 18);
    const TOKEN_SUPPLY = ethers.parseUnits("10000", 18);
    const PRIEST_VOTE_WEIGHT = 10;
    const PRIEST_WEIGHT_THRESHOLD = 10;

    beforeEach(async function () {
        ({ templ, token, accounts } = await deployTempl({
            entryFee: ENTRY_FEE,
            priestVoteWeight: PRIEST_VOTE_WEIGHT,
            priestWeightThreshold: PRIEST_WEIGHT_THRESHOLD,
        }));
        [owner, priest, member1, member2, member3, member4, member5, member6, member7, member8, member9, member10] = accounts;

        await token.mint(priest.address, TOKEN_SUPPLY);
        await token.mint(member1.address, TOKEN_SUPPLY);
        await token.mint(member2.address, TOKEN_SUPPLY);
        await token.mint(member3.address, TOKEN_SUPPLY);
        await token.mint(member4.address, TOKEN_SUPPLY);
        await token.mint(member5.address, TOKEN_SUPPLY);
        await token.mint(member6.address, TOKEN_SUPPLY);
        await token.mint(member7.address, TOKEN_SUPPLY);
        await token.mint(member8.address, TOKEN_SUPPLY);
        await token.mint(member9.address, TOKEN_SUPPLY);
        await token.mint(member10.address, TOKEN_SUPPLY);
    });

    describe("Configuration", function () {
        it("Should set priest vote weight correctly", async function () {
            expect(await templ.priestVoteWeight()).to.equal(PRIEST_VOTE_WEIGHT);
        });

        it("Should set priest weight threshold correctly", async function () {
            expect(await templ.priestWeightThreshold()).to.equal(PRIEST_WEIGHT_THRESHOLD);
        });
    });

    describe("Vote Weight Calculation", function () {
        it("Should give priest weight 10 when members < threshold", async function () {
            // Only priest joins initially
            await token.connect(priest).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(priest).purchaseAccess();

            expect(await templ.getVoteWeight(priest.address)).to.equal(PRIEST_VOTE_WEIGHT);
        });

        it("Should give priest weight 10 with 9 total members", async function () {
            // Priest and 8 other members join (total 9, below threshold of 10)
            await token.connect(priest).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(priest).purchaseAccess();

            await token.connect(member1).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member1).purchaseAccess();
            
            await token.connect(member2).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member2).purchaseAccess();
            
            await token.connect(member3).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member3).purchaseAccess();
            
            await token.connect(member4).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member4).purchaseAccess();
            
            await token.connect(member5).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member5).purchaseAccess();
            
            await token.connect(member6).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member6).purchaseAccess();
            
            await token.connect(member7).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member7).purchaseAccess();
            
            await token.connect(member8).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member8).purchaseAccess();

            expect(await templ.getMemberCount()).to.equal(9);
            expect(await templ.getVoteWeight(priest.address)).to.equal(PRIEST_VOTE_WEIGHT);
            expect(await templ.getVoteWeight(member1.address)).to.equal(1);
        });

        it("Should give priest weight 1 when members >= threshold", async function () {
            // Priest and 9 other members join (total 10, at threshold)
            await token.connect(priest).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(priest).purchaseAccess();

            await token.connect(member1).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member1).purchaseAccess();
            
            await token.connect(member2).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member2).purchaseAccess();
            
            await token.connect(member3).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member3).purchaseAccess();
            
            await token.connect(member4).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member4).purchaseAccess();
            
            await token.connect(member5).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member5).purchaseAccess();
            
            await token.connect(member6).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member6).purchaseAccess();
            
            await token.connect(member7).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member7).purchaseAccess();
            
            await token.connect(member8).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member8).purchaseAccess();
            
            await token.connect(member9).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member9).purchaseAccess();

            expect(await templ.getMemberCount()).to.equal(10);
            expect(await templ.getVoteWeight(priest.address)).to.equal(1);
            expect(await templ.getVoteWeight(member1.address)).to.equal(1);
        });

        it("Should return 0 weight for non-members", async function () {
            expect(await templ.getVoteWeight(member1.address)).to.equal(0);
        });
    });

    describe("Voting with Priest Weight", function () {
        it("Should apply priest weight in voting when below threshold", async function () {
            // Only priest and one member join (2 total, below threshold)
            await token.connect(priest).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(priest).purchaseAccess();
            
            await token.connect(member1).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member1).purchaseAccess();

            // Create proposal
                        const callData = templInterface.encodeFunctionData("setPausedDAO", [true]);

            await templ.connect(priest).createProposal(
                "Test Proposal",
                "Testing priest weight",
                callData,
                7 * 24 * 60 * 60
            );

            // Wait a bit for voting
            await ethers.provider.send("evm_increaseTime", [10]);
            await ethers.provider.send("evm_mine");

            // Priest votes yes (weight 10), member votes no (weight 1)
            await templ.connect(priest).vote(0, true);
            await templ.connect(member1).vote(0, false);

            let proposal = await templ.getProposal(0);
            expect(proposal.yesVotes).to.equal(10); // Priest's weighted vote
            expect(proposal.noVotes).to.equal(1);   // Member's regular vote

            // Voting period still active
            expect(proposal.passed).to.be.false;

            // Fast forward past voting period
            await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine");

            proposal = await templ.getProposal(0);
            expect(proposal.passed).to.be.true;
        });

        it("Should use normal weight for priest when at threshold", async function () {
            // Join 10 members total
            const members = [priest, member1, member2, member3, member4, member5, member6, member7, member8, member9];
            
            for (const member of members) {
                await token.connect(member).approve(await templ.getAddress(), ENTRY_FEE);
                await templ.connect(member).purchaseAccess();
            }

            expect(await templ.getMemberCount()).to.equal(10);

            // Create proposal
                        const callData = templInterface.encodeFunctionData("setPausedDAO", [true]);

            await templ.connect(priest).createProposal(
                "Test Proposal",
                "Testing priest normal weight",
                callData,
                7 * 24 * 60 * 60
            );

            // Wait a bit for voting
            await ethers.provider.send("evm_increaseTime", [10]);
            await ethers.provider.send("evm_mine");

            // Priest votes yes (weight 1), member1 votes no (weight 1)
            await templ.connect(priest).vote(0, true);
            await templ.connect(member1).vote(0, false);

            const proposal = await templ.getProposal(0);
            expect(proposal.yesVotes).to.equal(1); // Priest's normal vote
            expect(proposal.noVotes).to.equal(1);  // Member's vote

            // Tie means proposal fails
            expect(proposal.passed).to.be.false;
        });

        it("Should allow priest to outvote multiple members when below threshold", async function () {
            // Priest and 5 members join (6 total, below threshold of 10)
            await token.connect(priest).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(priest).purchaseAccess();
            
            const membersToJoin = [member1, member2, member3, member4, member5];
            for (const member of membersToJoin) {
                await token.connect(member).approve(await templ.getAddress(), ENTRY_FEE);
                await templ.connect(member).purchaseAccess();
            }

            // Create proposal
                        const callData = templInterface.encodeFunctionData("withdrawTreasuryDAO", [
                priest.address,
                ethers.parseUnits("10", 18),
                "Priest withdrawal"
            ]);

            await templ.connect(priest).createProposal(
                "Priest Withdrawal",
                "Withdraw to priest",
                callData,
                7 * 24 * 60 * 60
            );

            // Wait a bit for voting
            await ethers.provider.send("evm_increaseTime", [10]);
            await ethers.provider.send("evm_mine");

            // Priest votes yes (weight 10)
            await templ.connect(priest).vote(0, true);
            
            // 5 members vote no (weight 1 each = 5 total)
            for (const member of membersToJoin) {
                await templ.connect(member).vote(0, false);
            }

            let proposal = await templ.getProposal(0);
            expect(proposal.yesVotes).to.equal(10); // Priest's weighted vote
            expect(proposal.noVotes).to.equal(5);   // 5 members' votes

            // Voting period still active
            expect(proposal.passed).to.be.false;

            // Fast forward past voting period
            await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine");

            proposal = await templ.getProposal(0);
            // Proposal should pass (10 > 5)
            expect(proposal.passed).to.be.true;
        });
    });

    describe("Custom Weight Configuration", function () {
        it("Should work with different weight values", async function () {
            // Deploy with custom weights
            const customWeight = 5;
            const customThreshold = 3;
            
            const TEMPL = await ethers.getContractFactory("TEMPL");
            const customTempl = await TEMPL.deploy(
                priest.address,
                priest.address, // protocolFeeRecipient
                await token.getAddress(),
                ENTRY_FEE,
                customWeight,
                customThreshold
            );
            await customTempl.waitForDeployment();

            // Join priest and 2 members (below threshold of 3)
            await token.connect(priest).approve(await customTempl.getAddress(), ENTRY_FEE);
            await customTempl.connect(priest).purchaseAccess();
            
            await token.connect(member1).approve(await customTempl.getAddress(), ENTRY_FEE);
            await customTempl.connect(member1).purchaseAccess();

            expect(await customTempl.getVoteWeight(priest.address)).to.equal(customWeight);

            // Add one more member to reach threshold
            await token.connect(member2).approve(await customTempl.getAddress(), ENTRY_FEE);
            await customTempl.connect(member2).purchaseAccess();

            expect(await customTempl.getMemberCount()).to.equal(customThreshold);
            expect(await customTempl.getVoteWeight(priest.address)).to.equal(1);
        });
    });
});