const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");

// Invariant: totalBurned + totalToTreasury + totalToMemberPool + totalToProtocol
//           == entryFee * totalPurchases

describe("Fee Distribution Invariant", function () {
    const ENTRY_FEE = ethers.parseUnits("100", 18);
    const TOKEN_SUPPLY = ethers.parseUnits("10000", 18);

    let templ;
    let token;
    let owner, priest;
    let members;
    let accounts;

    beforeEach(async function () {
        ({ templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE }));
        [owner, priest, ...members] = accounts;

        for (const member of members) {
            await token.mint(member.address, TOKEN_SUPPLY);
        }
    });

    it("tracks fees correctly across varying member counts", async function () {
        const templAddress = await templ.getAddress();

        for (let i = 0; i < members.length; i++) {
            const member = members[i];
            await token.connect(member).approve(templAddress, ENTRY_FEE);
            await templ.connect(member).purchaseAccess();

            const burned = await templ.totalBurned();
            const treasury = await templ.totalToTreasury();
            const pool = await templ.totalToMemberPool();
            const protocol = await templ.totalToProtocol();
            const total = burned + treasury + pool + protocol;
            const expected = ENTRY_FEE * (await templ.totalPurchases());

            expect(total).to.equal(expected);

            if (i === 0) {
                expect(await templ.cumulativeMemberRewards()).to.equal(0);
            }
        }

        // large member count reached
        expect(await templ.totalPurchases()).to.equal(BigInt(members.length));
    });
});

