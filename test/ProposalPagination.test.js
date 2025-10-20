const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, joinMembers } = require("./utils/mintAndPurchase");
const { encodeSetJoinPausedDAO } = require("./utils/callDataBuilders");

describe("TEMPL - Proposal Pagination", function () {
  let templ, token;
  let owner, priest, user1, user2, user3, user4, user5;
  let accounts;
  const ENTRY_FEE = ethers.parseEther("100");

  beforeEach(async function () {
    ({ templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE }));
    [owner, priest, user1, user2, user3, user4, user5] = accounts;

    const users = [priest, user1, user2, user3, user4, user5];
    await mintToUsers(token, users, ENTRY_FEE * 2n);
    await joinMembers(templ, token, users, ENTRY_FEE * 2n);
  });

  describe("getActiveProposalsPaginated", function () {
    it("Should handle empty proposal list", async function () {
      const [proposalIds, hasMore] = await templ.getActiveProposalsPaginated(0, 10);
      expect(proposalIds).to.have.lengthOf(0);
      expect(hasMore).to.be.false;
    });

    it("Should return proposals within limit", async function () {
      // Create 5 proposals from different users
      const users = [priest, user1, user2, user3, user4];
      for (let i = 0; i < users.length; i++) {
        const calldata = encodeSetJoinPausedDAO(false);
        await templ.connect(users[i]).createProposal(
          `Proposal ${i}`,
          `Description ${i}`,
          calldata,
          7 * 24 * 60 * 60
        );
      }

      // Get first page with limit 3
      const [proposalIds, hasMore] = await templ.getActiveProposalsPaginated(0, 3);
      expect(proposalIds).to.have.lengthOf(3);
      expect(proposalIds[0]).to.equal(0);
      expect(proposalIds[1]).to.equal(1);
      expect(proposalIds[2]).to.equal(2);
      expect(hasMore).to.be.true;
    });

    it("Marks hasMore when active proposals remain beyond the requested window", async function () {
      const calldata = encodeSetJoinPausedDAO(false);
      await templ.connect(priest).createProposal("Window 0", "Win 0", calldata, 7 * 24 * 60 * 60);
      await templ.connect(user1).createProposal("Window 1", "Win 1", calldata, 7 * 24 * 60 * 60);
      await templ.connect(user2).createProposal("Window 2", "Win 2", calldata, 7 * 24 * 60 * 60);

      const [firstTwo, hasMore] = await templ.getActiveProposalsPaginated(0, 2);
      expect(firstTwo).to.deep.equal([0n, 1n]);
      expect(hasMore).to.equal(true);
    });

    it("copies active proposal ids when the limit exceeds the active count", async function () {
      const calldata = encodeSetJoinPausedDAO(false);
      await templ.connect(priest).createProposal("Alpha", "A", calldata, 7 * 24 * 60 * 60);
      await templ.connect(user1).createProposal("Beta", "B", calldata, 7 * 24 * 60 * 60);

      const [proposalIds, hasMore] = await templ.getActiveProposalsPaginated(0, 5);
      expect(proposalIds).to.deep.equal([0n, 1n]);
      expect(hasMore).to.be.false;
    });

    it("Should handle pagination correctly", async function () {
      // Create 7 proposals - need to handle one active proposal per user limit
      const calldata = encodeSetJoinPausedDAO(false);
      
      // First round: 5 users create proposals (0-4)
      const users = [priest, user1, user2, user3, user4];
      for (let i = 0; i < users.length; i++) {
        await templ.connect(users[i]).createProposal(
          `Proposal ${i}`,
          `Description ${i}`,
          calldata,
          7 * 24 * 60 * 60
        );
      }
      
      // Execute first 2 proposals to free up priest and user1
      // Ensure quorum (>=33% of 6 eligible voters => at least 2 yes)
      await templ.connect(priest).vote(0, true);
      await templ.connect(user2).vote(0, true);
      await templ.connect(user1).vote(1, true);
      await templ.connect(user3).vote(1, true);
      // Wait enough after quorum for execution
      await ethers.provider.send("evm_increaseTime", [7 * 24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine");
      await templ.executeProposal(0);
      await templ.executeProposal(1);
      
      // Create 2 more proposals (5-6) from freed users
      await templ.connect(priest).createProposal("Proposal 5", "Description 5", calldata, 14 * 24 * 60 * 60);
      await templ.connect(user1).createProposal("Proposal 6", "Description 6", calldata, 14 * 24 * 60 * 60);

      // At this moment proposals 2,3,4 are expired but not executed, and 5,6 are new and active = 2 active total
      // Proposals 0,1 are executed, 2,3,4 are expired, 5,6 are active
      
      // Get all active proposals
      const [allActive, hasMoreAll] = await templ.getActiveProposalsPaginated(0, 10);
      expect(allActive).to.have.lengthOf(2); // Only 5 and 6 are active
      expect(allActive).to.deep.equal([5n, 6n]);
      expect(hasMoreAll).to.be.false;
      
      // Test pagination with offset
      const [firstPage, hasMoreFirst] = await templ.getActiveProposalsPaginated(0, 1);
      expect(firstPage).to.have.lengthOf(1);
      expect(firstPage[0]).to.equal(5);
      expect(hasMoreFirst).to.be.true;

      const [secondPage, hasMoreSecond] = await templ.getActiveProposalsPaginated(1, 1);
      expect(secondPage).to.have.lengthOf(1);
      expect(secondPage[0]).to.equal(6);
      expect(hasMoreSecond).to.be.false;
    });

    it("Should filter out executed proposals", async function () {
      // Create proposals
      const calldata = encodeSetJoinPausedDAO(true);
      
      await templ.connect(priest).createProposal("P0", "D0", calldata, 7 * 24 * 60 * 60);
      await templ.connect(user1).createProposal("P1", "D1", calldata, 7 * 24 * 60 * 60);
      await templ.connect(user2).createProposal("P2", "D2", calldata, 7 * 24 * 60 * 60);

      // Vote and execute first proposal (reach quorum then wait)
      await templ.connect(priest).vote(0, true);
      await templ.connect(user1).vote(0, true);
      await ethers.provider.send("evm_increaseTime", [7 * 24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine");
      await templ.executeProposal(0);
      
      // Don't move time back, just check that executed proposals are filtered out
      // Proposals 1 and 2 are expired after advancing time

      // Should return empty since 0 is executed and 1,2 are expired
      const [proposalIds, hasMore] = await templ.getActiveProposalsPaginated(0, 10);
      expect(proposalIds).to.have.lengthOf(0);
      expect(hasMore).to.be.false;
      
      // Create new proposals to test filtering
      await templ.connect(priest).createProposal("P3", "D3", calldata, 7 * 24 * 60 * 60);
      await templ.connect(user1).createProposal("P4", "D4", calldata, 7 * 24 * 60 * 60);
      
      // Should return only the new active proposals
      const [newProposals, hasMoreNew] = await templ.getActiveProposalsPaginated(0, 10);
      expect(newProposals).to.have.lengthOf(2);
      expect(newProposals[0]).to.equal(3);
      expect(newProposals[1]).to.equal(4);
      expect(hasMoreNew).to.be.false;
    });

    it("Should filter out expired proposals", async function () {
      // Create proposals with different voting periods
      const calldata = encodeSetJoinPausedDAO(true);
      
      await templ.connect(priest).createProposal("P0", "D0", calldata, 7 * 24 * 60 * 60);
      await templ.connect(user1).createProposal("P1", "D1", calldata, 14 * 24 * 60 * 60);
      await templ.connect(user2).createProposal("P2", "D2", calldata, 21 * 24 * 60 * 60);

      // Fast forward past first proposal's expiry
      await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
      await ethers.provider.send("evm_mine");

      // Should only return proposals 1 and 2
      const [proposalIds, hasMore] = await templ.getActiveProposalsPaginated(0, 10);
      expect(proposalIds).to.have.lengthOf(2);
      expect(proposalIds[0]).to.equal(1);
      expect(proposalIds[1]).to.equal(2);
      expect(hasMore).to.be.false;
    });

    it("Should enforce limit constraints", async function () {
      // Should revert with 0 limit
      await expect(templ.getActiveProposalsPaginated(0, 0))
        .to.be.revertedWithCustomError(templ, "LimitOutOfRange");
      
      // Should revert with >100 limit
      await expect(templ.getActiveProposalsPaginated(0, 101))
        .to.be.revertedWithCustomError(templ, "LimitOutOfRange");
      
      // Should work with limit 1
      const [ids1, more1] = await templ.getActiveProposalsPaginated(0, 1);
      expect(ids1).to.have.lengthOf(0); // No proposals yet
      
      // Should work with limit 100
      const [ids100, more100] = await templ.getActiveProposalsPaginated(0, 100);
      expect(ids100).to.have.lengthOf(0); // No proposals yet
    });

    it("Should handle hasMore flag correctly", async function () {
      // Create exactly 3 proposals
      const calldata = encodeSetJoinPausedDAO(false);
      await templ.connect(priest).createProposal("P0", "D0", calldata, 7 * 24 * 60 * 60);
      await templ.connect(user1).createProposal("P1", "D1", calldata, 7 * 24 * 60 * 60);
      await templ.connect(user2).createProposal("P2", "D2", calldata, 7 * 24 * 60 * 60);

      // Get all 3 with limit 3 - should have no more
      const [all3, hasMore3] = await templ.getActiveProposalsPaginated(0, 3);
      expect(all3).to.have.lengthOf(3);
      expect(hasMore3).to.be.false;

      // Get 2 with limit 2 - should have more
      const [first2, hasMore2] = await templ.getActiveProposalsPaginated(0, 2);
      expect(first2).to.have.lengthOf(2);
      expect(hasMore2).to.be.true;

      // Get remaining 1 with offset 2 - should have no more
      const [last1, hasMoreLast] = await templ.getActiveProposalsPaginated(2, 2);
      expect(last1).to.have.lengthOf(1);
      expect(hasMoreLast).to.be.false;
    });

    it("Should handle mixed active/inactive proposals", async function () {
      // Create 5 proposals
      const calldata = encodeSetJoinPausedDAO(false);
      const users = [priest, user1, user2, user3, user4];
      
      for (let i = 0; i < 5; i++) {
        await templ.connect(users[i]).createProposal(`P${i}`, `D${i}`, calldata, 14 * 24 * 60 * 60);
      }

      // Vote on proposals 0, 2, 4 (ensure quorum)
      await templ.connect(priest).vote(0, true);
      await templ.connect(user1).vote(0, true);
      await templ.connect(priest).vote(2, true);
      await templ.connect(user1).vote(2, true);
      await templ.connect(priest).vote(4, true);
      await templ.connect(user1).vote(4, true);
      
      // Fast forward to execute them
      await ethers.provider.send("evm_increaseTime", [14 * 24 * 60 * 60 + 1]);
      await ethers.provider.send("evm_mine");
      
      // Execute proposals 0, 2, 4
      await templ.executeProposal(0);
      await templ.executeProposal(2);
      await templ.executeProposal(4);
      
      // Create new proposals from those users
      await templ.connect(priest).createProposal("P5", "D5", calldata, 14 * 24 * 60 * 60);
      await templ.connect(user2).createProposal("P6", "D6", calldata, 14 * 24 * 60 * 60);
      await templ.connect(user4).createProposal("P7", "D7", calldata, 14 * 24 * 60 * 60);

      // Should return proposals 1, 3 (expired but not executed), and 5, 6, 7 (new active ones)
      const [activeIds, hasMore] = await templ.getActiveProposalsPaginated(0, 20);
      expect(activeIds).to.have.lengthOf(3); // Only the 3 new ones are active
      expect(activeIds).to.include(5n);
      expect(activeIds).to.include(6n);  
      expect(activeIds).to.include(7n);
      expect(activeIds).to.not.include(0); // Executed
      expect(activeIds).to.not.include(1); // Expired
      expect(activeIds).to.not.include(2); // Executed  
      expect(activeIds).to.not.include(3); // Expired
      expect(activeIds).to.not.include(4); // Executed
    });

    it("Should return hasMore false when offset exceeds proposal count", async function () {
      const calldata = encodeSetJoinPausedDAO(false);
      await templ.connect(priest).createProposal("P0", "D0", calldata, 7 * 24 * 60 * 60);

      const [ids, hasMore] = await templ.getActiveProposalsPaginated(5, 10);
      expect(ids).to.have.lengthOf(0);
      expect(hasMore).to.be.false;
    });
  });

  describe("Backwards compatibility", function () {
    it("getActiveProposals should still work", async function () {
      // Create a few proposals
      const calldata = encodeSetJoinPausedDAO(false);
      await templ.connect(priest).createProposal("P0", "D0", calldata, 7 * 24 * 60 * 60);
      await templ.connect(user1).createProposal("P1", "D1", calldata, 7 * 24 * 60 * 60);
      await templ.connect(user2).createProposal("P2", "D2", calldata, 7 * 24 * 60 * 60);

      // Old function should return all active proposals
      const activeIds = await templ.getActiveProposals();
      expect(activeIds).to.have.lengthOf(3);
      expect(activeIds[0]).to.equal(0);
      expect(activeIds[1]).to.equal(1);
      expect(activeIds[2]).to.equal(2);
    });

    it("Both functions should return same results for small counts", async function () {
      // Create proposals
      const calldata = encodeSetJoinPausedDAO(false);
      await templ.connect(priest).createProposal("P0", "D0", calldata, 7 * 24 * 60 * 60);
      await templ.connect(user1).createProposal("P1", "D1", calldata, 7 * 24 * 60 * 60);

      // Get results from both functions
      const oldResult = await templ.getActiveProposals();
      const [newResult, hasMore] = await templ.getActiveProposalsPaginated(0, 100);

      // Should be identical
      expect(oldResult.length).to.equal(newResult.length);
      for (let i = 0; i < oldResult.length; i++) {
        expect(oldResult[i]).to.equal(newResult[i]);
      }
      expect(hasMore).to.be.false;
    });
  });
});
