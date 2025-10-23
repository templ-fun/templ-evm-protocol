const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, joinMembers } = require("./utils/mintAndPurchase");

describe("Governance adjustable params (quorum, delay, burn)", function () {
  const ENTRY_FEE = ethers.parseUnits("100", 18);
  const TOKEN_SUPPLY = ethers.parseUnits("10000", 18);

  it("priest (dictatorship) can update quorum, delay, burn via onlyDAO", async function () {
    const { templ, token, accounts, priest } = await deployTempl({ entryFee: ENTRY_FEE });
    const [owner, , member1, member2] = accounts;
    await mintToUsers(token, [member1, member2], TOKEN_SUPPLY);
    await joinMembers(templ, token, [member1, member2]);

    // Enable dictatorship via proposal first
    await templ.connect(member1).createProposalSetDictatorship(true, 7 * 24 * 60 * 60, "Enable dictatorship", "");
    await templ.connect(member2).vote(0, true);
    await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine");
    await templ.executeProposal(0);

    // Quorum
    await expect(templ.connect(priest).setQuorumBpsDAO(40))
      .to.emit(templ, "QuorumBpsUpdated").withArgs(3300n, 4000n);
    expect(await templ.quorumBps()).to.equal(4000n);

    // Delay
    await expect(templ.connect(priest).setPostQuorumVotingPeriodDAO(3 * 24 * 60 * 60))
      .to.emit(templ, "PostQuorumVotingPeriodUpdated");
    expect(await templ.postQuorumVotingPeriod()).to.equal(3n * 24n * 60n * 60n);

    // Burn address
    const newBurn = "0x0000000000000000000000000000000000000001";
    await expect(templ.connect(priest).setBurnAddressDAO(newBurn))
      .to.emit(templ, "BurnAddressUpdated");
    expect(await templ.burnAddress()).to.equal(newBurn);

    // Disable dictatorship again
    await templ.connect(priest).setDictatorshipDAO(false);
  });

  it("proposals can update quorum, delay, burn and getters expose payloads", async function () {
    const { templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE });
    const [owner, priest, member1, member2, member3] = accounts;
    await mintToUsers(token, [member1, member2, member3], TOKEN_SUPPLY);
    await joinMembers(templ, token, [member1, member2, member3]);

    // Set quorum proposal
    await templ.connect(member1).createProposalSetQuorumBps(45, 7 * 24 * 60 * 60, "Set quorum", "");
    let id = (await templ.proposalCount()) - 1n;
    const [, quorumPayload] = await templ.getProposalActionData(id);
    const decodedQuorum = ethers.AbiCoder.defaultAbiCoder().decode(["uint256"], quorumPayload)[0];
    expect(decodedQuorum).to.equal(45n);
    await templ.connect(member2).vote(id, true);
    await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine");
    await templ.executeProposal(id);
    expect(await templ.quorumBps()).to.equal(4500n);

    // Set delay proposal
    await templ.connect(member1).createProposalSetPostQuorumVotingPeriod(2 * 24 * 60 * 60, 7 * 24 * 60 * 60, "Set delay", "");
    let id2 = (await templ.proposalCount()) - 1n;
    const [, delayPayload] = await templ.getProposalActionData(id2);
    const decodedDelay = ethers.AbiCoder.defaultAbiCoder().decode(["uint256"], delayPayload)[0];
    expect(decodedDelay).to.equal(2n * 24n * 60n * 60n);
    await templ.connect(member3).vote(id2, true);
    await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine");
    await templ.executeProposal(id2);
    expect(await templ.postQuorumVotingPeriod()).to.equal(2n * 24n * 60n * 60n);

    // Set burn address proposal
    const newBurn = "0x0000000000000000000000000000000000000010";
    await templ.connect(member2).createProposalSetBurnAddress(newBurn, 7 * 24 * 60 * 60, "Set burn", "");
    let id3 = (await templ.proposalCount()) - 1n;
    const [, burnPayload] = await templ.getProposalActionData(id3);
    const decodedBurn = ethers.AbiCoder.defaultAbiCoder().decode(["address"], burnPayload)[0];
    expect(decodedBurn).to.equal(newBurn);
    await templ.connect(member1).vote(id3, true);
    await ethers.provider.send("evm_increaseTime", [8 * 24 * 60 * 60]);
    await ethers.provider.send("evm_mine");
    await templ.executeProposal(id3);
    expect(await templ.burnAddress()).to.equal(newBurn);
  });
});
