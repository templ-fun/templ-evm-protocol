const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, joinMembers } = require("./utils/mintAndPurchase");

const ENTRY_FEE = ethers.parseUnits("100", 18);
const DAY = 24 * 60 * 60;
const VOTING_PERIOD = 7 * DAY;
const computeJoinFee = async (templ, prospectiveCount) => {
    const entry = await templ.entryFee();
    const curve = await templ.feeCurve();
    const formula = Number(curve[0]);
    if (formula === 0) {
        return entry;
    }
    const count = typeof prospectiveCount === "bigint" ? prospectiveCount : BigInt(prospectiveCount);
    if (formula === 1) {
        return entry + (curve[1] * count) / curve[2];
    }
    if (formula === 2) {
        let growth = curve[2];
        for (let i = 0n; i < count; i += 1n) {
            growth = (growth * curve[1]) / curve[2];
        }
        return (entry * growth) / curve[2];
    }
    throw new Error(`Unsupported fee curve formula: ${formula}`);
};

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

  it("returns join metadata for members and non-members", async function () {
    const { templ, token, accounts } = await deployTempl({
      entryFee: ENTRY_FEE,
      feeCurveOverride: null,
      useFixture: false
    });
    const [, , member, outsider] = accounts;

    await mintToUsers(token, [member], ENTRY_FEE * 2n);
    await joinMembers(templ, token, [member]);

    const joined = await templ.getJoinDetails(member.address);
    expect(joined.joined).to.equal(true);

    const neverJoined = await templ.getJoinDetails(outsider.address);
    expect(neverJoined.joined).to.equal(false);
  });

  it("allows gifting membership via joinFor", async function () {
    const { templ, token, accounts } = await deployTempl({
      entryFee: ENTRY_FEE,
      feeCurveOverride: null,
      useFixture: false
    });
    const [, , payer, recipient] = accounts;

    await mintToUsers(token, [payer], ENTRY_FEE * 2n);
    await token.connect(payer).approve(await templ.getAddress(), ENTRY_FEE * 2n);

    const joinTx = await templ.connect(payer).joinFor(recipient.address);
    const receipt = await joinTx.wait();
    const memberJoined = receipt.logs
      .map((log) => {
        try {
          return templ.interface.parseLog(log);
        } catch (_) {
          return null;
        }
      })
      .find((log) => log && log.name === "MemberJoined");

    expect(memberJoined, "member joined event").to.not.equal(undefined);
    expect(memberJoined.args.payer).to.equal(payer.address);
    expect(memberJoined.args.member).to.equal(recipient.address);
    expect(await templ.isMember(recipient.address)).to.equal(true);
    expect(await templ.isMember(payer.address)).to.equal(false);

    await expect(
      templ.connect(payer).joinFor(recipient.address)
    ).to.be.revertedWithCustomError(templ, "MemberAlreadyJoined");
  });

  it("applies linear fee curves to join costs", async function () {
    const slope = ethers.parseUnits("1", 18);
    const scale = 1n;
    const { templ, token, accounts, priest } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, , memberA, memberB] = accounts;

    await templ
      .connect(priest)
      .createProposalSetFeeCurve(
        1,
        slope,
        scale,
        7 * 24 * 60 * 60,
        "Set linear fee curve",
        "Increase join cost linearly"
      );
    await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine", []);
    await templ.executeProposal(0);

    const templAddress = await templ.getAddress();
    const initialMembers = await templ.memberCount();
    const firstFee = await computeJoinFee(templ, initialMembers);
    expect(firstFee).to.equal(ENTRY_FEE + slope);

    await token.mint(memberA.address, firstFee);
    await token.connect(memberA).approve(templAddress, firstFee);
    const firstJoin = await templ.connect(memberA).join();
    const firstReceipt = await firstJoin.wait();
    const firstEvent = firstReceipt.logs
      .map((log) => {
        try {
          return templ.interface.parseLog(log);
        } catch (_) {
          return null;
        }
      })
      .find((log) => log && log.name === "MemberJoined");

    expect(firstEvent).to.not.equal(undefined);
    expect(firstEvent.args.totalAmount).to.equal(firstFee);

    const postJoinMembers = await templ.memberCount();
    const secondFee = await computeJoinFee(templ, postJoinMembers);
    expect(secondFee).to.equal(ENTRY_FEE + (slope * 2n) / scale);

    await token.mint(memberB.address, secondFee);
    await token.connect(memberB).approve(templAddress, secondFee);
    const secondJoin = await templ.connect(memberB).join();
    const secondReceipt = await secondJoin.wait();
    const secondEvent = secondReceipt.logs
      .map((log) => {
        try {
          return templ.interface.parseLog(log);
        } catch (_) {
          return null;
        }
      })
      .find((log) => log && log.name === "MemberJoined");

    expect(secondEvent).to.not.equal(undefined);
    expect(secondEvent.args.totalAmount).to.equal(secondFee);

    const curveState = await templ.feeCurve();
    expect(curveState[0]).to.equal(1);
    expect(curveState[1]).to.equal(slope);
    expect(curveState[2]).to.equal(scale);
  });

  it("defaults to exponential fee growth with ten percent steps", async function () {
    const DEFAULT_SCALE = ethers.parseUnits("1", 18);
    const DEFAULT_SLOPE = ethers.parseUnits("1.1", 18);

    const accounts = await ethers.getSigners();
    const [, priest, protocol, memberA, memberB] = accounts;

    const Token = await ethers.getContractFactory("contracts/mocks/TestToken.sol:TestToken");
    const token = await Token.deploy("Test Token", "TEST", 18);
    await token.waitForDeployment();

    const TEMPL = await ethers.getContractFactory("TEMPL");
    const templ = await TEMPL.deploy(
      priest.address,
      protocol.address,
      await token.getAddress(),
      ENTRY_FEE,
      30,
      30,
      30,
      10,
      33,
      7 * 24 * 60 * 60,
      ethers.ZeroAddress,
      false,
      0,
      ""
    );
    await templ.waitForDeployment();

    const curveState = await templ.feeCurve();
    expect(curveState[0]).to.equal(2);
    expect(curveState[1]).to.equal(DEFAULT_SLOPE);
    expect(curveState[2]).to.equal(DEFAULT_SCALE);

    const initialMembers = await templ.memberCount();
    const firstFee = await computeJoinFee(templ, initialMembers);
    const expectedFirst = (ENTRY_FEE * DEFAULT_SLOPE) / DEFAULT_SCALE;
    expect(firstFee).to.equal(expectedFirst);

    const templAddress = await templ.getAddress();

    await token.mint(memberA.address, expectedFirst);
    await token.connect(memberA).approve(templAddress, expectedFirst);
    await templ.connect(memberA).join();

    const secondMembers = await templ.memberCount();
    const secondFee = await computeJoinFee(templ, secondMembers);
    const expectedSecond = (expectedFirst * DEFAULT_SLOPE) / DEFAULT_SCALE;
    expect(secondFee).to.equal(expectedSecond);

    await token.mint(memberB.address, expectedSecond);
    await token.connect(memberB).approve(templAddress, expectedSecond);
    await templ.connect(memberB).join();

    const thirdMembers = await templ.memberCount();
    const thirdFee = await computeJoinFee(templ, thirdMembers);
    const expectedThird = (expectedSecond * DEFAULT_SLOPE) / DEFAULT_SCALE;
    expect(thirdFee).to.equal(expectedThird);
  });

  it("rejects external reward claims using the access token", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, , member] = accounts;

    await mintToUsers(token, [member], ENTRY_FEE * 2n);
    await joinMembers(templ, token, [member]);

    await expect(
      templ.connect(member).claimExternalReward(await token.getAddress())
    ).to.be.revertedWithCustomError(templ, "InvalidCallData");
  });

  it("handles external reward lookups across all branches", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, , memberA, memberB, donor, newcomer] = accounts;

    await mintToUsers(token, [memberA, memberB, donor, newcomer], ENTRY_FEE * 6n);
    await joinMembers(templ, token, [memberA, memberB]);

    // Access token path short-circuits to zero
    expect(
      await templ.getClaimableExternalReward(memberA.address, await token.getAddress())
    ).to.equal(0n);

    // Unknown token path returns zero without membership short-circuit
    const randomToken = ethers.Wallet.createRandom().address;
    expect(
      await templ.getClaimableExternalReward(memberA.address, randomToken)
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
    const claimable = await templ.getClaimableExternalReward(memberA.address, otherToken.target);
    expect(claimable).to.be.gt(0n);

    // New members sync snapshots to zero
    await joinMembers(templ, token, [newcomer]);
    expect(
      await templ.getClaimableExternalReward(newcomer.address, otherToken.target)
    ).to.equal(0n);

    // Claim rewards to cover snapshot updates and ternary false path
    const balanceBefore = await otherToken.balanceOf(memberA.address);
    await templ.connect(memberA).claimExternalReward(otherToken.target);
    const balanceAfter = await otherToken.balanceOf(memberA.address);
    expect(balanceAfter - balanceBefore).to.equal(claimable);
    expect(
      await templ.getClaimableExternalReward(memberA.address, otherToken.target)
    ).to.equal(0n);

    await expect(
      templ.connect(memberA).claimExternalReward(otherToken.target)
    ).to.be.revertedWithCustomError(templ, "NoRewardsToClaim");
  });

  it("reverts when non-members attempt to claim external rewards", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, , member, outsider] = accounts;

    await mintToUsers(token, [member], ENTRY_FEE * 3n);
    await joinMembers(templ, token, [member]);

    await expect(
      templ.connect(outsider).claimExternalReward(ethers.ZeroAddress)
    ).to.be.revertedWithCustomError(templ, "NotMember");
  });

  it("guards member pool claim and exposes zero-available treasury info", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, , member] = accounts;

    await mintToUsers(token, [member], ENTRY_FEE * 3n);
    await joinMembers(templ, token, [member]);

    await expect(templ.connect(member).claimMemberRewards()).to.be.revertedWithCustomError(
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
    await joinMembers(templ, token, [memberA, memberB]);

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
    const tx = await templ.connect(memberA).claimExternalReward(ethers.ZeroAddress);
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
    await claimer.joinTempl(await templ.getAddress(), await token.getAddress(), ENTRY_FEE);

    await joinMembers(templ, token, [memberA, memberB]);

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
    await joinMembers(templ, token, [member]);

    await expect(
      templ.connect(member).claimExternalReward(await token.getAddress())
    ).to.be.revertedWithCustomError(templ, "InvalidCallData");

    const randomToken = ethers.Wallet.createRandom().address;
    await expect(templ.connect(member).claimExternalReward(randomToken)).to.be.revertedWithCustomError(
      templ,
      "NoRewardsToClaim"
    );
  });

  it("enforces member pool and external reward balance guards", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, , memberA, memberB, donor] = accounts;

    await mintToUsers(token, [memberA, memberB, donor], ENTRY_FEE * 6n);
    await joinMembers(templ, token, [memberA, memberB]);

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

    const claimable = await templ.getClaimableExternalReward(memberA.address, otherToken.target);
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

    await expect(templ.connect(memberA).claimMemberRewards()).to.be.revertedWithCustomError(
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
      templ.connect(memberA).claimExternalReward(otherToken.target)
    ).to.be.revertedWithCustomError(templ, "InsufficientPoolBalance");
  });

  it("captures rounding remainders when splits don't divide evenly", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, , memberA, memberB] = accounts;

    await mintToUsers(token, [memberA, memberB], ENTRY_FEE * 50n);
    await joinMembers(templ, token, [memberA]);

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
    await joinMembers(templ, token, [memberB]);
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
