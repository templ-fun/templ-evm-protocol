const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deployTemplModules } = require("./utils/modules");
const { attachTemplInterface } = require("./utils/templ");
const { STATIC_CURVE } = require("./utils/deploy");

describe("Proposal creation fee reentrancy", function () {
  const ENTRY_FEE = ethers.parseUnits("100", 18);
  const BURN_BPS = 3000;
  const TREASURY_BPS = 3000;
  const MEMBER_BPS = 3000;
  const PROTOCOL_BPS = 1000;
  const QUORUM_BPS = 3300;
  const PROPOSAL_FEE_BPS = 500;
  const PROPOSAL_FEE = (ENTRY_FEE * BigInt(PROPOSAL_FEE_BPS)) / 10000n;

  let accounts;
  let priest;
  let attackerEOA;
  let templ;
  let token;
  let attackerContract;

  beforeEach(async function () {
    accounts = await ethers.getSigners();
    [, priest, attackerEOA] = accounts;

    const { membershipModule, treasuryModule, governanceModule } = await deployTemplModules();

    const Token = await ethers.getContractFactory(
      "contracts/mocks/ProposalFeeReentrantToken.sol:ProposalFeeReentrantToken"
    );
    token = await Token.deploy("Reentrant Access Token", "RAT");
    await token.waitForDeployment();

    const TemplFactory = await ethers.getContractFactory("TEMPL");
    templ = await TemplFactory.deploy(
      priest.address,
      priest.address,
      await token.getAddress(),
      ENTRY_FEE,
      BURN_BPS,
      TREASURY_BPS,
      MEMBER_BPS,
      PROTOCOL_BPS,
      QUORUM_BPS,
      7 * 24 * 60 * 60,
      "0x000000000000000000000000000000000000dEaD",
      false,
      0,
      "Reentrancy templ",
      "Testing proposal fee reentrancy",
      "https://templ.fun/reentrancy.png",
      PROPOSAL_FEE_BPS,
      0,
      membershipModule,
      treasuryModule,
      governanceModule,
      STATIC_CURVE
    );
    await templ.waitForDeployment();
    templ = await attachTemplInterface(templ);

    const Attacker = await ethers.getContractFactory(
      "contracts/mocks/ProposalFeeReentrancyAttacker.sol:ProposalFeeReentrancyAttacker"
    );
    attackerContract = await Attacker.deploy(await templ.getAddress(), await token.getAddress());
    await attackerContract.waitForDeployment();

    await token.setTempl(await templ.getAddress());
    await token.setHookTarget(await attackerContract.getAddress());
    await token.setHookEnabled(false);

    const initialBalance = ENTRY_FEE * 3n;
    await token.mint(await attackerContract.getAddress(), initialBalance);
    await attackerContract.connect(attackerEOA).joinTempl(ENTRY_FEE);
    await attackerContract.connect(attackerEOA).approveFee(PROPOSAL_FEE);

    await token.setHookEnabled(true);
  });

  it("blocks reentrant proposal creation during fee collection", async function () {
    expect(await templ.isMember(await attackerContract.getAddress())).to.equal(true);
    expect(await templ.proposalCount()).to.equal(0n);

    await attackerContract.connect(attackerEOA).attackCreateProposal();

    expect(await templ.proposalCount()).to.equal(1n);
    const proposal = await templ.getProposal(0);
    expect(proposal.proposer).to.equal(await attackerContract.getAddress());
    expect(await attackerContract.reentered()).to.equal(false);
    expect(await templ.hasActiveProposal(await attackerContract.getAddress())).to.equal(true);
    expect(await templ.activeProposalId(await attackerContract.getAddress())).to.equal(0n);
  });
});
