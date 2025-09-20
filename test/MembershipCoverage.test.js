const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, purchaseAccess } = require("./utils/mintAndPurchase");

const ENTRY_FEE = ethers.parseUnits("100", 18);
const DAY = 24 * 60 * 60;
const VOTING_PERIOD = 7 * DAY;

describe("Membership coverage extras", function () {
  it("handles external reward lookups across all branches", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, , memberA, memberB, donor, newcomer] = accounts;

    await mintToUsers(token, [memberA, memberB, donor, newcomer], ENTRY_FEE * 6n);
    await purchaseAccess(templ, token, [memberA, memberB]);

    // Access token path short-circuits to zero
    expect(
      await templ.getClaimableExternalToken(memberA.address, await token.getAddress())
    ).to.equal(0n);

    // Unknown token path returns zero without membership short-circuit
    const randomToken = ethers.Wallet.createRandom().address;
    expect(
      await templ.getClaimableExternalToken(memberA.address, randomToken)
    ).to.equal(0n);

    // Deploy secondary reward token and donate
    const OtherToken = await ethers.getContractFactory("contracts/mocks/TestToken.sol:TestToken");
    const otherToken = await OtherToken.deploy("Bonus", "BON", 18);
    const donation = ethers.parseUnits("12", 18);
    await otherToken.mint(donor.address, donation);
    await otherToken.connect(donor).transfer(await templ.getAddress(), donation);

    await templ
      .connect(memberA)
      .createProposalDisbandTreasury(otherToken.target, VOTING_PERIOD);
    await templ.connect(memberA).vote(0, true);
    await templ.connect(memberB).vote(0, true);
    await ethers.provider.send("evm_increaseTime", [VOTING_PERIOD + DAY]);
    await ethers.provider.send("evm_mine", []);
    await templ.executeProposal(0);

    // Existing members accrue rewards
    const claimable = await templ.getClaimableExternalToken(memberA.address, otherToken.target);
    expect(claimable).to.be.gt(0n);

    // New members sync snapshots to zero
    await purchaseAccess(templ, token, [newcomer]);
    expect(
      await templ.getClaimableExternalToken(newcomer.address, otherToken.target)
    ).to.equal(0n);

    // Claim rewards to cover snapshot updates and ternary false path
    const balanceBefore = await otherToken.balanceOf(memberA.address);
    await templ.connect(memberA).claimExternalToken(otherToken.target);
    const balanceAfter = await otherToken.balanceOf(memberA.address);
    expect(balanceAfter - balanceBefore).to.equal(claimable);
    expect(
      await templ.getClaimableExternalToken(memberA.address, otherToken.target)
    ).to.equal(0n);

    await expect(
      templ.connect(memberA).claimExternalToken(otherToken.target)
    ).to.be.revertedWithCustomError(templ, "NoRewardsToClaim");
  });

  it("guards member pool claim and exposes zero-available treasury info", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, , member] = accounts;

    await mintToUsers(token, [member], ENTRY_FEE * 3n);
    await purchaseAccess(templ, token, [member]);

    await expect(templ.connect(member).claimMemberPool()).to.be.revertedWithCustomError(
      templ,
      "NoRewardsToClaim"
    );

    await templ
      .connect(member)
      .createProposalDisbandTreasury(await token.getAddress(), VOTING_PERIOD);
    await templ.connect(member).vote(0, true);
    await ethers.provider.send("evm_increaseTime", [VOTING_PERIOD + DAY]);
    await ethers.provider.send("evm_mine", []);
    await templ.executeProposal(0);

    const treasuryInfo = await templ.getTreasuryInfo();
    expect(treasuryInfo.treasury).to.equal(0n);
    expect(treasuryInfo.memberPool).to.be.gt(0n);

    const config = await templ.getConfig();
    expect(config.treasury).to.equal(0n);
    expect(config.pool).to.equal(treasuryInfo.memberPool);
  });

  it("claims ETH external rewards successfully", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, , memberA, memberB] = accounts;

    await mintToUsers(token, [memberA, memberB], ENTRY_FEE * 5n);
    await purchaseAccess(templ, token, [memberA, memberB]);

    const donation = ethers.parseUnits("5", 18);
    await accounts[0].sendTransaction({ to: await templ.getAddress(), value: donation });

    await templ
      .connect(memberA)
      .createProposalDisbandTreasury(ethers.ZeroAddress, VOTING_PERIOD);
    await templ.connect(memberA).vote(0, true);
    await templ.connect(memberB).vote(0, true);
    await ethers.provider.send("evm_increaseTime", [VOTING_PERIOD + DAY]);
    await ethers.provider.send("evm_mine", []);
    await templ.executeProposal(0);

    const before = await ethers.provider.getBalance(memberA.address);
    const tx = await templ.connect(memberA).claimExternalToken(ethers.ZeroAddress);
    const receipt = await tx.wait();
    const gasPaid = receipt.gasUsed * receipt.gasPrice;
    const after = await ethers.provider.getBalance(memberA.address);
    expect(after + gasPaid - before).to.be.gt(0n);
  });

  it("reverts when claiming access token or non-existent external rewards", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, , member] = accounts;

    await mintToUsers(token, [member], ENTRY_FEE * 3n);
    await purchaseAccess(templ, token, [member]);

    await expect(
      templ.connect(member).claimExternalToken(await token.getAddress())
    ).to.be.revertedWithCustomError(templ, "InvalidCallData");

    const randomToken = ethers.Wallet.createRandom().address;
    await expect(templ.connect(member).claimExternalToken(randomToken)).to.be.revertedWithCustomError(
      templ,
      "NoRewardsToClaim"
    );
  });

  it("enforces member pool and external reward balance guards", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, , memberA, memberB, donor] = accounts;

    await mintToUsers(token, [memberA, memberB, donor], ENTRY_FEE * 6n);
    await purchaseAccess(templ, token, [memberA, memberB]);

    // Create ERC20 reward distribution
    const OtherToken = await ethers.getContractFactory("contracts/mocks/TestToken.sol:TestToken");
    const otherToken = await OtherToken.deploy("Bonus", "BON", 18);
    const donation = ethers.parseUnits("6", 18);
    await otherToken.mint(donor.address, donation);
    await otherToken.connect(donor).transfer(await templ.getAddress(), donation);

    await templ
      .connect(memberA)
      .createProposalDisbandTreasury(otherToken.target, VOTING_PERIOD);
    await templ.connect(memberA).vote(0, true);
    await templ.connect(memberB).vote(0, true);
    await ethers.provider.send("evm_increaseTime", [VOTING_PERIOD + DAY]);
    await ethers.provider.send("evm_mine", []);
    await templ.executeProposal(0);

    const claimable = await templ.getClaimableExternalToken(memberA.address, otherToken.target);
    expect(claimable).to.be.gt(0n);

    const templAddr = await templ.getAddress();
    const poolSlot = ethers.toBeHex(7, 32);

    // Zero out member pool balance before claiming to trigger the guard
    await ethers.provider.send("hardhat_setStorageAt", [
      templAddr,
      poolSlot,
      ethers.ZeroHash
    ]);
    await ethers.provider.send("evm_mine", []);

    await expect(templ.connect(memberA).claimMemberPool()).to.be.revertedWithCustomError(
      templ,
      "InsufficientPoolBalance"
    );

    // Restore member pool balance for subsequent checks
    await templ
      .connect(memberA)
      .createProposalDisbandTreasury(await token.getAddress(), VOTING_PERIOD);
    await templ.connect(memberA).vote(1, true);
    await templ.connect(memberB).vote(1, true);
    await ethers.provider.send("evm_increaseTime", [VOTING_PERIOD + DAY]);
    await ethers.provider.send("evm_mine", []);
    await templ.executeProposal(1);

    // Corrupt external reward pool to trigger InsufficientPoolBalance during claim
    const mappingSlot = ethers.toBeHex(25, 32);
    const baseKey = ethers.keccak256(
      ethers.concat([ethers.zeroPadValue(otherToken.target, 32), mappingSlot])
    );

    await ethers.provider.send("hardhat_setStorageAt", [
      templAddr,
      ethers.toBeHex(BigInt(baseKey), 32),
      ethers.ZeroHash
    ]);
    await ethers.provider.send("evm_mine", []);

    await expect(
      templ.connect(memberA).claimExternalToken(otherToken.target)
    ).to.be.revertedWithCustomError(templ, "InsufficientPoolBalance");
  });

  it("captures rounding remainders when splits don't divide evenly", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, , memberA, memberB] = accounts;

    await mintToUsers(token, [memberA, memberB], ENTRY_FEE * 50n);
    await purchaseAccess(templ, token, [memberA]);

    const newEntryFee = ENTRY_FEE + 10n;
    const proposalId = await templ.proposalCount();
    await templ
      .connect(memberA)
      .createProposalUpdateConfig(newEntryFee, 31, 31, 28, true, VOTING_PERIOD);
    await templ.connect(memberA).vote(proposalId, true);
    await ethers.provider.send("evm_increaseTime", [VOTING_PERIOD + DAY]);
    await ethers.provider.send("evm_mine", []);
    await templ.executeProposal(proposalId);

    const treasuryBefore = await templ.treasuryBalance();
    await purchaseAccess(templ, token, [memberB]);
    const treasuryAfter = await templ.treasuryBalance();

    const treasuryPortion = (newEntryFee * 31n) / 100n;
    const memberPortion = (newEntryFee * 28n) / 100n;
    const burnPortion = (newEntryFee * 31n) / 100n;
    const protocolPortion = (newEntryFee * 10n) / 100n;
    const distributed = treasuryPortion + memberPortion + burnPortion + protocolPortion;
    const expectedRemainder = newEntryFee - distributed;

    expect(treasuryAfter - treasuryBefore).to.equal(treasuryPortion + expectedRemainder);
  });
});
