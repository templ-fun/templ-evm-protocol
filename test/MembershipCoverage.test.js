const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, purchaseAccess } = require("./utils/mintAndPurchase");

const ENTRY_FEE = ethers.parseUnits("100", 18);
const DAY = 24 * 60 * 60;
const VOTING_PERIOD = 7 * DAY;

async function findMemberPoolSlot(templ, contractAddress, maxSlots = 200) {
  const expected = await templ.memberPoolBalance();
  if (expected === 0n) {
    throw new Error("memberPoolBalance is zero; cannot locate slot");
  }
  const target = ethers.zeroPadValue(ethers.toBeHex(expected), 32);
  for (let slotIndex = 0; slotIndex < maxSlots; slotIndex += 1) {
    const slot = ethers.toBeHex(slotIndex, 32);
    const current = await ethers.provider.send("eth_getStorageAt", [contractAddress, slot, "latest"]);
    if (current !== target) continue;

    await ethers.provider.send("hardhat_setStorageAt", [contractAddress, slot, ethers.ZeroHash]);
    const updated = await templ.memberPoolBalance();
    await ethers.provider.send("hardhat_setStorageAt", [contractAddress, slot, current]);

    if (updated === 0n) {
      return slot;
    }
  }
  throw new Error("Unable to locate memberPoolBalance storage slot");
}

async function findExternalRewardPoolSlot(templ, contractAddress, tokenAddress, maxSlots = 200) {
  const rewardState = await templ.getExternalRewardState(tokenAddress);
  const poolBalance = rewardState[0];
  if (poolBalance === 0n) {
    throw new Error("external reward pool balance is zero; cannot locate slot");
  }
  const encodedKey = ethers.zeroPadValue(tokenAddress, 32);
  const targetValue = ethers.zeroPadValue(ethers.toBeHex(poolBalance), 32);
  for (let slotIndex = 0; slotIndex < maxSlots; slotIndex += 1) {
    const slot = ethers.toBeHex(slotIndex, 32);
    const storageSlot = ethers.keccak256(ethers.concat([encodedKey, slot]));
    const stored = await ethers.provider.send("eth_getStorageAt", [
      contractAddress,
      ethers.toBeHex(BigInt(storageSlot), 32),
      "latest"
    ]);
    if (stored !== targetValue) continue;

    await ethers.provider.send("hardhat_setStorageAt", [
      contractAddress,
      ethers.toBeHex(BigInt(storageSlot), 32),
      ethers.ZeroHash
    ]);
    const updatedState = await templ.getExternalRewardState(tokenAddress);
    await ethers.provider.send("hardhat_setStorageAt", [
      contractAddress,
      ethers.toBeHex(BigInt(storageSlot), 32),
      targetValue
    ]);
    if (updatedState[0] === 0n) {
      return storageSlot;
    }
  }
  throw new Error("Unable to locate external reward pool storage slot");
}

describe("Membership coverage extras", function () {
  it("reports zero available treasury when no funds are held", async function () {
    const { templ } = await deployTempl({ entryFee: ENTRY_FEE });
    const treasuryInfo = await templ.getTreasuryInfo();
    expect(treasuryInfo.treasury).to.equal(0n);
    expect(treasuryInfo.memberPool).to.equal(0n);
  });

  it("returns purchase metadata for members and non-members", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, , member, outsider] = accounts;

    await mintToUsers(token, [member], ENTRY_FEE * 2n);
    await purchaseAccess(templ, token, [member]);

    const joined = await templ.getPurchaseDetails(member.address);
    expect(joined.purchased).to.equal(true);

    const neverJoined = await templ.getPurchaseDetails(outsider.address);
    expect(neverJoined.purchased).to.equal(false);
  });

  it("rejects external reward claims using the access token", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, , member] = accounts;

    await mintToUsers(token, [member], ENTRY_FEE * 2n);
    await purchaseAccess(templ, token, [member]);

    await expect(
      templ.connect(member).claimExternalToken(await token.getAddress())
    ).to.be.revertedWithCustomError(templ, "InvalidCallData");
  });

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

  it("reverts when non-members attempt to claim external rewards", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, , member, outsider] = accounts;

    await mintToUsers(token, [member], ENTRY_FEE * 3n);
    await purchaseAccess(templ, token, [member]);

    await expect(
      templ.connect(outsider).claimExternalToken(ethers.ZeroAddress)
    ).to.be.revertedWithCustomError(templ, "NotMember");
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

  it("reverts when ETH external reward claims cannot transfer funds", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, priest, memberA, memberB] = accounts;

    await mintToUsers(token, [memberA, memberB], ENTRY_FEE * 6n);

    const Claimer = await ethers.getContractFactory("contracts/mocks/RevertingClaimer.sol:RevertingClaimer");
    const claimer = await Claimer.deploy();
    await claimer.waitForDeployment();

    // Seed contract with tokens and join as member
    await token.mint(claimer.target, ENTRY_FEE);
    await claimer.purchaseMembership(await templ.getAddress(), await token.getAddress(), ENTRY_FEE);

    await purchaseAccess(templ, token, [memberA, memberB]);

    const donation = ethers.parseUnits("3", 18);
    await priest.sendTransaction({ to: await templ.getAddress(), value: donation });

    await templ
      .connect(memberA)
      .createProposalDisbandTreasury(ethers.ZeroAddress, VOTING_PERIOD);
    await templ.connect(memberA).vote(0, true);
    await templ.connect(memberB).vote(0, true);
    await ethers.provider.send("evm_increaseTime", [VOTING_PERIOD + DAY]);
    await ethers.provider.send("evm_mine", []);
    await templ.executeProposal(0);

    await expect(
      claimer.claimExternal(await templ.getAddress(), ethers.ZeroAddress)
    ).to.be.revertedWithCustomError(templ, "ProposalExecutionFailed");
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
    expect(await templ.memberPoolBalance()).to.be.gt(0n);
    const poolSlot = await findMemberPoolSlot(templ, templAddr);

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
    const rewardSlot = await findExternalRewardPoolSlot(templ, templAddr, otherToken.target);

    await ethers.provider.send("hardhat_setStorageAt", [
      templAddr,
      rewardSlot,
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
      .createProposalUpdateConfig(newEntryFee, 3100, 3100, 2800, true, VOTING_PERIOD);
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
