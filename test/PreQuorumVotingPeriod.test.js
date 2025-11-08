const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, joinMembers } = require("./utils/mintAndPurchase");

describe("Pre‑quorum voting period controls", function () {
  const ENTRY_FEE = ethers.parseUnits("100", 18);
  const DAY = 24 * 60 * 60;
  const MIN = 36 * 60 * 60; // 36 hours
  const MAX = 30 * DAY;     // 30 days

  it("dictatorship (onlyDAO) can set default pre‑quorum period within bounds", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, priest, member] = accounts;

    await mintToUsers(token, [member], ENTRY_FEE * 3n);
    await joinMembers(templ, token, [member]);

    // Enable dictatorship via proposal
    await templ
      .connect(member)
      .createProposalSetDictatorship(true, 7 * DAY, "Enable", "Dictatorship on");
    await templ.connect(member).vote(0, true);
    await ethers.provider.send("evm_increaseTime", [7 * DAY + 1]);
    await ethers.provider.send("evm_mine", []);
    await templ.executeProposal(0);
    expect(await templ.priestIsDictator()).to.equal(true);

    const before = await templ.preQuorumVotingPeriod();
    const newPeriod = 2 * DAY;
    await expect(templ.connect(priest).setPreQuorumVotingPeriodDAO(newPeriod))
      .to.emit(templ, "PreQuorumVotingPeriodUpdated")
      .withArgs(before, BigInt(newPeriod));
    expect(await templ.preQuorumVotingPeriod()).to.equal(BigInt(newPeriod));

    // Out of range: too small
    await expect(
      templ.connect(priest).setPreQuorumVotingPeriodDAO(MIN - 1)
    ).to.be.revertedWithCustomError(templ, "InvalidCallData");

    // Out of range: too large
    await expect(
      templ.connect(priest).setPreQuorumVotingPeriodDAO(MAX + 1)
    ).to.be.revertedWithCustomError(templ, "InvalidCallData");
  });

  it("governance can set pre‑quorum default via CallExternal and new proposals inherit it when passing 0", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [, , m1, m2, m3] = accounts;
    await mintToUsers(token, [m1, m2, m3], ENTRY_FEE * 6n);
    await joinMembers(templ, token, [m1, m2, m3]);

    const router = await templ.getAddress();
    const selector = templ.interface.getFunction("setPreQuorumVotingPeriodDAO").selector;
    const params = ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [3 * DAY]);

    await templ
      .connect(m1)
      .createProposalCallExternal(router, 0, selector, params, 7 * DAY, "Set pre‑quorum", "update default");
    const id = (await templ.proposalCount()) - 1n;
    await templ.connect(m2).vote(id, true);
    await ethers.provider.send("evm_increaseTime", [7 * DAY + 1]);
    await ethers.provider.send("evm_mine", []);
    await templ.executeProposal(id);
    expect(await templ.preQuorumVotingPeriod()).to.equal(3n * BigInt(DAY));

    // Create a new proposal with votingPeriod=0 -> should default to updated pre‑quorum period
    // With 4 eligible voters (priest + 3 members), auto-YES from proposer is 1/4 < 33%,
    // so endTime should be createdAt + preQuorumVotingPeriod (not the post-quorum delay).
    await templ.connect(m1).createProposalSetJoinPaused(false, 0, "Check default", "");
    const lastId = (await templ.proposalCount()) - 1n;
    const p2 = await templ.getProposal(Number(lastId));
    const snapshots = await templ.getProposalSnapshots(Number(lastId));
    const endTime = BigInt(p2.endTime);
    const createdAt = BigInt(snapshots[4]);
    expect(endTime - createdAt).to.equal(3n * 24n * 60n * 60n);
  });
});
