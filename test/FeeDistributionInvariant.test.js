const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, joinMembers } = require("./utils/mintAndPurchase");

describe("Fee Distribution Invariant", function () {
    const ENTRY_FEE = ethers.parseUnits("100", 18);
    const TOKEN_SUPPLY = ethers.parseUnits("10000", 18);
    const BPS_DENOMINATOR = 10_000n;

    let templ;
    let token;
    let owner, priest;
    let members;
    let accounts;

    beforeEach(async function () {
        ({ templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE }));
        [owner, priest, ...members] = accounts;

        await mintToUsers(token, members, TOKEN_SUPPLY);
    });

    it("tracks fees correctly across varying member counts", async function () {
        let cumulativeBurn = 0n;
        let cumulativeTreasury = 0n;
        let cumulativeMemberPool = 0n;
        let cumulativeProtocol = 0n;
        const templAddress = await templ.getAddress();

        for (let i = 0; i < members.length; i++) {
            const member = members[i];
            await token.connect(member).approve(templAddress, ENTRY_FEE);

            const tx = await templ.connect(member).join();
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

            cumulativeBurn += accessPurchased.args.burnedAmount;
            cumulativeTreasury += accessPurchased.args.treasuryAmount;
            cumulativeMemberPool += accessPurchased.args.memberPoolAmount;
            cumulativeProtocol += accessPurchased.args.protocolAmount;

            const expected = ENTRY_FEE * BigInt(i + 1);
            const total = cumulativeBurn + cumulativeTreasury + cumulativeMemberPool + cumulativeProtocol;
            expect(total).to.equal(expected);

            if (i === 0) {
                const poolPercent = BigInt(await templ.memberPoolPercent());
                const pioneerReward = (ENTRY_FEE * poolPercent) / BPS_DENOMINATOR;
                expect(await templ.cumulativeMemberRewards()).to.equal(pioneerReward);
            }
        }

        expect(await templ.totalJoins()).to.equal(BigInt(members.length));
    });
});
