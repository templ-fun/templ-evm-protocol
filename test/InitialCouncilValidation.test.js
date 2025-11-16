const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers } = require("./utils/mintAndPurchase");

const ENTRY_FEE = ethers.parseUnits("100", 18);
const TOKEN_SUPPLY = ethers.parseUnits("10000", 18);

describe("Initial Council Members Validation", function () {
  let accounts;
  let priest, member1, member2, member3, member4;

  beforeEach(async function () {
    accounts = await ethers.getSigners();
    [, priest, member1, member2, member3, member4] = accounts;
  });

  describe("Validation: Zero addresses", function () {
    it("reverts when initial council members contains zero address", async function () {
      await expect(
        deployTempl({
          entryFee: ENTRY_FEE,
          councilMode: true,
          initialCouncilMembers: [priest.address, ethers.ZeroAddress, member1.address]
        })
      ).to.be.revertedWithCustomError({ interface: (await ethers.getContractFactory("TEMPL")).interface }, "InvalidRecipient");
    });

    it("reverts when only zero address is provided", async function () {
      await expect(
        deployTempl({
          entryFee: ENTRY_FEE,
          councilMode: true,
          initialCouncilMembers: [ethers.ZeroAddress]
        })
      ).to.be.revertedWithCustomError({ interface: (await ethers.getContractFactory("TEMPL")).interface }, "InvalidRecipient");
    });
  });

  describe("Validation: Duplicate addresses", function () {
    it("reverts when initial council members contains duplicates", async function () {
      await expect(
        deployTempl({
          entryFee: ENTRY_FEE,
          councilMode: true,
          initialCouncilMembers: [priest.address, member1.address, priest.address]
        })
      ).to.be.revertedWithCustomError({ interface: (await ethers.getContractFactory("TEMPL")).interface }, "DuplicateCouncilMember");
    });

    it("reverts when two consecutive duplicates exist", async function () {
      await expect(
        deployTempl({
          entryFee: ENTRY_FEE,
          councilMode: true,
          initialCouncilMembers: [member1.address, member1.address]
        })
      ).to.be.revertedWithCustomError({ interface: (await ethers.getContractFactory("TEMPL")).interface }, "DuplicateCouncilMember");
    });

    it("reverts when all addresses are the same", async function () {
      await expect(
        deployTempl({
          entryFee: ENTRY_FEE,
          councilMode: true,
          initialCouncilMembers: [priest.address, priest.address, priest.address]
        })
      ).to.be.revertedWithCustomError({ interface: (await ethers.getContractFactory("TEMPL")).interface }, "DuplicateCouncilMember");
    });
  });

  describe("Validation: Array length limits", function () {
    it("reverts when initial council members exceeds 100 addresses", async function () {
      const largeArray = [];
      for (let i = 0; i < 101; i++) {
        // Generate unique addresses
        largeArray.push(ethers.Wallet.createRandom().address);
      }

      await expect(
        deployTempl({
          entryFee: ENTRY_FEE,
          councilMode: true,
          initialCouncilMembers: largeArray
        })
      ).to.be.revertedWithCustomError({ interface: (await ethers.getContractFactory("TEMPL")).interface }, "InitialCouncilTooLarge");
    });

    it("accepts exactly 100 initial council members", async function () {
      const largeArray = [];
      for (let i = 0; i < 100; i++) {
        largeArray.push(ethers.Wallet.createRandom().address);
      }

      const { templ } = await deployTempl({
        entryFee: ENTRY_FEE,
        councilMode: true,
        initialCouncilMembers: largeArray
      });

      expect(await templ.councilMemberCount()).to.equal(100n);
      expect(await templ.genesisMemberCount()).to.equal(101n); // 100 council + priest
    });
  });

  describe("Empty initial council array", function () {
    it("deploys successfully with empty initial council", async function () {
      const { templ } = await deployTempl({
        entryFee: ENTRY_FEE,
        councilMode: false,
        initialCouncilMembers: []
      });

      expect(await templ.memberCount()).to.equal(1n); // Only priest
      expect(await templ.genesisMemberCount()).to.equal(1n);
      expect(await templ.councilMemberCount()).to.equal(0n);
    });

    it("reverts when enabling council mode with empty initial council (no voters)", async function () {
      // Council mode cannot be enabled without any voters, so this should revert
      await expect(
        deployTempl({
          entryFee: ENTRY_FEE,
          councilMode: true,
          initialCouncilMembers: []
        })
      ).to.be.revertedWithCustomError({ interface: (await ethers.getContractFactory("TEMPL")).interface }, "NoMembers");
    });
  });

  describe("Priest in initial council", function () {
    it("enrolls priest only once when included in initial council", async function () {
      const { templ } = await deployTempl({
        entryFee: ENTRY_FEE,
        councilMode: true,
        initialCouncilMembers: [priest.address, member1.address]
      });

      expect(await templ.memberCount()).to.equal(2n);
      expect(await templ.genesisMemberCount()).to.equal(2n);
      expect(await templ.councilMemberCount()).to.equal(2n);
      expect(await templ.councilMembers(priest.address)).to.equal(true);
    });

    it("enrolls priest as member but not council when excluded from initial council", async function () {
      const { templ } = await deployTempl({
        entryFee: ENTRY_FEE,
        councilMode: true,
        initialCouncilMembers: [member1.address, member2.address]
      });

      // Priest is enrolled as a member
      const priestMemberData = await templ.members(priest.address);
      expect(priestMemberData.joined).to.equal(true);

      // But not on the council
      expect(await templ.councilMembers(priest.address)).to.equal(false);
      expect(await templ.councilMemberCount()).to.equal(2n);
      expect(await templ.memberCount()).to.equal(3n); // priest + 2 council members
    });
  });

  describe("Paid join count accuracy", function () {
    it("correctly tracks paid joins after genesis enrollment", async function () {
      const { templ, token } = await deployTempl({
        entryFee: ENTRY_FEE,
        councilMode: true,
        initialCouncilMembers: [priest.address, member1.address, member2.address]
      });

      expect(await templ.genesisMemberCount()).to.equal(3n);
      expect(await templ.memberCount()).to.equal(3n);
      expect(await templ.totalJoins()).to.equal(0n);

      // Perform 2 paid joins
      await mintToUsers(token, [member3, member4], TOKEN_SUPPLY);
      const templAddress = await templ.getAddress();
      await token.connect(member3).approve(templAddress, ENTRY_FEE);
      await templ.connect(member3).join();

      expect(await templ.memberCount()).to.equal(4n);
      expect(await templ.totalJoins()).to.equal(1n);

      await token.connect(member4).approve(templAddress, ENTRY_FEE);
      await templ.connect(member4).join();

      expect(await templ.memberCount()).to.equal(5n);
      expect(await templ.totalJoins()).to.equal(2n);
      expect(await templ.genesisMemberCount()).to.equal(3n); // Unchanged
    });

    it("join IDs start from 0 for first paid join after genesis members", async function () {
      const { templ, token } = await deployTempl({
        entryFee: ENTRY_FEE,
        councilMode: true,
        initialCouncilMembers: [priest.address, member1.address]
      });

      await mintToUsers(token, [member3], TOKEN_SUPPLY);
      const templAddress = await templ.getAddress();
      await token.connect(member3).approve(templAddress, ENTRY_FEE);
      const joinTx = await templ.connect(member3).join();
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

      expect(memberJoined.args.joinId).to.equal(0n);
    });
  });

  describe("Multiple unique addresses", function () {
    it("enrolls multiple unique addresses successfully", async function () {
      const { templ } = await deployTempl({
        entryFee: ENTRY_FEE,
        councilMode: true,
        initialCouncilMembers: [priest.address, member1.address, member2.address, member3.address]
      });

      expect(await templ.memberCount()).to.equal(4n);
      expect(await templ.genesisMemberCount()).to.equal(4n);
      expect(await templ.councilMemberCount()).to.equal(4n);

      expect(await templ.councilMembers(priest.address)).to.equal(true);
      expect(await templ.councilMembers(member1.address)).to.equal(true);
      expect(await templ.councilMembers(member2.address)).to.equal(true);
      expect(await templ.councilMembers(member3.address)).to.equal(true);
    });

    it("all genesis members have correct reward snapshot", async function () {
      const { templ } = await deployTempl({
        entryFee: ENTRY_FEE,
        councilMode: true,
        initialCouncilMembers: [priest.address, member1.address, member2.address]
      });

      const cumulativeRewards = await templ.cumulativeMemberRewards();

      for (const member of [priest, member1, member2]) {
        const memberData = await templ.members(member.address);
        expect(memberData.rewardSnapshot).to.equal(cumulativeRewards);
        expect(memberData.joined).to.equal(true);
      }
    });
  });

  describe("Pricing curve with genesis members", function () {
    it("pricing starts from base when only genesis members exist", async function () {
      const { templ } = await deployTempl({
        entryFee: ENTRY_FEE,
        councilMode: true,
        initialCouncilMembers: [priest.address, member1.address, member2.address]
      });

      const currentFee = await templ.entryFee();
      expect(currentFee).to.equal(ENTRY_FEE); // Should still be base fee
    });

    it("pricing increases correctly after paid joins", async function () {
      const { templ, token } = await deployTempl({
        entryFee: ENTRY_FEE,
        councilMode: true,
        initialCouncilMembers: [priest.address, member1.address],
        curve: {
          primary: { style: 1, rateBps: 10500, length: 0 }, // 5% increase per join
          additionalSegments: []
        }
      });

      const initialFee = await templ.entryFee();
      expect(initialFee).to.equal(ENTRY_FEE);

      // First paid join
      await mintToUsers(token, [member3], TOKEN_SUPPLY);
      const templAddress = await templ.getAddress();
      await token.connect(member3).approve(templAddress, ENTRY_FEE);
      await templ.connect(member3).join();

      const feeAfterOne = await templ.entryFee();
      // Linear curve: new_fee = base_fee * (1 + rate * joins) = 100 * 1.05 = 105
      expect(feeAfterOne).to.be.greaterThan(ENTRY_FEE);
    });
  });

  describe("Council mode enabled at deploy", function () {
    it("council mode works immediately with genesis council members", async function () {
      const { templ } = await deployTempl({
        entryFee: ENTRY_FEE,
        councilMode: true,
        initialCouncilMembers: [priest.address, member1.address, member2.address]
      });

      expect(await templ.councilModeEnabled()).to.equal(true);

      // Non-council member cannot vote
      const WEEK = 7 * 24 * 60 * 60;
      await templ.connect(member1).createProposalSetJoinPaused(true, WEEK, "pause", "");
      const proposalId = (await templ.proposalCount()) - 1n;

      // Council member can vote
      await templ.connect(priest).vote(proposalId, true);
      const [voted, support] = await templ.hasVoted(proposalId, priest.address);
      expect(voted).to.equal(true);
      expect(support).to.equal(true);
    });

    it("non-council members cannot vote when council mode enabled", async function () {
      const { templ, token } = await deployTempl({
        entryFee: ENTRY_FEE,
        councilMode: true,
        initialCouncilMembers: [priest.address, member1.address]
      });

      // Add a non-council member
      await mintToUsers(token, [member3], TOKEN_SUPPLY);
      const templAddress = await templ.getAddress();
      await token.connect(member3).approve(templAddress, ENTRY_FEE);
      await templ.connect(member3).join();

      expect(await templ.councilMembers(member3.address)).to.equal(false);

      const WEEK = 7 * 24 * 60 * 60;
      await templ.connect(member3).createProposalSetJoinPaused(true, WEEK, "pause", "");
      const proposalId = (await templ.proposalCount()) - 1n;

      // Non-council member vote should revert
      await expect(templ.connect(member3).vote(proposalId, true))
        .to.be.revertedWithCustomError(templ, "NotCouncil");
    });
  });

  describe("Bootstrap seat with genesis council", function () {
    it("bootstrap seat is available even with genesis council members", async function () {
      const { templ, token } = await deployTempl({
        entryFee: ENTRY_FEE,
        councilMode: true,
        initialCouncilMembers: [priest.address, member1.address]
      });

      expect(await templ.councilBootstrapConsumed()).to.equal(false);

      // member2 must join first before being added to council
      await mintToUsers(token, [member2], TOKEN_SUPPLY);
      const templAddress = await templ.getAddress();
      await token.connect(member2).approve(templAddress, ENTRY_FEE);
      await templ.connect(member2).join();

      await expect(templ.connect(priest).bootstrapCouncilMember(member2.address))
        .to.emit(templ, "CouncilMemberAdded")
        .withArgs(member2.address, priest.address);

      expect(await templ.councilBootstrapConsumed()).to.equal(true);
      expect(await templ.councilMemberCount()).to.equal(3n);
    });

    it("cannot use bootstrap seat twice", async function () {
      const { templ, token } = await deployTempl({
        entryFee: ENTRY_FEE,
        councilMode: true,
        initialCouncilMembers: [priest.address]
      });

      // member1 must join first
      await mintToUsers(token, [member1, member2], TOKEN_SUPPLY);
      const templAddress = await templ.getAddress();
      await token.connect(member1).approve(templAddress, ENTRY_FEE);
      await templ.connect(member1).join();

      await templ.connect(priest).bootstrapCouncilMember(member1.address);

      // member2 joins
      await token.connect(member2).approve(templAddress, ENTRY_FEE);
      await templ.connect(member2).join();

      await expect(templ.connect(priest).bootstrapCouncilMember(member2.address))
        .to.be.revertedWithCustomError(templ, "CouncilBootstrapConsumed");
    });
  });

  describe("Edge cases", function () {
    it("single genesis council member works correctly", async function () {
      const { templ } = await deployTempl({
        entryFee: ENTRY_FEE,
        councilMode: true,
        initialCouncilMembers: [member1.address] // Not including priest
      });

      expect(await templ.memberCount()).to.equal(2n); // priest + member1
      expect(await templ.councilMemberCount()).to.equal(1n);
      expect(await templ.councilMembers(priest.address)).to.equal(false);
      expect(await templ.councilMembers(member1.address)).to.equal(true);
    });

    it("genesisMemberCount persists correctly", async function () {
      const { templ, token } = await deployTempl({
        entryFee: ENTRY_FEE,
        councilMode: true,
        initialCouncilMembers: [priest.address, member1.address]
      });

      const initialGenesis = await templ.genesisMemberCount();
      expect(initialGenesis).to.equal(2n);

      // Add more members
      await mintToUsers(token, [member3, member4], TOKEN_SUPPLY);
      const templAddress = await templ.getAddress();
      await token.connect(member3).approve(templAddress, ENTRY_FEE);
      await templ.connect(member3).join();
      await token.connect(member4).approve(templAddress, ENTRY_FEE);
      await templ.connect(member4).join();

      // genesisMemberCount should not change
      expect(await templ.genesisMemberCount()).to.equal(initialGenesis);
      expect(await templ.memberCount()).to.equal(4n);
    });
  });
});
