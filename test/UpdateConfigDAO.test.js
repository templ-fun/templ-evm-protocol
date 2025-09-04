const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");

describe("updateConfigDAO", function () {
    const ENTRY_FEE = ethers.parseUnits("100", 18);
    const TOKEN_SUPPLY = ethers.parseUnits("10000", 18);

    let templ;
    let token;
    let newToken;
    let member;
    let priest;
    let accounts;

    beforeEach(async function () {
        ({ templ, token, accounts, priest } = await deployTempl({ entryFee: ENTRY_FEE }));
        [, , member] = accounts;

        const Token = await ethers.getContractFactory("TestToken");
        newToken = await Token.deploy("New Token", "NEW", 18);
        await newToken.waitForDeployment();

        await token.mint(member.address, TOKEN_SUPPLY);
        await token.connect(member).approve(await templ.getAddress(), ENTRY_FEE);
        await templ.connect(member).purchaseAccess();
    });

    it("reverts when entry fee is less than 10", async function () {
        const smallFee = 5;
        const iface = new ethers.Interface([
            "function updateConfigDAO(address,uint256)"
        ]);
        const callData = iface.encodeFunctionData("updateConfigDAO", [
            ethers.ZeroAddress,
            smallFee
        ]);

        await templ.connect(member).createProposal(
            "Small Fee",
            "desc",
            callData,
            7 * 24 * 60 * 60
        );

        await templ.connect(member).vote(0, true);
        await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
        await ethers.provider.send("evm_mine");

        await expect(templ.executeProposal(0))
            .to.be.revertedWithCustomError(templ, "EntryFeeTooSmall");
    });

    it("reverts when entry fee is not divisible by 10", async function () {
        const invalidFee = ENTRY_FEE + 5n;
        const iface = new ethers.Interface([
            "function updateConfigDAO(address,uint256)"
        ]);
        const callData = iface.encodeFunctionData("updateConfigDAO", [
            ethers.ZeroAddress,
            invalidFee
        ]);

        await templ.connect(member).createProposal(
            "Invalid Fee",
            "desc",
            callData,
            7 * 24 * 60 * 60
        );

        await templ.connect(member).vote(0, true);
        await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
        await ethers.provider.send("evm_mine");

        await expect(templ.executeProposal(0))
            .to.be.revertedWithCustomError(templ, "InvalidEntryFee");
    });

    it("reverts when balances are non-zero", async function () {
        const iface = new ethers.Interface([
            "function updateConfigDAO(address,uint256)"
        ]);
        const callData = iface.encodeFunctionData("updateConfigDAO", [
            await newToken.getAddress(),
            0
        ]);

        await templ.connect(member).createProposal(
            "Change Token",
            "switch token",
            callData,
            7 * 24 * 60 * 60
        );

        await templ.connect(member).vote(0, true);
        await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
        await ethers.provider.send("evm_mine");

        await expect(templ.executeProposal(0))
            .to.be.revertedWithCustomError(templ, "NonZeroBalances");
    });

    it("allows update after sweeping remainder", async function () {
        const [priest, m1, m2, m3, m4, m5] = await ethers.getSigners();

        // Deploy tokens with 0 decimals to force remainder
        const Token = await ethers.getContractFactory("TestToken");
        const token0 = await Token.deploy("Test Token", "TEST", 0);
        await token0.waitForDeployment();
        const newToken0 = await Token.deploy("New Token", "NEW", 0);
        await newToken0.waitForDeployment();

        const TEMPL = await ethers.getContractFactory("TEMPL");
        const templ2 = await TEMPL.deploy(
            priest.address,
            priest.address,
            await token0.getAddress(),
            100,
            10,
            10
        );
        await templ2.waitForDeployment();

        const members = [m1, m2, m3, m4, m5];
        for (const m of members) {
            await token0.mint(m.address, 1000);
            await token0.connect(m).approve(await templ2.getAddress(), 100);
            await templ2.connect(m).purchaseAccess();
        }

        // First four members claim their rewards
        for (const m of members.slice(0, 4)) {
            const claimable = await templ2.getClaimablePoolAmount(m.address);
            if (claimable > 0n) {
                await templ2.connect(m).claimMemberPool();
            }
        }

        // Empty the treasury so only member pool remainder remains
        const withdrawIface = new ethers.Interface([
            "function withdrawAllTreasuryDAO(address,string)"
        ]);
        const withdrawCalldata = withdrawIface.encodeFunctionData(
            "withdrawAllTreasuryDAO",
            [priest.address, "sweep"]
        );
        await templ2.connect(m1).createProposal(
            "Withdraw Treasury",
            "desc",
            withdrawCalldata,
            7 * 24 * 60 * 60
        );
        await templ2.connect(m1).vote(0, true);
        await templ2.connect(m2).vote(0, true);
        await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
        await ethers.provider.send("evm_mine");
        await templ2.executeProposal(0);

        // Attempt config update - should revert due to remainder
        const updateIface = new ethers.Interface([
            "function updateConfigDAO(address,uint256)"
        ]);
        const updateCalldata = updateIface.encodeFunctionData(
            "updateConfigDAO",
            [await newToken0.getAddress(), 0]
        );
        await templ2.connect(m1).createProposal(
            "Change Token",
            "desc",
            updateCalldata,
            7 * 24 * 60 * 60
        );
        await templ2.connect(m1).vote(1, true);
        await templ2.connect(m2).vote(1, true);
        await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
        await ethers.provider.send("evm_mine");
        await expect(templ2.executeProposal(1))
            .to.be.revertedWithCustomError(templ2, "NonZeroBalances");

        // Sweep remainder to priest
        const sweepIface = new ethers.Interface([
            "function sweepMemberRewardRemainderDAO(address)"
        ]);
        const sweepCalldata = sweepIface.encodeFunctionData(
            "sweepMemberRewardRemainderDAO",
            [priest.address]
        );
        await templ2.connect(m1).createProposal(
            "Sweep Remainder",
            "desc",
            sweepCalldata,
            7 * 24 * 60 * 60
        );
        await templ2.connect(m1).vote(2, true);
        await templ2.connect(m2).vote(2, true);
        await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
        await ethers.provider.send("evm_mine");
        await templ2.executeProposal(2);

        expect(await templ2.memberRewardRemainder()).to.equal(0);
        expect(await templ2.memberPoolBalance()).to.equal(0);

        // Config update should now succeed
        await templ2.connect(m1).createProposal(
            "Change Token 2",
            "desc",
            updateCalldata,
            7 * 24 * 60 * 60
        );
        await templ2.connect(m1).vote(3, true);
        await templ2.connect(m2).vote(3, true);
        await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
        await ethers.provider.send("evm_mine");
        await templ2.executeProposal(3);

        expect(await templ2.accessToken()).to.equal(
            await newToken0.getAddress()
        );
    });
});

