const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl, deployTemplContracts, EXPONENTIAL_CURVE, STATIC_CURVE } = require("./utils/deploy");
const { mintToUsers } = require("./utils/mintAndPurchase");

describe("EntryFeeCurve", function () {
    const ENTRY_FEE = ethers.parseUnits("100", 18);
    const CURVE_STYLE = {
        Static: 0,
        Linear: 1,
        Exponential: 2,
    };
    const TOTAL_PERCENT = 10_000n;

    const toBigInt = (value) => BigInt(value);

    const powBps = (factorBps, exponent) => {
        if (exponent === 0n) return TOTAL_PERCENT;
        let result = TOTAL_PERCENT;
        let base = factorBps;
        let exp = exponent;
        while (exp > 0n) {
            if ((exp & 1n) === 1n) {
                result = (result * base) / TOTAL_PERCENT;
            }
            exp >>= 1n;
            if (exp > 0n) {
                base = (base * base) / TOTAL_PERCENT;
            }
        }
        return result;
    };

    const applySegmentForward = (amount, segment, steps) => {
        if (steps === 0n || segment.style === CURVE_STYLE.Static) {
            return amount;
        }
        if (segment.style === CURVE_STYLE.Linear) {
            const slope = toBigInt(segment.rateBps) * steps;
            return (amount * (TOTAL_PERCENT + slope)) / TOTAL_PERCENT;
        }
        if (segment.style === CURVE_STYLE.Exponential) {
            const factor = powBps(toBigInt(segment.rateBps), steps);
            return (amount * factor) / TOTAL_PERCENT;
        }
        throw new Error("unsupported curve style");
    };

    const applySegmentInverse = (amount, segment, steps) => {
        if (steps === 0n || segment.style === CURVE_STYLE.Static) {
            return amount;
        }
        if (segment.style === CURVE_STYLE.Linear) {
            const denominator = TOTAL_PERCENT + toBigInt(segment.rateBps) * steps;
            if (denominator === 0n) throw new Error("invalid linear denominator");
            return (amount * TOTAL_PERCENT) / denominator;
        }
        if (segment.style === CURVE_STYLE.Exponential) {
            const factor = powBps(toBigInt(segment.rateBps), steps);
            if (factor === 0n) throw new Error("invalid exponential factor");
            return (amount * TOTAL_PERCENT) / factor;
        }
        throw new Error("unsupported curve style");
    };

    const consumeSegment = (amount, segment, remaining, forward) => {
        if (remaining === 0n) {
            return { amount, remaining };
        }
        const segmentLength = BigInt(segment.length ?? 0);
        let steps;
        if (segmentLength === 0n) {
            steps = remaining;
        } else {
            steps = remaining < segmentLength ? remaining : segmentLength;
        }
        if (steps > 0n) {
            amount = forward
                ? applySegmentForward(amount, segment, steps)
                : applySegmentInverse(amount, segment, steps);
            remaining -= steps;
        }
        if (segmentLength === 0n) {
            remaining = 0n;
        }
        return { amount, remaining };
    };

    const segmentList = (curve) => {
        const extras = curve.additionalSegments || [];
        return [curve.primary, ...extras];
    };

    const priceForPaidJoins = (base, curve, paidJoins) => {
        if (paidJoins === 0n) {
            return base;
        }
        let amount = base;
        let remaining = paidJoins;
        const segments = segmentList(curve);
        for (const segment of segments) {
            ({ amount, remaining } = consumeSegment(amount, segment, remaining, true));
            if (remaining === 0n) break;
        }
        if (remaining !== 0n) {
            throw new Error("invalid curve configuration");
        }
        return amount;
    };

    const solveBaseEntryFee = (targetPrice, curve, paidJoins) => {
        if (paidJoins === 0n) {
            return targetPrice;
        }
        let amount = targetPrice;
        let remaining = paidJoins;
        const segments = segmentList(curve);
        for (const segment of segments) {
            ({ amount, remaining } = consumeSegment(amount, segment, remaining, false));
            if (remaining === 0n) break;
        }
        if (remaining !== 0n) {
            throw new Error("invalid curve configuration");
        }
        return amount;
    };

    it("applies the default exponential curve and allows DAO updates", async function () {
        const { templ, token, accounts } = await deployTempl({
            entryFee: ENTRY_FEE,
            curve: EXPONENTIAL_CURVE,
        });

        const [, , memberA, memberB] = accounts;
        await mintToUsers(token, [memberA, memberB], ENTRY_FEE * 10n);

        const templAddress = await templ.getAddress();
        await token.connect(memberA).approve(templAddress, ENTRY_FEE);
        await templ.connect(memberA).join();

        const expectedAfterFirstJoin = priceForPaidJoins(
            ENTRY_FEE,
            EXPONENTIAL_CURVE,
            await templ.totalJoins()
        );
        expect(await templ.entryFee()).to.equal(expectedAfterFirstJoin);

        const linearCurve = {
            primary: { style: CURVE_STYLE.Linear, rateBps: 500, length: 0 },
            additionalSegments: []
        };

        const baseAnchor = await templ.baseEntryFee();
        await templ
            .connect(memberA)
            .createProposalSetEntryFeeCurve(
                linearCurve,
                baseAnchor,
                7 * 24 * 60 * 60,
                "Enable linear curve",
                "Switch to linear growth"
            );
        await templ.connect(memberA).vote(0, true);
        await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
        await ethers.provider.send("evm_mine");
        await templ.executeProposal(0);

        const linearFeeAfterUpdate = priceForPaidJoins(ENTRY_FEE, linearCurve, await templ.totalJoins());
        expect(await templ.entryFee()).to.equal(linearFeeAfterUpdate);

        await token.connect(memberB).approve(templAddress, linearFeeAfterUpdate);
        await templ.connect(memberB).join();

        const linearAfterSecondJoin = priceForPaidJoins(ENTRY_FEE, linearCurve, await templ.totalJoins());
        expect(await templ.entryFee()).to.equal(linearAfterSecondJoin);
    });

    it("updates the curve via governance with a new current entry fee", async function () {
        const { templ, token, accounts } = await deployTempl({
            entryFee: ENTRY_FEE,
            curve: STATIC_CURVE,
        });

        const [, , voterA, voterB, newMember] = accounts;
        await mintToUsers(token, [voterA, voterB, newMember], ENTRY_FEE * 20n);

        const templAddress = await templ.getAddress();
        await token.connect(voterA).approve(templAddress, ENTRY_FEE);
        await templ.connect(voterA).join();
        await token.connect(voterB).approve(templAddress, ENTRY_FEE);
        await templ.connect(voterB).join();

        const upgradedCurve = {
            primary: { style: CURVE_STYLE.Exponential, rateBps: 12_000, length: 0 },
            additionalSegments: []
        };

        const newCurrentFee = ENTRY_FEE * 2n;
        const paidJoins = await templ.totalJoins();
        let recalibratedBase = solveBaseEntryFee(newCurrentFee, upgradedCurve, paidJoins);
        const baseRemainder = recalibratedBase % 10n;
        if (baseRemainder !== 0n) {
            recalibratedBase = recalibratedBase - baseRemainder + 10n;
        }

        await templ
            .connect(voterA)
            .createProposalSetEntryFeeCurve(
                upgradedCurve,
                recalibratedBase,
                7 * 24 * 60 * 60,
                "Upgrade curve",
                "Switch to exponential growth"
            );

        await templ.connect(voterA).vote(0, true);
        await templ.connect(voterB).vote(0, true);

        await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
        await ethers.provider.send("evm_mine");

        await templ.executeProposal(0);

        const currentFeeAfterUpdate = priceForPaidJoins(recalibratedBase, upgradedCurve, paidJoins);
        expect(await templ.entryFee()).to.equal(currentFeeAfterUpdate);

        await token.connect(newMember).approve(templAddress, currentFeeAfterUpdate);
        await templ.connect(newMember).join();

        const nextExpected = priceForPaidJoins(
            recalibratedBase,
            upgradedCurve,
            await templ.totalJoins()
        );
        expect(await templ.entryFee()).to.equal(nextExpected);
    });

    it("handles multi-segment curves with saturation", async function () {
        const multiCurve = {
            primary: { style: CURVE_STYLE.Linear, rateBps: 250, length: 2 },
            additionalSegments: [
                { style: CURVE_STYLE.Static, rateBps: 0, length: 0 }
            ]
        };

        const { templ, token, accounts } = await deployTempl({
            entryFee: ENTRY_FEE,
            curve: multiCurve,
        });

        const [, , memberA, memberB, memberC] = accounts;
        await mintToUsers(token, [memberA, memberB, memberC], ENTRY_FEE * 10n);
        const templAddress = await templ.getAddress();

        const base = await templ.baseEntryFee();
        expect(await templ.entryFee()).to.equal(ENTRY_FEE);

        await token.connect(memberA).approve(templAddress, ENTRY_FEE);
        await templ.connect(memberA).join();
        const priceAfterFirst = priceForPaidJoins(base, multiCurve, 1n);
        expect(await templ.entryFee()).to.equal(priceAfterFirst);

        await token.connect(memberB).approve(templAddress, priceAfterFirst);
        await templ.connect(memberB).join();
        const priceAfterSecond = priceForPaidJoins(base, multiCurve, 2n);
        expect(await templ.entryFee()).to.equal(priceAfterSecond);

        await token.connect(memberC).approve(templAddress, priceAfterSecond);
        await templ.connect(memberC).join();
        const priceAfterThird = priceForPaidJoins(base, multiCurve, 3n);
        expect(priceAfterThird).to.equal(priceAfterSecond);
        expect(await templ.entryFee()).to.equal(priceAfterThird);
    });

    it("rejects curve configurations without an infinite tail", async function () {
        const invalidCurve = {
            primary: { style: CURVE_STYLE.Linear, rateBps: 500, length: 1 },
            additionalSegments: []
        };

        await expect(deployTemplContracts({ entryFee: ENTRY_FEE, curve: invalidCurve }))
            .to.be.rejectedWith(/InvalidCurveConfig/);
    });
});
