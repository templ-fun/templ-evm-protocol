const { expect } = require("chai");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, joinMembers } = require("./utils/mintAndPurchase");
const { encodeSweepMemberRewardRemainderDAO } = require("./utils/callDataBuilders");

describe("Member Pool Distribution - Exhaustive Tests", function () {
    let templ;
    let token;
    let owner, priest, member1, member2, member3, member4, member5;
    let accounts;
    const ENTRY_FEE = ethers.parseUnits("100", 18);
    const TOKEN_SUPPLY = ethers.parseUnits("10000", 18);
    const BURN_BPS = 3000;
    const TREASURY_BPS = 3000;
    const MEMBER_BPS = 3000;
    const PROTOCOL_BPS = 1000;
    const QUORUM_BPS = 3300;

    beforeEach(async function () {
        ({ templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE }));
        [owner, priest, member1, member2, member3, member4, member5] = accounts;

        await mintToUsers(token, [member1, member2, member3, member4, member5], TOKEN_SUPPLY);
    });

    describe("Pool Distribution Formula Validation", function () {
        const thirtyPercent = (ENTRY_FEE * 30n) / 100n;

        it("SCENARIO 1: Priest is auto-enrolled and receives the initial pool allocation", async function () {
            expect(await templ.getMemberCount()).to.equal(1n);

            await token.connect(member1).approve(await templ.getAddress(), ethers.MaxUint256);
            await templ.connect(member1).join();

            expect(await templ.getMemberCount()).to.equal(2n);

            const priestClaimable = await templ.getClaimableMemberRewards(priest.address);
            const member1Claimable = await templ.getClaimableMemberRewards(member1.address);

            expect(priestClaimable).to.equal(thirtyPercent);
            expect(member1Claimable).to.equal(0n);

            expect(await templ.memberPoolBalance()).to.equal(thirtyPercent);

            console.log("✅ Priest starts as the sole member and accrues the first pool share");
        });

        it("SCENARIO 2: Second payer splits their pool share between the priest and first payer", async function () {
            const templAddress = await templ.getAddress();

            await token.connect(member1).approve(templAddress, ENTRY_FEE);
            await templ.connect(member1).join();

            await templ.connect(priest).claimMemberRewards();

            await token.connect(member2).approve(templAddress, ENTRY_FEE);
            await templ.connect(member2).join();

            const expectedSplit = thirtyPercent / 2n;

            expect(await templ.getClaimableMemberRewards(priest.address)).to.equal(expectedSplit);
            expect(await templ.getClaimableMemberRewards(member1.address)).to.equal(expectedSplit);
            expect(await templ.getClaimableMemberRewards(member2.address)).to.equal(0n);

            console.log("✅ Pool splits evenly between priest and first payer once a second payer arrives");
        });

        it("SCENARIO 3: Third payer splits their pool share between priest and two paid members", async function () {
            const templAddress = await templ.getAddress();

            await token.connect(member1).approve(templAddress, ENTRY_FEE);
            await templ.connect(member1).join();

            await token.connect(member2).approve(templAddress, ENTRY_FEE);
            await templ.connect(member2).join();

            await templ.connect(priest).claimMemberRewards();
            await templ.connect(member1).claimMemberRewards();

            await token.connect(member3).approve(templAddress, ENTRY_FEE);
            await templ.connect(member3).join();

            const expectedShare = thirtyPercent / 3n;

            expect(await templ.getClaimableMemberRewards(priest.address)).to.equal(expectedShare);
            expect(await templ.getClaimableMemberRewards(member1.address)).to.equal(expectedShare);
            expect(await templ.getClaimableMemberRewards(member2.address)).to.equal(expectedShare);
            expect(await templ.getClaimableMemberRewards(member3.address)).to.equal(0n);

            console.log("✅ Priest and early members share later pool allocations evenly");
        });

        it("SCENARIO 4: Fourth payer evenly rewards the priest and three paid members", async function () {
            const templAddress = await templ.getAddress();

            await token.connect(member1).approve(templAddress, ENTRY_FEE);
            await templ.connect(member1).join();

            await token.connect(member2).approve(templAddress, ENTRY_FEE);
            await templ.connect(member2).join();

            await token.connect(member3).approve(templAddress, ENTRY_FEE);
            await templ.connect(member3).join();

            await templ.connect(priest).claimMemberRewards();
            await templ.connect(member1).claimMemberRewards();
            await templ.connect(member2).claimMemberRewards();

            await token.connect(member4).approve(templAddress, ENTRY_FEE);
            await templ.connect(member4).join();

            const expectedShare = thirtyPercent / 4n;

            expect(await templ.getClaimableMemberRewards(priest.address)).to.equal(expectedShare);
            expect(await templ.getClaimableMemberRewards(member1.address)).to.equal(expectedShare);
            expect(await templ.getClaimableMemberRewards(member2.address)).to.equal(expectedShare);
            expect(await templ.getClaimableMemberRewards(member3.address)).to.equal(expectedShare);
            expect(await templ.getClaimableMemberRewards(member4.address)).to.equal(0n);

            console.log("✅ Priest and three paid members split the pool after the fourth payer joins");
        });
    });

    describe("Cumulative Rewards Testing", function () {
        it("Should track cumulative rewards correctly without claiming", async function () {
            // Member 1 joins
            await token.connect(member1).approve(await templ.getAddress(), ethers.MaxUint256);
            await templ.connect(member1).join();

            // Member 2 joins - pool splits between priest and first payer
            await token.connect(member2).approve(await templ.getAddress(), ethers.MaxUint256);
            await templ.connect(member2).join();

            const thirtyPercent = (ENTRY_FEE * 30n) / 100n;
            const secondJoinShare = thirtyPercent / 2n;
            let claimable1 = await templ.getClaimableMemberRewards(member1.address);
            expect(claimable1).to.equal(secondJoinShare);

            // Member 3 joins - pool splits between priest, member 1, and member 2
            await token.connect(member3).approve(await templ.getAddress(), ethers.MaxUint256);
            await templ.connect(member3).join();

            const thirdJoinShare = thirtyPercent / 3n;
            claimable1 = await templ.getClaimableMemberRewards(member1.address);
            let claimable2 = await templ.getClaimableMemberRewards(member2.address);

            // Member 1 should have: 15 from member 2 + 10 from member 3
            expect(claimable1).to.equal(secondJoinShare + thirdJoinShare);
            // Member 2 should have: 10 from member 3
            expect(claimable2).to.equal(thirdJoinShare);

            // Member 4 joins - pool splits between priest and the first three paid members
            await token.connect(member4).approve(await templ.getAddress(), ethers.MaxUint256);
            await templ.connect(member4).join();

            const fourthJoinShare = thirtyPercent / 4n;
            claimable1 = await templ.getClaimableMemberRewards(member1.address);
            claimable2 = await templ.getClaimableMemberRewards(member2.address);
            let claimable3 = await templ.getClaimableMemberRewards(member3.address);

            // Member 1: 15 + 10 + 7.5
            expect(claimable1).to.equal(secondJoinShare + thirdJoinShare + fourthJoinShare);
            // Member 2: 10 + 7.5
            expect(claimable2).to.equal(thirdJoinShare + fourthJoinShare);
            // Member 3: 7.5
            expect(claimable3).to.equal(fourthJoinShare);
            
            console.log("✅ Cumulative rewards tracked correctly:");
            console.log(
                `   Member 1 total: ${ethers.formatEther(claimable1)} (15 + 10 + 7.5 tokens)`
            );
            console.log(`   Member 2 total: ${ethers.formatEther(claimable2)} (10 + 7.5 tokens)`);
            console.log(`   Member 3 total: ${ethers.formatEther(claimable3)} (7.5 tokens)`);
        });
    });

    describe("Claiming and Balance Verification", function () {
        it("Should allow members to claim exact amounts and update balances correctly", async function () {
            // Setup: 4 members join
            await token.connect(member1).approve(await templ.getAddress(), ethers.MaxUint256);
            await templ.connect(member1).join();
            
            await token.connect(member2).approve(await templ.getAddress(), ethers.MaxUint256);
            await templ.connect(member2).join();
            
            await token.connect(member3).approve(await templ.getAddress(), ethers.MaxUint256);
            await templ.connect(member3).join();
            
            await token.connect(member4).approve(await templ.getAddress(), ethers.MaxUint256);
            await templ.connect(member4).join();

            // Calculate expected amounts
            const thirtyPercent = (ENTRY_FEE * 30n) / 100n;
            const secondJoinShare = thirtyPercent / 2n;
            const thirdJoinShare = thirtyPercent / 3n;
            const fourthJoinShare = thirtyPercent / 4n;

            // Expected claimable:
            // Priest: 30% + 15% + 10% + 7.5%
            // Member 1: 15% + 10% + 7.5%
            // Member 2: 10% + 7.5%
            // Member 3: 7.5%
            // Member 4: 0

            // Verify pool balance before claims
            const initialPoolBalance = await templ.memberPoolBalance();
            expect(initialPoolBalance).to.equal(thirtyPercent * 4n);

            // Priest claims first
            const priestBalanceBefore = await token.balanceOf(priest.address);
            const priestClaimable = await templ.getClaimableMemberRewards(priest.address);
            await templ.connect(priest).claimMemberRewards();
            const priestBalanceAfter = await token.balanceOf(priest.address);

            expect(priestBalanceAfter - priestBalanceBefore).to.equal(priestClaimable);
            expect(priestClaimable).to.equal(
                thirtyPercent + secondJoinShare + thirdJoinShare + fourthJoinShare
            );

            // Member 1 claims
            const balance1Before = await token.balanceOf(member1.address);
            const claimable1 = await templ.getClaimableMemberRewards(member1.address);
            await templ.connect(member1).claimMemberRewards();
            const balance1After = await token.balanceOf(member1.address);

            expect(balance1After - balance1Before).to.equal(claimable1);
            expect(await templ.getClaimableMemberRewards(member1.address)).to.equal(0);

            // Member 2 claims
            const balance2Before = await token.balanceOf(member2.address);
            const claimable2 = await templ.getClaimableMemberRewards(member2.address);
            await templ.connect(member2).claimMemberRewards();
            const balance2After = await token.balanceOf(member2.address);

            expect(balance2After - balance2Before).to.equal(claimable2);
            expect(await templ.getClaimableMemberRewards(member2.address)).to.equal(0);

            // Member 3 claims
            const balance3Before = await token.balanceOf(member3.address);
            const claimable3 = await templ.getClaimableMemberRewards(member3.address);
            await templ.connect(member3).claimMemberRewards();
            const balance3After = await token.balanceOf(member3.address);

            expect(balance3After - balance3Before).to.equal(claimable3);
            expect(await templ.getClaimableMemberRewards(member3.address)).to.equal(0);

            // Verify final pool balance
            const finalPoolBalance = await templ.memberPoolBalance();
            const totalClaimed = priestClaimable + claimable1 + claimable2 + claimable3;
            expect(finalPoolBalance).to.equal(initialPoolBalance - totalClaimed);

            console.log("✅ All claims processed correctly");
            console.log(`   Total claimed: ${ethers.formatEther(totalClaimed)}`);
            console.log(`   Pool remaining: ${ethers.formatEther(finalPoolBalance)}`);
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
                BURN_BPS,
                TREASURY_BPS,
                MEMBER_BPS,
                PROTOCOL_BPS,
                QUORUM_BPS,
                7 * 24 * 60 * 60,
                "0x000000000000000000000000000000000000dEaD",
                true,
                0,
                ""
            );
            await oddTempl.waitForDeployment();

            await oddTempl.connect(priest).setFeeCurveDAO(0, 0, ethers.parseUnits("1", 18));
            await oddTempl.connect(priest).setDictatorshipDAO(false);

            // Setup 3 members
            await token.connect(member1).approve(await oddTempl.getAddress(), ODD_FEE);
            await oddTempl.connect(member1).join();
            
            await token.connect(member2).approve(await oddTempl.getAddress(), ODD_FEE);
            await oddTempl.connect(member2).join();
            
            await token.connect(member3).approve(await oddTempl.getAddress(), ODD_FEE);
            await oddTempl.connect(member3).join();
            
            // Clear claims
            await oddTempl.connect(priest).claimMemberRewards();
            await oddTempl.connect(member1).claimMemberRewards();
            await oddTempl.connect(member2).claimMemberRewards();

            // Member 4 joins - pool is 30.3 tokens (30% of 101)
            await token.connect(member4).approve(await oddTempl.getAddress(), ODD_FEE);
            await oddTempl.connect(member4).join();

            // 30% of 101 = 30.3, divided by 4 existing members = 7.575 each (floored)
            const thirtyPercent = (ODD_FEE * 30n) / 100n; // 30.3
            const perMember = thirtyPercent / 4n; // 7.575 -> floored value
            
            const claimable1 = await oddTempl.getClaimableMemberRewards(member1.address);
            const claimable2 = await oddTempl.getClaimableMemberRewards(member2.address);
            const claimable3 = await oddTempl.getClaimableMemberRewards(member3.address);
            
            // Each should get the rounded down amount
            expect(claimable1).to.equal(perMember);
            expect(claimable2).to.equal(perMember);
            expect(claimable3).to.equal(perMember);
            
            // Some dust may remain in the pool due to rounding
            const totalClaimable = claimable1 + claimable2 + claimable3;
            const priestShare = await oddTempl.getClaimableMemberRewards(priest.address);
            const dust = thirtyPercent - (totalClaimable + priestShare);
            
            console.log("✅ Rounding handled correctly:");
            console.log(`   Pool amount: ${ethers.formatEther(thirtyPercent)}`);
            console.log(`   Per member: ${ethers.formatEther(perMember)}`);
            console.log(`   Dust remaining: ${ethers.formatEther(dust)}`);
        });

        it("Should prevent claims when member hasn't joined", async function () {
            await expect(templ.connect(member1).claimMemberRewards())
                .to.be.revertedWithCustomError(templ, "NotMember");
        });

        it("Should handle partial claims correctly", async function () {
            // Setup 3 members
            await token.connect(member1).approve(await templ.getAddress(), ethers.MaxUint256);
            await templ.connect(member1).join();
            
            await token.connect(member2).approve(await templ.getAddress(), ethers.MaxUint256);
            await templ.connect(member2).join();
            
            await token.connect(member3).approve(await templ.getAddress(), ethers.MaxUint256);
            await templ.connect(member3).join();

            // Member 1 claims their rewards from member 2
            await templ.connect(member1).claimMemberRewards();
            
            // Member 4 joins
            await token.connect(member4).approve(await templ.getAddress(), ethers.MaxUint256);
            await templ.connect(member4).join();

            // Member 1 should only get their share from member 4 (not double claim from member 2 & 3)
            const thirtyPercent = (ENTRY_FEE * 30n) / 100n;
            const newShare = thirtyPercent / 4n;

            const claimable1 = await templ.getClaimableMemberRewards(member1.address);
            expect(claimable1).to.equal(newShare); // Only from member 4
            
            console.log("✅ Partial claims tracked correctly");
            console.log(`   Member 1 can only claim new rewards: ${ethers.formatEther(claimable1)}`);
        });
    });

    describe("Pool Balance Integrity", function () {
        it("Should maintain pool balance integrity through all operations", async function () {
            let expectedPoolBalance = 0n;
            const thirtyPercent = (ENTRY_FEE * 30n) / 100n;

            // Member 1 joins - pool receives the full member allocation for the priest
            await token.connect(member1).approve(await templ.getAddress(), ethers.MaxUint256);
            await templ.connect(member1).join();
            expectedPoolBalance += thirtyPercent;
            expect(await templ.memberPoolBalance()).to.equal(expectedPoolBalance);

            // Priest claims their pioneer allocation
            let claimable = await templ.getClaimableMemberRewards(priest.address);
            await templ.connect(priest).claimMemberRewards();
            expectedPoolBalance -= claimable;
            expect(await templ.memberPoolBalance()).to.equal(expectedPoolBalance);

            // Member 2 joins - adds 30% to pool
            await token.connect(member2).approve(await templ.getAddress(), ethers.MaxUint256);
            await templ.connect(member2).join();
            expectedPoolBalance += thirtyPercent;
            expect(await templ.memberPoolBalance()).to.equal(expectedPoolBalance);

            // Member 1 claims their share from member 2
            claimable = await templ.getClaimableMemberRewards(member1.address);
            await templ.connect(member1).claimMemberRewards();
            expectedPoolBalance -= claimable;
            expect(await templ.memberPoolBalance()).to.equal(expectedPoolBalance);

            // Member 3 joins - adds 30% to pool
            await token.connect(member3).approve(await templ.getAddress(), ethers.MaxUint256);
            await templ.connect(member3).join();
            expectedPoolBalance += thirtyPercent;
            expect(await templ.memberPoolBalance()).to.equal(expectedPoolBalance);

            // Remaining members claim their accrued rewards
            claimable = await templ.getClaimableMemberRewards(priest.address);
            await templ.connect(priest).claimMemberRewards();
            expectedPoolBalance -= claimable;
            expect(await templ.memberPoolBalance()).to.equal(expectedPoolBalance);

            claimable = await templ.getClaimableMemberRewards(member2.address);
            await templ.connect(member2).claimMemberRewards();
            expectedPoolBalance -= claimable;
            expect(await templ.memberPoolBalance()).to.equal(expectedPoolBalance);

            console.log("✅ Pool balance integrity maintained throughout all operations");
            console.log(`   Final pool balance: ${ethers.formatEther(expectedPoolBalance)}`);
        });
    });

    describe("memberPoolClaims tracking", function () {
        it("Should accumulate total claimed rewards across multiple claims", async function () {
            // Initial member joins
            await token.connect(member1).approve(await templ.getAddress(), ethers.MaxUint256);
            await templ.connect(member1).join();

            let totalClaimed = 0n;
            const thirtyPercent = (ENTRY_FEE * 30n) / 100n;
            const secondJoinShare = thirtyPercent / 2n;
            const thirdJoinShare = thirtyPercent / 3n;
            const fourthJoinShare = thirtyPercent / 4n;

            // Member 2 joins and member 1 claims 15%
            await token.connect(member2).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member2).join();
            let claimable = await templ.getClaimableMemberRewards(member1.address);
            expect(claimable).to.equal(secondJoinShare);
            await templ.connect(member1).claimMemberRewards();
            totalClaimed += claimable;
            expect(await templ.memberPoolClaims(member1.address)).to.equal(totalClaimed);

            // Member 3 joins and member 1 claims an additional 10%
            await token.connect(member3).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member3).join();
            claimable = await templ.getClaimableMemberRewards(member1.address);
            expect(claimable).to.equal(thirdJoinShare);
            await templ.connect(member1).claimMemberRewards();
            totalClaimed += claimable;
            expect(await templ.memberPoolClaims(member1.address)).to.equal(totalClaimed);

            // Member 4 joins and member 1 claims a final 7.5%
            await token.connect(member4).approve(await templ.getAddress(), ENTRY_FEE);
            await templ.connect(member4).join();
            claimable = await templ.getClaimableMemberRewards(member1.address);
            expect(claimable).to.equal(fourthJoinShare);
            await templ.connect(member1).claimMemberRewards();
            totalClaimed += claimable;
            expect(await templ.memberPoolClaims(member1.address)).to.equal(totalClaimed);
        });
    });

});
