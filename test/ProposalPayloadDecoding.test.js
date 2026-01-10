const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTempl } = require("./utils/deploy");
const { mintToUsers, joinMembers } = require("./utils/mintAndPurchase");
const { expectProposalBasics, expectProposalExecuted } = require("./utils/assertions");

describe("Proposal payload decode coverage (getProposalActionData)", function () {
  const ENTRY_FEE = ethers.parseUnits("100", 18);
  const TOKEN_SUPPLY = ethers.parseUnits("10000", 18);
  const VOTING_PERIOD = 7 * 24 * 60 * 60;

  let templ, token, accounts;
  let owner, priest, m1, m2, m3;

  beforeEach(async function () {
    ({ templ, token, accounts } = await deployTempl({ entryFee: ENTRY_FEE }));
    [owner, priest, m1, m2, m3] = accounts;
    await mintToUsers(token, [m1, m2, m3], TOKEN_SUPPLY);
    await joinMembers(templ, token, [m1, m2, m3]);
  });

  it("decodes SetJoinPaused", async function () {
    await templ.connect(m1).createProposalSetJoinPaused(true, VOTING_PERIOD, "Pause", "");
    const id = (await templ.proposalCount()) - 1n;
    const proposal = await expectProposalBasics({
      templ,
      id,
      proposer: m1.address,
      title: "Pause",
      description: ""
    });
    expect(proposal.joinPaused).to.equal(true);
    const [action, payload] = await templ.getProposalActionData(id);
    // Action enum decodes to a BigInt (ethers v6), allow conversion
    expect(typeof action === "bigint" || typeof action === "number").to.equal(true);
    const [paused] = ethers.AbiCoder.defaultAbiCoder().decode(["bool"], payload);
    expect(paused).to.equal(true);
  });

  it("decodes UpdateConfig", async function () {
    const newEntryFee = ethers.parseUnits("200", 18);
    // update split to 4000/3000/2000 (protocol is 1000) => total 10_000
    const burnBps = 4000, treasuryBps = 3000, memberPoolBps = 2000;
    const updateSplit = true;
    await templ.connect(m1).createProposalUpdateConfig(
      newEntryFee,
      burnBps,
      treasuryBps,
      memberPoolBps,
      updateSplit,
      VOTING_PERIOD,
      "Cfg",
      ""
    );
    const id = (await templ.proposalCount()) - 1n;
    const proposal = await expectProposalBasics({
      templ,
      id,
      proposer: m1.address,
      title: "Cfg",
      description: ""
    });
    expect(proposal.newEntryFee).to.equal(newEntryFee);
    expect(proposal.newBurnBps).to.equal(burnBps);
    expect(proposal.newTreasuryBps).to.equal(treasuryBps);
    expect(proposal.newMemberPoolBps).to.equal(memberPoolBps);
    const [, payload] = await templ.getProposalActionData(id);
    const types = ["uint256","bool","uint256","uint256","uint256"];
    const [rFee, rUpdate, rBurn, rTreasury, rMember] = ethers.AbiCoder.defaultAbiCoder().decode(types, payload);
    expect(rFee).to.equal(newEntryFee);
    expect(rUpdate).to.equal(true);
    expect(rBurn).to.equal(burnBps);
    expect(rTreasury).to.equal(treasuryBps);
    expect(rMember).to.equal(memberPoolBps);
  });

  it("decodes SetMaxMembers", async function () {
    await templ.connect(m2).createProposalSetMaxMembers(100, VOTING_PERIOD, "Cap", "");
    const id = (await templ.proposalCount()) - 1n;
    const proposal = await expectProposalBasics({
      templ,
      id,
      proposer: m2.address,
      title: "Cap",
      description: ""
    });
    expect(proposal.newMaxMembers).to.equal(100n);
    const [, payload] = await templ.getProposalActionData(id);
    const [cap] = ethers.AbiCoder.defaultAbiCoder().decode(["uint256"], payload);
    expect(cap).to.equal(100n);
  });

  it("decodes SetMetadata", async function () {
    await templ.connect(m3).createProposalUpdateMetadata("Name", "Desc", "https://logo", VOTING_PERIOD, "Meta", "");
    const id = (await templ.proposalCount()) - 1n;
    const proposal = await expectProposalBasics({
      templ,
      id,
      proposer: m3.address,
      title: "Meta",
      description: ""
    });
    expect(proposal.newTemplName).to.equal("Name");
    expect(proposal.newTemplDescription).to.equal("Desc");
    expect(proposal.newLogoLink).to.equal("https://logo");
    const [, payload] = await templ.getProposalActionData(id);
    const [name, desc, logo] = ethers.AbiCoder.defaultAbiCoder().decode(["string","string","string"], payload);
    expect(name).to.equal("Name");
    expect(desc).to.equal("Desc");
    expect(logo).to.equal("https://logo");
  });

  it("decodes SetEntryFeeCurve", async function () {
    const curve = {
      primary: { style: 2, rateBps: 12000, length: 0 },
      additionalSegments: []
    };
    const baseFee = ethers.parseUnits("150", 18);
    await templ.connect(m1).createProposalSetEntryFeeCurve(curve, baseFee, VOTING_PERIOD, "Curve", "");
    const id = (await templ.proposalCount()) - 1n;
    const proposal = await expectProposalBasics({
      templ,
      id,
      proposer: m1.address,
      title: "Curve",
      description: ""
    });
    expect(proposal.curveBaseEntryFee).to.equal(baseFee);
    const [, payload] = await templ.getProposalActionData(id);
    const curveType = "tuple(tuple(uint8,uint32,uint32),tuple(uint8,uint32,uint32)[])";
    const [decodedCurve, decodedBase] = ethers.AbiCoder.defaultAbiCoder().decode([curveType, "uint256"], payload);
    // primary: [style, rateBps, length]
    expect(decodedCurve[0][0]).to.equal(2);
    expect(decodedCurve[0][1]).to.equal(12000);
    expect(decodedCurve[0][2]).to.equal(0);
    expect(decodedBase).to.equal(baseFee);
  });

  it("decodes CallExternal", async function () {
    const Target = await ethers.getContractFactory("contracts/mocks/ExternalCallTarget.sol:ExternalCallTarget");
    const target = await Target.deploy();
    await target.waitForDeployment();
    const sel = target.interface.getFunction("setNumber").selector;
    const params = ethers.AbiCoder.defaultAbiCoder().encode(["uint256"], [123n]);
    await templ.connect(m2).createProposalCallExternal(
      await target.getAddress(),
      0,
      sel,
      params,
      VOTING_PERIOD,
      "Call",
      ""
    );
    const id = (await templ.proposalCount()) - 1n;
    const proposal = await expectProposalBasics({
      templ,
      id,
      proposer: m2.address,
      title: "Call",
      description: ""
    });
    const expectedCallData = ethers.hexlify(ethers.concat([sel, params]));
    expect(proposal.externalCallTarget).to.equal(await target.getAddress());
    expect(proposal.externalCallValue).to.equal(0n);
    expect(proposal.externalCallData).to.equal(expectedCallData);
    const [, payload] = await templ.getProposalActionData(id);
    const [dst, value, data] = ethers.AbiCoder.defaultAbiCoder().decode(["address","uint256","bytes"], payload);
    expect(dst).to.equal(await target.getAddress());
    expect(value).to.equal(0n);
    expect(data.slice(0, 10)).to.equal(sel);
    const decodedParam = ethers.AbiCoder.defaultAbiCoder().decode(["uint256"], `0x${data.slice(10)}`)[0];
    expect(decodedParam).to.equal(123n);
  });

  

  it("decodes WithdrawTreasury", async function () {
    const tokenAddr = await token.getAddress();
    const recipient = m1.address;
    const amount = 1n;
    await templ.connect(m3).createProposalWithdrawTreasury(
      tokenAddr,
      recipient,
      amount,
      VOTING_PERIOD,
      "Withdraw",
      ""
    );
    const id = (await templ.proposalCount()) - 1n;
    const proposal = await expectProposalBasics({
      templ,
      id,
      proposer: m3.address,
      title: "Withdraw",
      description: ""
    });
    expect(proposal.token).to.equal(tokenAddr);
    expect(proposal.recipient).to.equal(recipient);
    expect(proposal.amount).to.equal(amount);
    const [, payload] = await templ.getProposalActionData(id);
    const [rToken, rRecip, rAmt] = ethers.AbiCoder.defaultAbiCoder().decode(
      ["address","address","uint256"],
      payload
    );
    expect(rToken).to.equal(tokenAddr);
    expect(rRecip).to.equal(recipient);
    expect(rAmt).to.equal(amount);
  });

  it("decodes SetProposalFee and SetReferralShare", async function () {
    // Set proposal fee
    await templ.connect(m1).createProposalSetProposalFeeBps(600, VOTING_PERIOD, "Fee", "");
    let id = (await templ.proposalCount()) - 1n;
    let proposal = await expectProposalBasics({
      templ,
      id,
      proposer: m1.address,
      title: "Fee",
      description: ""
    });
    expect(proposal.newProposalCreationFeeBps).to.equal(600n);
    let [, payload] = await templ.getProposalActionData(id);
    let [fee] = ethers.AbiCoder.defaultAbiCoder().decode(["uint256"], payload);
    expect(fee).to.equal(600n);

    // Set referral share
    await templ.connect(m2).createProposalSetReferralShareBps(1_250, VOTING_PERIOD, "Referral", "");
    id = (await templ.proposalCount()) - 1n;
    proposal = await expectProposalBasics({
      templ,
      id,
      proposer: m2.address,
      title: "Referral",
      description: ""
    });
    expect(proposal.newReferralShareBps).to.equal(1_250n);
    ;[, payload] = await templ.getProposalActionData(id);
    const [refBps] = ethers.AbiCoder.defaultAbiCoder().decode(["uint256"], payload);
    expect(refBps).to.equal(1250n);
  });

  it("decodes DisbandTreasury", async function () {
    const tokenAddr = await token.getAddress();

    // Disband treasury (token payload)
    await templ.connect(m1).createProposalDisbandTreasury(tokenAddr, VOTING_PERIOD, "Disband", "");
    let id = (await templ.proposalCount()) - 1n;
    let proposal = await expectProposalBasics({
      templ,
      id,
      proposer: m1.address,
      title: "Disband",
      description: ""
    });
    expect(proposal.token).to.equal(tokenAddr);
    let [, payload] = await templ.getProposalActionData(id);
    let [addr] = ethers.AbiCoder.defaultAbiCoder().decode(["address"], payload);
    expect(addr).to.equal(tokenAddr);
  });

  it("decodes SweepMemberPoolRemainder", async function () {
    await templ.connect(m2).createProposalSweepMemberPoolRemainder(m3.address, VOTING_PERIOD, "Sweep", "");
    const id = (await templ.proposalCount()) - 1n;
    const proposal = await expectProposalBasics({
      templ,
      id,
      proposer: m2.address,
      title: "Sweep",
      description: ""
    });
    expect(proposal.recipient).to.equal(m3.address);
    const [, payload] = await templ.getProposalActionData(id);
    const [recipient] = ethers.AbiCoder.defaultAbiCoder().decode(["address"], payload);
    expect(recipient).to.equal(m3.address);
  });

  it("decodes ChangePriest", async function () {
    await templ.connect(m1).createProposalChangePriest(m2.address, VOTING_PERIOD, "Priest", "");
    const id = (await templ.proposalCount()) - 1n;
    const proposal = await expectProposalBasics({
      templ,
      id,
      proposer: m1.address,
      title: "Priest",
      description: ""
    });
    expect(proposal.recipient).to.equal(m2.address);
    const [, payload] = await templ.getProposalActionData(id);
    const [addr] = ethers.AbiCoder.defaultAbiCoder().decode(["address"], payload);
    expect(addr).to.equal(m2.address);
  });

  it("decodes SetInstantQuorumBps", async function () {
    await templ.connect(m1).createProposalSetInstantQuorumBps(9_000, VOTING_PERIOD, "Instant", "");
    const id = (await templ.proposalCount()) - 1n;
    const proposal = await expectProposalBasics({
      templ,
      id,
      proposer: m1.address,
      title: "Instant",
      description: ""
    });
    expect(proposal.newInstantQuorumBps).to.equal(9_000n);
    const [, payload] = await templ.getProposalActionData(id);
    const [bps] = ethers.AbiCoder.defaultAbiCoder().decode(["uint256"], payload);
    expect(bps).to.equal(9_000n);
  });

  it("decodes SetCouncilMode", async function () {
    await templ.connect(m2).createProposalSetCouncilMode(true, VOTING_PERIOD, "Council", "");
    const id = (await templ.proposalCount()) - 1n;
    await expectProposalBasics({
      templ,
      id,
      proposer: m2.address,
      title: "Council",
      description: ""
    });
    const [, payload] = await templ.getProposalActionData(id);
    const [enabled] = ethers.AbiCoder.defaultAbiCoder().decode(["bool"], payload);
    expect(enabled).to.equal(true);
  });

  it("decodes SetYesVoteThreshold", async function () {
    await templ.connect(m2).createProposalSetYesVoteThreshold(6_000, VOTING_PERIOD, "Threshold", "");
    const id = (await templ.proposalCount()) - 1n;
    const proposal = await expectProposalBasics({
      templ,
      id,
      proposer: m2.address,
      title: "Threshold",
      description: ""
    });
    expect(proposal.newYesVoteThresholdBps).to.equal(6_000n);
    const [, payload] = await templ.getProposalActionData(id);
    const [bps] = ethers.AbiCoder.defaultAbiCoder().decode(["uint256"], payload);
    expect(bps).to.equal(6_000n);
  });

  it("decodes AddCouncilMember and RemoveCouncilMember", async function () {
    await templ.connect(m1).createProposalAddCouncilMember(m1.address, VOTING_PERIOD, "Add council", "");
    const addId = (await templ.proposalCount()) - 1n;
    await expectProposalBasics({
      templ,
      id: addId,
      proposer: m1.address,
      title: "Add council",
      description: ""
    });
    let [, payload] = await templ.getProposalActionData(addId);
    let [member] = ethers.AbiCoder.defaultAbiCoder().decode(["address"], payload);
    expect(member).to.equal(m1.address);

    await templ.connect(m2).vote(addId, true);
    const delay = Number(await templ.postQuorumVotingPeriod());
    await ethers.provider.send("evm_increaseTime", [delay + 1]);
    await ethers.provider.send("evm_mine", []);
    await templ.executeProposal(addId);
    await expectProposalExecuted({ templ, id: addId });
    expect(await templ.councilMemberCount()).to.equal(2n);

    await templ.connect(priest).createProposalRemoveCouncilMember(m1.address, VOTING_PERIOD, "Remove council", "");
    const removeId = (await templ.proposalCount()) - 1n;
    await expectProposalBasics({
      templ,
      id: removeId,
      proposer: priest.address,
      title: "Remove council",
      description: ""
    });
    [, payload] = await templ.getProposalActionData(removeId);
    [member] = ethers.AbiCoder.defaultAbiCoder().decode(["address"], payload);
    expect(member).to.equal(m1.address);
  });
});
