const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Member Pool Distribution - Exhaustive Tests", function () {
    let templ;
    let token;
    let owner, priest, member1, member2, member3, member4, member5;
    const ENTRY_FEE = ethers.parseUnits("100", 18);
    const TOKEN_SUPPLY = ethers.parseUnits("10000", 18);

    beforeEach(async function () {
        [owner, priest, member1, member2, member3, member4, member5] = await ethers.getSigners();

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
        await token.mint(member5.address, TOKEN_SUPPLY);
    });

    describe("Pool Distribution Formula Validation", function () {
        const thirtyPercent = (ENTRY_FEE * 30n) / 100n;
        const fifteenPercent = thirtyPercent / 2n;
        const tenPercent = thirtyPercent / 3n;

        const scenarios = [
            {
                joiners: [() => member1],
                expectedShares: [0n],
            },
            {
                joiners: [() => member1, () => member2],
                expectedShares: [thirtyPercent, 0n],
            },
            {
                joiners: [() => member1, () => member2, () => member3],
                expectedShares: [thirtyPercent + fifteenPercent, fifteenPercent, 0n],
            },
            {
                joiners: [() => member1, () => member2, () => member3, () => member4],
                expectedShares: [thirtyPercent + fifteenPercent + tenPercent, fifteenPercent + tenPercent, tenPercent, 0n],
            },
        ];

        for (const { joiners, expectedShares } of scenarios) {
            it(`distributes rewards correctly with ${joiners.length} joiner(s)`, async function () {
                for (const getMember of joiners) {
                    const member = getMember();
                    await token.connect(member).approve(await templ.getAddress(), ENTRY_FEE);
                    await templ.connect(member).purchaseAccess();
                }

                const claimable = await Promise.all(
                    joiners.map(getMember => templ.getClaimablePoolAmount(getMember().address))
                );

                expect(claimable).to.deep.equal(expectedShares);
            });
        }
    });

    describe("Cumulative Rewards Testing", function () {
        it("Should track cumulative rewards correctly without claiming", async function () {
            // Member 1 joins
            await token.connect(member1).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member1).purchaseAccess();

            // Member 2 joins - Member 1 gets 30%
            await token.connect(member2).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member2).purchaseAccess();

            const thirtyPercent = (ENTRY_FEE * 30n) / 100n;
            let claimable1 = await templ.getClaimablePoolAmount(member1.address);
            expect(claimable1).to.equal(thirtyPercent);

            // Member 3 joins - Member 1 and 2 each get 15%
            await token.connect(member3).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member3).purchaseAccess();

            const fifteenPercent = thirtyPercent / 2n;
            claimable1 = await templ.getClaimablePoolAmount(member1.address);
            let claimable2 = await templ.getClaimablePoolAmount(member2.address);
            
            // Member 1 should have: 30% from member 2 + 15% from member 3
            expect(claimable1).to.equal(thirtyPercent + fifteenPercent);
            // Member 2 should have: 15% from member 3
            expect(claimable2).to.equal(fifteenPercent);

            // Member 4 joins - Members 1, 2, 3 each get 10%
            await token.connect(member4).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member4).purchaseAccess();

            const tenPercent = thirtyPercent / 3n;
            claimable1 = await templ.getClaimablePoolAmount(member1.address);
            claimable2 = await templ.getClaimablePoolAmount(member2.address);
            let claimable3 = await templ.getClaimablePoolAmount(member3.address);
            
            // Member 1: 30% + 15% + 10%
            expect(claimable1).to.equal(thirtyPercent + fifteenPercent + tenPercent);
            // Member 2: 15% + 10%
            expect(claimable2).to.equal(fifteenPercent + tenPercent);
            // Member 3: 10%
            expect(claimable3).to.equal(tenPercent);
            
        });
    });

    describe("Claiming and Balance Verification", function () {
        it("Should allow members to claim exact amounts and update balances correctly", async function () {
            // Setup: 4 members join
            await token.connect(member1).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member1).purchaseAccess();
            
            await token.connect(member2).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member2).purchaseAccess();
            
            await token.connect(member3).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member3).purchaseAccess();
            
            await token.connect(member4).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member4).purchaseAccess();

            // Calculate expected amounts
            const thirtyPercent = (ENTRY_FEE * 30n) / 100n;
            const fifteenPercent = thirtyPercent / 2n;
            const tenPercent = thirtyPercent / 3n;

            // Expected claimable:
            // Member 1: 30% + 15% + 10%
            // Member 2: 15% + 10%  
            // Member 3: 10%
            // Member 4: 0

            // Verify pool balance before claims
            const initialPoolBalance = await templ.memberPoolBalance();
            expect(initialPoolBalance).to.equal(thirtyPercent * 4n); // 4 members × 30%

            // Member 1 claims
            const balance1Before = await token.balanceOf(member1.address);
            const claimable1 = await templ.getClaimablePoolAmount(member1.address);
            await templ.connect(member1).claimMemberPool();
            const balance1After = await token.balanceOf(member1.address);
            
            expect(balance1After - balance1Before).to.equal(claimable1);
            expect(await templ.getClaimablePoolAmount(member1.address)).to.equal(0);

            // Member 2 claims
            const balance2Before = await token.balanceOf(member2.address);
            const claimable2 = await templ.getClaimablePoolAmount(member2.address);
            await templ.connect(member2).claimMemberPool();
            const balance2After = await token.balanceOf(member2.address);
            
            expect(balance2After - balance2Before).to.equal(claimable2);
            expect(await templ.getClaimablePoolAmount(member2.address)).to.equal(0);

            // Member 3 claims
            const balance3Before = await token.balanceOf(member3.address);
            const claimable3 = await templ.getClaimablePoolAmount(member3.address);
            await templ.connect(member3).claimMemberPool();
            const balance3After = await token.balanceOf(member3.address);
            
            expect(balance3After - balance3Before).to.equal(claimable3);
            expect(await templ.getClaimablePoolAmount(member3.address)).to.equal(0);

            // Verify final pool balance
            const finalPoolBalance = await templ.memberPoolBalance();
            const totalClaimed = claimable1 + claimable2 + claimable3;
            expect(finalPoolBalance).to.equal(initialPoolBalance - totalClaimed);

        });
    });

    describe("Edge Cases and Rounding", function () {
        it("Should handle rounding correctly when pool doesn't divide evenly", async function () {
            // Use an entry fee that doesn't divide evenly
            const ODD_FEE = ethers.parseUnits("101", 18);
            
            // Deploy new contract with odd fee
            const TEMPL = await ethers.getContractFactory("TEMPL");
            const oddTempl = await TEMPL.deploy(
                priest.address,
                priest.address, // protocolFeeRecipient
                await token.getAddress(),
                ODD_FEE,
                10, // priestVoteWeight
                10  // priestWeightThreshold
            );
            await oddTempl.waitForDeployment();

            // Setup 3 members
            await token.connect(member1).approve(await oddTempl.getAddress(), ODD_FEE);
            await oddTempl.connect(member1).purchaseAccess();
            
            await token.connect(member2).approve(await oddTempl.getAddress(), ODD_FEE);
            await oddTempl.connect(member2).purchaseAccess();
            
            await token.connect(member3).approve(await oddTempl.getAddress(), ODD_FEE);
            await oddTempl.connect(member3).purchaseAccess();
            
            // Clear claims
            await oddTempl.connect(member1).claimMemberPool();
            await oddTempl.connect(member2).claimMemberPool();

            // Member 4 joins - pool is 30.3 tokens (30% of 101)
            await token.connect(member4).approve(await oddTempl.getAddress(), ODD_FEE);
            await oddTempl.connect(member4).purchaseAccess();

            // 30% of 101 = 30.3, divided by 3 = 10.1 each (but Solidity rounds down)
            const thirtyPercent = (ODD_FEE * 30n) / 100n; // 30.3
            const perMember = thirtyPercent / 3n; // 10.1 -> 10 (rounds down)
            
            const claimable1 = await oddTempl.getClaimablePoolAmount(member1.address);
            const claimable2 = await oddTempl.getClaimablePoolAmount(member2.address);
            const claimable3 = await oddTempl.getClaimablePoolAmount(member3.address);
            
            // Each should get the rounded down amount
            expect(claimable1).to.equal(perMember);
            expect(claimable2).to.equal(perMember);
            expect(claimable3).to.equal(perMember);
            
            // Some dust may remain in the pool due to rounding
            const totalClaimable = claimable1 + claimable2 + claimable3;
            const dust = thirtyPercent - totalClaimable;
            
        });

        it("Should prevent claims when member hasn't purchased", async function () {
            await expect(templ.connect(member1).claimMemberPool())
                .to.be.revertedWithCustomError(templ, "NotMember");
        });

        it("Should handle partial claims correctly", async function () {
            // Setup 3 members
            await token.connect(member1).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member1).purchaseAccess();
            
            await token.connect(member2).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member2).purchaseAccess();
            
            await token.connect(member3).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member3).purchaseAccess();

            // Member 1 claims their rewards from member 2
            await templ.connect(member1).claimMemberPool();
            
            // Member 4 joins
            await token.connect(member4).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member4).purchaseAccess();

            // Member 1 should only get their share from member 4 (not double claim from member 2 & 3)
            const thirtyPercent = (ENTRY_FEE * 30n) / 100n;
            const tenPercent = thirtyPercent / 3n;
            
            const claimable1 = await templ.getClaimablePoolAmount(member1.address);
            expect(claimable1).to.equal(tenPercent); // Only from member 4
            
        });
    });

    describe("Pool Balance Integrity", function () {
        it("Should maintain pool balance integrity through all operations", async function () {
            let expectedPoolBalance = 0n;
            const thirtyPercent = (ENTRY_FEE * 30n) / 100n;

            // Member 1 joins - adds 30% to pool
            await token.connect(member1).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member1).purchaseAccess();
            expectedPoolBalance += thirtyPercent;
            expect(await templ.memberPoolBalance()).to.equal(expectedPoolBalance);

            // Member 2 joins - adds 30% to pool
            await token.connect(member2).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member2).purchaseAccess();
            expectedPoolBalance += thirtyPercent;
            expect(await templ.memberPoolBalance()).to.equal(expectedPoolBalance);

            // Member 1 claims 30%
            await templ.connect(member1).claimMemberPool();
            expectedPoolBalance -= thirtyPercent;
            expect(await templ.memberPoolBalance()).to.equal(expectedPoolBalance);

            // Member 3 joins - adds 30% to pool
            await token.connect(member3).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member3).purchaseAccess();
            expectedPoolBalance += thirtyPercent;
            expect(await templ.memberPoolBalance()).to.equal(expectedPoolBalance);

            // Members 1 and 2 claim their 15% each
            const fifteenPercent = thirtyPercent / 2n;
            await templ.connect(member1).claimMemberPool();
            expectedPoolBalance -= fifteenPercent;
            expect(await templ.memberPoolBalance()).to.equal(expectedPoolBalance);

            await templ.connect(member2).claimMemberPool();
            expectedPoolBalance -= fifteenPercent;
            expect(await templ.memberPoolBalance()).to.equal(expectedPoolBalance);

        });
    });

    describe("memberPoolClaims tracking", function () {
        it("Should accumulate total claimed rewards across multiple claims", async function () {
            // Initial member joins
            await token.connect(member1).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member1).purchaseAccess();

            let totalClaimed = 0n;

            // Member 2 joins and member 1 claims 30%
            await token.connect(member2).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member2).purchaseAccess();
            let claimable = await templ.getClaimablePoolAmount(member1.address);
            await templ.connect(member1).claimMemberPool();
            totalClaimed += claimable;
            expect(await templ.memberPoolClaims(member1.address)).to.equal(totalClaimed);

            // Member 3 joins and member 1 claims an additional 15%
            await token.connect(member3).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member3).purchaseAccess();
            claimable = await templ.getClaimablePoolAmount(member1.address);
            await templ.connect(member1).claimMemberPool();
            totalClaimed += claimable;
            expect(await templ.memberPoolClaims(member1.address)).to.equal(totalClaimed);

            // Member 4 joins and member 1 claims a final 10%
            await token.connect(member4).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member4).purchaseAccess();
            claimable = await templ.getClaimablePoolAmount(member1.address);
            await templ.connect(member1).claimMemberPool();
            totalClaimed += claimable;
            expect(await templ.memberPoolClaims(member1.address)).to.equal(totalClaimed);
        });
    });

    describe("DAO Sweep Impact", function () {
        it("Should revert claim after DAO sweeps remaining pool balance", async function () {
            // Two members join to generate pool rewards
            await token.connect(member1).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member1).purchaseAccess();

            await token.connect(member2).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member2).purchaseAccess();

            const claimable = await templ.getClaimablePoolAmount(member1.address);
            expect(claimable).to.be.gt(0);

            // DAO sweeps remaining pool balance
            const callData = templ.interface.encodeFunctionData(
                "sweepMemberRewardRemainderDAO",
                [priest.address]
            );
            await templ.connect(member1).createProposal(
                "Sweep Pool",
                "drain pool balance",
                callData,
                7 * 24 * 60 * 60
            );
            await templ.connect(member1).vote(0, true);
            await templ.connect(member2).vote(0, true);
            await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
            await ethers.provider.send("evm_mine");
            await templ.executeProposal(0);

            expect(await templ.memberPoolBalance()).to.equal(0);
            expect(await templ.getClaimablePoolAmount(member1.address)).to.equal(claimable);

            await expect(templ.connect(member1).claimMemberPool())
                .to.be.revertedWithCustomError(templ, "InsufficientPoolBalance");
        });
    });
});
