const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, purchaseAccess } = require("./utils/mintAndPurchase");

describe("Priest dictatorship mode", function () {
    const ENTRY_FEE = ethers.parseUnits("100", 18);
    const TOKEN_SUPPLY = ethers.parseUnits("10000", 18);

    let templ;
    let token;
    let accounts;
    let priest;
    let member;
    let outsider;

    beforeEach(async function () {
        ({ templ, token, accounts, priest } = await deployTempl({
            entryFee: ENTRY_FEE,
            priestIsDictator: true,
        }));
        [, , member, outsider] = accounts;
        await mintToUsers(token, [member, outsider], TOKEN_SUPPLY);
    });

    it("exposes dictatorship flag", async function () {
        expect(await templ.priestIsDictator()).to.equal(true);
    });

    it("blocks proposals, voting, and execution", async function () {
        await expect(
            templ.connect(member).createProposalSetPaused(true, 7 * 24 * 60 * 60)
        ).to.be.revertedWithCustomError(templ, "DictatorshipEnabled");

        await purchaseAccess(templ, token, [member]);

        await expect(templ.connect(member).vote(0, true)).to.be.revertedWithCustomError(
            templ,
            "DictatorshipEnabled"
        );

        await expect(templ.executeProposal(0)).to.be.revertedWithCustomError(templ, "DictatorshipEnabled");
    });

    it("allows the priest to execute governance actions instantly", async function () {
        await purchaseAccess(templ, token, [member]);

        await expect(templ.connect(priest).setPausedDAO(true)).to.not.be.reverted;
        expect(await templ.paused()).to.equal(true);

        const treasuryBefore = await templ.treasuryBalance();
        expect(treasuryBefore).to.be.gt(0n);

        const halfTreasury = treasuryBefore / 2n;
        expect(halfTreasury).to.be.gt(0n);
        const balanceBefore = await token.balanceOf(priest.address);
        await expect(
            templ
                .connect(priest)
                .withdrawTreasuryDAO(
                    await token.getAddress(),
                    priest.address,
                    halfTreasury,
                    "dictatorship-withdraw"
                )
        ).to.not.be.reverted;

        expect(await templ.treasuryBalance()).to.equal(treasuryBefore - halfTreasury);
        const balanceAfter = await token.balanceOf(priest.address);
        expect(balanceAfter - balanceBefore).to.equal(halfTreasury);
    });

    it("prevents non-priest addresses from calling governance actions", async function () {
        await expect(templ.connect(member).setPausedDAO(true)).to.be.revertedWithCustomError(
            templ,
            "PriestOnly"
        );

        await expect(
            templ
                .connect(outsider)
                .withdrawTreasuryDAO(await token.getAddress(), outsider.address, 1n, "nope")
        ).to.be.revertedWithCustomError(templ, "PriestOnly");
    });

    it("transfers dictatorship when the priest address changes", async function () {
        const newPriest = accounts[5];
        await templ.connect(priest).changePriestDAO(newPriest.address);

        await expect(templ.connect(newPriest).setPausedDAO(false)).to.not.be.reverted;
        await expect(templ.connect(priest).setPausedDAO(false)).to.be.revertedWithCustomError(
            templ,
            "PriestOnly"
        );
        expect(await templ.priest()).to.equal(newPriest.address);
    });
});
