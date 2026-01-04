const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl, deployTemplContracts, EXPONENTIAL_CURVE, STATIC_CURVE } = require("./utils/deploy");
const { mintToUsers, joinMembers } = require("./utils/mintAndPurchase");

describe("EntryFeeCurve", function () {
    const ENTRY_FEE = ethers.parseUnits("100", 18);
    const MAX_ENTRY_FEE = (1n << 128n) - 1n;
    const CURVE_STYLE = {
        Static: 0,
        Linear: 1,
        Exponential: 2,
    };
    const TOTAL_PERCENT = 10_000n;

    const toBigInt = (value) => BigInt(value);
    const normalizeEntryFee = (amount) => {
        if (amount < 10n) {
            return 10n;
        }
        const remainder = amount % 10n;
        return remainder === 0n ? amount : amount - remainder;
    };
    const divCeil = (numerator, denominator) => {
        if (denominator === 0n) {
            throw new Error("invalid division");
        }
        return (numerator + denominator - 1n) / denominator;
    };

    const powBps = (factorBps, exponent) => {
        if (exponent === 0n) return TOTAL_PERCENT;
        let result = TOTAL_PERCENT;
        let base = factorBps;
        let exp = exponent;
        while (exp > 0n) {
            if ((exp & 1n) === 1n) {
                result = (result * base) / TOTAL_PERCENT;
                if (result === 0n) {
                    result = 1n;
                }
            }
            exp >>= 1n;
            if (exp > 0n) {
                base = (base * base) / TOTAL_PERCENT;
                if (base === 0n) {
                    base = 1n;
                }
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
            return divCeil(amount * TOTAL_PERCENT, denominator);
        }
        if (segment.style === CURVE_STYLE.Exponential) {
            const factor = powBps(toBigInt(segment.rateBps), steps);
            if (factor === 0n) throw new Error("invalid exponential factor");
            return divCeil(amount * TOTAL_PERCENT, factor);
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
    const segmentSteps = (segments, paidJoins) => {
        let remaining = paidJoins;
        const steps = new Array(segments.length).fill(0n);
        for (let i = 0; i < segments.length && remaining > 0n; i += 1) {
            const segmentLength = BigInt(segments[i].length ?? 0);
            const stepCount = segmentLength === 0n ? remaining : remaining < segmentLength ? remaining : segmentLength;
            steps[i] = stepCount;
            if (segmentLength === 0n) {
                remaining = 0n;
            } else {
                remaining -= stepCount;
            }
        }
        if (remaining !== 0n) {
            throw new Error("invalid curve configuration");
        }
        return steps;
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
        return normalizeEntryFee(amount);
    };

    const solveBaseEntryFee = (targetPrice, curve, paidJoins) => {
        if (paidJoins === 0n) {
            return targetPrice;
        }
        let amount = targetPrice;
        const segments = segmentList(curve);
        const steps = segmentSteps(segments, paidJoins);
        for (let i = steps.length - 1; i >= 0; i -= 1) {
            if (steps[i] === 0n) continue;
            amount = applySegmentInverse(amount, segments[i], steps[i]);
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

    it("recalibrates base entry fee using inverse segments in reverse order", async function () {
        const curve = {
            primary: { style: CURVE_STYLE.Linear, rateBps: 333, length: 2 },
            additionalSegments: [
                { style: CURVE_STYLE.Exponential, rateBps: 11_050, length: 3 },
                { style: CURVE_STYLE.Linear, rateBps: 77, length: 0 }
            ]
        };

        const baseFee = 1000n;
        const { templ, token, accounts, priest } = await deployTempl({
            entryFee: baseFee,
            curve,
            priestIsDictator: true,
        });

        const [, , ...rest] = accounts;
        const joiners = rest.slice(0, 7);
        const nextJoiner = rest[7];

        await mintToUsers(token, [...joiners, nextJoiner], baseFee * 1000n);
        await joinMembers(templ, token, joiners);

        const paidJoins = await templ.totalJoins();
        const targetEntryFee = 1240n;

        await templ.connect(priest).updateConfigDAO(targetEntryFee, false, 0, 0, 0);
        expect(await templ.entryFee()).to.equal(targetEntryFee);

        const recalibratedBase = solveBaseEntryFee(targetEntryFee, curve, paidJoins);
        const expectedNextFee = priceForPaidJoins(recalibratedBase, curve, paidJoins + 1n);

        const templAddress = await templ.getAddress();
        await token.connect(nextJoiner).approve(templAddress, targetEntryFee);
        await templ.connect(nextJoiner).join();

        expect(await templ.entryFee()).to.equal(expectedNextFee);
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

    it("reverts when retargeting the entry fee floor would push the base below the minimum", async function () {
        const RAW_ENTRY_FEE = 100n;
        const MIN_ENTRY_FEE = 10n;
        const { templ, token, accounts, priest } = await deployTempl({
            entryFee: RAW_ENTRY_FEE,
            curve: EXPONENTIAL_CURVE,
            priestIsDictator: true,
        });

        const [, , ...rest] = accounts;
        const joiners = rest.slice(0, 5);
        await mintToUsers(token, joiners, RAW_ENTRY_FEE * 1_000n);

        const templAddress = await templ.getAddress();
        for (const member of joiners) {
            const currentFee = await templ.entryFee();
            await token.connect(member).approve(templAddress, currentFee);
            await templ.connect(member).join();
        }

        expect(await templ.entryFee()).to.be.gt(MIN_ENTRY_FEE);

        await expect(
            templ
                .connect(priest)
                .updateConfigDAO(MIN_ENTRY_FEE, false, 0, 0, 0)
        ).to.be.revertedWithCustomError(templ, "EntryFeeTooSmall");

        expect(await templ.baseEntryFee()).to.be.gte(RAW_ENTRY_FEE);
        expect(await templ.entryFee()).to.be.gte(MIN_ENTRY_FEE);
    });

    it("supports exponential discount curves without saturating to the max entry fee", async function () {
        const discountCurve = {
            primary: { style: CURVE_STYLE.Exponential, rateBps: 9_000, length: 0 },
            additionalSegments: []
        };

        const { templ, token, accounts } = await deployTempl({
            entryFee: ENTRY_FEE,
            curve: discountCurve,
        });

        const [, priest] = accounts;
        const templAddress = await templ.getAddress();

        const joins = 120;
        const initialFee = await templ.entryFee();
        const totalBudget = initialFee * BigInt(joins);

        await token.mint(priest.address, totalBudget);
        await token.connect(priest).approve(templAddress, ethers.MaxUint256);

        let previousFee = initialFee;

        for (let i = 0; i < joins; i += 1) {
            const wallet = ethers.Wallet.createRandom();
            await templ.connect(priest).joinFor(wallet.address);
            const currentFee = await templ.entryFee();
            expect(currentFee).to.be.at.most(previousFee);
            previousFee = currentFee;
        }

        expect(previousFee).to.be.lte(initialFee);
        expect(previousFee).to.not.equal(MAX_ENTRY_FEE);
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
