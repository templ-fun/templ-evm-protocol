const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, joinMembers } = require("./utils/mintAndPurchase");

describe("Load: joins + concurrent proposals/votes/execution @load", function () {
  this.timeout(180_000);

  const BPS = 10_000n;
  const MIN_PRE_QUORUM = 36 * 60 * 60;
  const MIN_POST_QUORUM = 60 * 60;
  const TARGET_MEMBERS = parseInt(process.env.LOAD_MEMBERS || "30", 10);
  const TARGET_PROPOSALS = parseInt(process.env.LOAD_PROPOSALS || "15", 10);
  const TARGET_VOTERS = parseInt(process.env.LOAD_VOTERS || "12", 10);
  const TX_BATCH_SIZE = parseInt(process.env.LOAD_BATCH || "8", 10);
  const MINT_MULTIPLIER = parseInt(process.env.LOAD_MINT_MULT || "5", 10);

  const ceilDiv = (num, denom) => (num + denom - 1n) / denom;

  const pickVoters = (members, proposerIndex, count) => {
    const voters = [];
    let cursor = (proposerIndex + 1) % members.length;
    while (voters.length < count) {
      if (cursor !== proposerIndex) {
        voters.push(members[cursor]);
      }
      cursor = (cursor + 1) % members.length;
    }
    return voters;
  };

  const buildBatches = (tasks, batchSize) => {
    const queues = new Map();
    for (const task of tasks) {
      const key = task.signer.address.toLowerCase();
      const queue = queues.get(key);
      if (queue) {
        queue.push(task);
      } else {
        queues.set(key, [task]);
      }
    }
    const batches = [];
    for (;;) {
      const unique = [];
      for (const queue of queues.values()) {
        if (queue.length > 0) {
          unique.push(queue.shift());
        }
      }
      if (unique.length === 0) {
        break;
      }
      for (let i = 0; i < unique.length; i += batchSize) {
        batches.push(unique.slice(i, i + batchSize));
      }
    }
    return batches;
  };

  const waitForReceipts = async (provider, txs) => {
    const hashes = txs.map((tx) => tx.hash);
    const maxMines = Math.max(3, hashes.length + 2);
    for (let i = 0; i < maxMines; i += 1) {
      const receipts = await Promise.all(
        hashes.map((hash) => provider.getTransactionReceipt(hash))
      );
      if (receipts.every(Boolean)) {
        return receipts;
      }
      await provider.send("evm_mine");
    }
    throw new Error("Timed out waiting for batch receipts");
  };

  const mineBatches = async (tasks, batchSize) => {
    if (tasks.length === 0) {
      return;
    }
    const provider = ethers.provider;
    const batches = buildBatches(tasks, batchSize);
    await provider.send("evm_setAutomine", [false]);
    try {
      for (const batch of batches) {
        const txs = await Promise.all(batch.map((task) => task.send()));
        await provider.send("evm_mine");
        await waitForReceipts(provider, txs);
      }
    } finally {
      await provider.send("evm_setAutomine", [true]);
    }
  };

  it("sustains high-concurrency governance flow @load", async function () {
    const { templ, token, accounts } = await deployTempl({
      executionDelay: MIN_POST_QUORUM
    });

    const members = [...accounts];
    const extraCount = Math.max(0, TARGET_MEMBERS - members.length);
    const extraWallets = [];
    for (let i = 0; i < extraCount; i += 1) {
      extraWallets.push(ethers.Wallet.createRandom().connect(ethers.provider));
    }
    if (extraWallets.length > 0) {
      const funder = accounts[0];
      for (const wallet of extraWallets) {
        const tx = await funder.sendTransaction({
          to: wallet.address,
          value: ethers.parseEther("1")
        });
        await tx.wait();
      }
      members.push(...extraWallets);
    }

    const entryFee = await templ.entryFee();
    await mintToUsers(token, members, entryFee * BigInt(MINT_MULTIPLIER));
    await joinMembers(templ, token, members);

    const memberCount = await templ.getMemberCount();
    expect(memberCount).to.be.greaterThan(1n);
    expect(memberCount).to.equal(BigInt(members.length));

    const proposalCount = Math.min(TARGET_PROPOSALS, members.length);
    const quorumBps = await templ.quorumBps();
    const requiredYes = ceilDiv(memberCount * BigInt(quorumBps), BPS);
    const minAdditionalYes = requiredYes > 0n ? Number(requiredYes - 1n) : 0;
    const votersPerProposal = Math.min(
      Math.max(TARGET_VOTERS, minAdditionalYes),
      members.length - 1
    );
    expect(votersPerProposal).to.be.greaterThan(0);

    const startId = await templ.proposalCount();
    const proposalTasks = [];
    for (let i = 0; i < proposalCount; i += 1) {
      const proposer = members[i];
      proposalTasks.push({
        signer: proposer,
        send: () =>
          templ
            .connect(proposer)
            .createProposalSetJoinPaused(
              i % 2 === 0,
              MIN_PRE_QUORUM,
              `Load ${i}`,
              `Load proposal ${i}`
            )
      });
    }
    await mineBatches(proposalTasks, Math.max(1, TX_BATCH_SIZE));

    const endId = await templ.proposalCount();
    expect(endId - startId).to.equal(BigInt(proposalCount));
    const proposalIds = Array.from({ length: proposalCount }, (_, i) => startId + BigInt(i));

    const voteTasks = [];
    for (let i = 0; i < proposalCount; i += 1) {
      const voters = pickVoters(members, i, votersPerProposal);
      for (const voter of voters) {
        voteTasks.push({
          signer: voter,
          send: () => templ.connect(voter).vote(proposalIds[i], true)
        });
      }
    }
    await mineBatches(voteTasks, Math.max(1, TX_BATCH_SIZE));

    await ethers.provider.send("evm_increaseTime", [MIN_POST_QUORUM + 1]);
    await ethers.provider.send("evm_mine");

    const executeTasks = [];
    for (let i = 0; i < proposalCount; i += 1) {
      const executor = members[(i + 3) % members.length];
      executeTasks.push({
        signer: executor,
        send: () => templ.connect(executor).executeProposal(proposalIds[i])
      });
    }
    await mineBatches(executeTasks, Math.max(1, TX_BATCH_SIZE));

    const active = await templ.getActiveProposals();
    expect(active.length).to.equal(0);
    for (const proposalId of proposalIds) {
      const proposal = await templ.getProposal(proposalId);
      expect(proposal.executed).to.equal(true);
    }
  });
});
