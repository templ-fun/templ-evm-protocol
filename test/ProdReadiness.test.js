const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("Prod Readiness", function () {
  const ENTRY_FEE = ethers.parseUnits("100", 18); // 100 tokens
  const PROTOCOL_BPS = 1000; // 10%

  let deployer, protocol, priest, alice, bob, carol, dave, eve;
  let membershipModule, treasuryModule, governanceModule;
  let factory;
  let token; // access token
  let extraToken; // external reward ERC20
  let templ; // TEMPL router (ABI of TEMPL)
  let membership; // membership interface bound to templ address
  let treasury; // treasury interface bound to templ address
  let governance; // governance interface bound to templ address

  async function deployCore() {
    [deployer, protocol, priest, alice, bob, carol, dave, eve] = await ethers.getSigners();

    // Deploy modules
    const Membership = await ethers.getContractFactory("TemplMembershipModule");
    membershipModule = await Membership.deploy();
    await membershipModule.waitForDeployment();

    const Treasury = await ethers.getContractFactory("TemplTreasuryModule");
    treasuryModule = await Treasury.deploy();
    await treasuryModule.waitForDeployment();

    const Governance = await ethers.getContractFactory("TemplGovernanceModule");
    governanceModule = await Governance.deploy();
    await governanceModule.waitForDeployment();

    // Deploy factory
    const Factory = await ethers.getContractFactory("TemplFactory");
    factory = await Factory.deploy(
      await deployer.getAddress(),
      await protocol.getAddress(),
      PROTOCOL_BPS,
      await membershipModule.getAddress(),
      await treasuryModule.getAddress(),
      await governanceModule.getAddress()
    );
    await factory.waitForDeployment();

    // Deploy tokens
    const TestToken = await ethers.getContractFactory("TestToken");
    token = await TestToken.deploy("Access", "ACC", 18);
    await token.waitForDeployment();
    extraToken = await TestToken.deploy("External", "EXT", 18);
    await extraToken.waitForDeployment();

    // Mint balances for joiners and proposers
    const supply = ethers.parseUnits("10000000", 18);
    for (const s of [deployer, priest, alice, bob, carol, dave, eve, protocol]) {
      await (await token.mint(await s.getAddress(), supply)).wait();
      await (await extraToken.mint(await s.getAddress(), supply)).wait();
    }

    // Allow anyone to create templs for this test
    await (await factory.connect(deployer).setPermissionless(true)).wait();

    // Create templ via factory with explicit priest
    const tx = await factory
      .connect(deployer)
      .createTemplFor(
        await priest.getAddress(),
        await token.getAddress(),
        ENTRY_FEE,
        "templ.fun E2E",
        "End-to-end prod readiness",
        "https://example.com/logo.png",
        2500, // proposal fee bps
        2500 // referral share bps (of member-pool slice)
      );
    const receipt = await tx.wait();
    const templAddress = receipt.logs
      .map((l) => {
        try {
          return factory.interface.parseLog(l);
        } catch (e) {
          return null;
        }
      })
      .filter(Boolean)
      .find((ev) => ev.name === "TemplCreated").args.templ;

    templ = await ethers.getContractAt("TEMPL", templAddress);
    membership = await ethers.getContractAt("TemplMembershipModule", templAddress);
    treasury = await ethers.getContractAt("TemplTreasuryModule", templAddress);
    governance = await ethers.getContractAt("TemplGovernanceModule", templAddress);

    // Sanity: registered selectors are complete and route to expected modules
    const [mSels, tSels, gSels] = await templ.getRegisteredSelectors();
    expect(mSels.length).to.equal(18);
    expect(tSels.length).to.equal(17);
    expect(gSels.length).to.equal(25);

    for (const sel of mSels) {
      expect(await templ.getModuleForSelector(sel)).to.equal(await membershipModule.getAddress());
    }
    for (const sel of tSels) {
      expect(await templ.getModuleForSelector(sel)).to.equal(await treasuryModule.getAddress());
    }
    for (const sel of gSels) {
      expect(await templ.getModuleForSelector(sel)).to.equal(await governanceModule.getAddress());
    }

    // Direct calls to modules revert (delegatecall guard)
    await expect(membershipModule.join()).to.be.revertedWithCustomError(
      membershipModule,
      "DelegatecallOnly"
    );
    await expect(treasuryModule.setJoinPausedDAO(true)).to.be.revertedWithCustomError(
      treasuryModule,
      "NotDAO"
    );
    await expect(
      governanceModule.createProposalSetJoinPaused(true, 36 * 60 * 60, "t", "d")
    ).to.be.revertedWithCustomError(governanceModule, "DelegatecallOnly");
  }

  async function fullyApproveAllForTempl() {
    const max = ethers.MaxUint256;
    for (const s of [priest, alice, bob, carol, dave, eve]) {
      await (await token.connect(s).approve(templ.target, max)).wait();
      await (await extraToken.connect(s).approve(templ.target, max)).wait();
    }
  }

  async function openVoteExecute(proposerSigner, createTxPromiseFactory) {
    // proposer must be a member
    const before = await templ.proposalCount();
    const createTx = await createTxPromiseFactory(proposerSigner);
    await createTx.wait();
    const id = before;

    // Another member (not the proposer) votes YES
    const proposerAddr = await proposerSigner.getAddress();
    const candidates = [priest, alice, bob, carol, dave];
    let voter = null;
    let voter2 = null;
    for (const s of candidates) {
      const addr = await s.getAddress();
      if (addr !== proposerAddr) {
        if (!voter) {
          voter = s;
        } else if (!voter2) {
          voter2 = s;
          break;
        }
      }
    }
    await (await governance.connect(voter).vote(id, true)).wait();
    if (voter2) {
      await (await governance.connect(voter2).vote(id, true)).wait();
    }

    const p = await templ.postQuorumVotingPeriod();
    await time.increase(Number(p) + 1);
    await (await governance.connect(priest).executeProposal(id)).wait();
    return id;
  }

  it("runs the full end-to-end protocol flow across all core APIs", async function () {
    await deployCore();
    await fullyApproveAllForTempl();

    // Initial config checks
    const cfg0 = await membership.getConfig();
    expect(cfg0.token).to.equal(await token.getAddress());
    expect(cfg0.fee).to.equal(ENTRY_FEE);
    expect(await membership.getMemberCount()).to.equal(1n); // priest auto-enrolled
    expect(await membership.totalJoins()).to.equal(0n);
    expect(await membership.getVoteWeight(await priest.getAddress())).to.equal(1n);
    expect(await membership.getVoteWeight(await alice.getAddress())).to.equal(0n);

    // Approvals for joins and proposals
    const joiners = [alice, bob, carol, dave];
    for (const s of joiners) {
      await (await token.connect(s).approve(templ.target, ethers.MaxUint256)).wait();
    }

    // Join: alice self-joins
    await (await membership.connect(alice).join()).wait();
    expect(await membership.isMember(await alice.getAddress())).to.equal(true);

    // Join: bob with referral to alice
    await (await membership.connect(bob).joinWithReferral(await alice.getAddress())).wait();
    expect(await membership.isMember(await bob.getAddress())).to.equal(true);

    // Join: carol sponsored by dave
    await (await membership.connect(dave).joinFor(await carol.getAddress())).wait();
    expect(await membership.isMember(await carol.getAddress())).to.equal(true);

    // Join: dave sponsored by carol with referral to alice
    await (
      await membership.connect(carol).joinForWithReferral(await dave.getAddress(), await alice.getAddress())
    ).wait();
    expect(await membership.isMember(await dave.getAddress())).to.equal(true);

    // Basic views
    expect(await membership.getMemberCount()).to.equal(5n); // priest + 4
    expect(await membership.totalJoins()).to.equal(4n);
    const jd = await membership.getJoinDetails(await alice.getAddress());
    expect(jd.joined).to.equal(true);

    const trInfo = await membership.getTreasuryInfo();
    expect(trInfo.protocolAddress).to.equal(await factory.PROTOCOL_FEE_RECIPIENT());

    // Member pool is non-zero and claim works
    const claimableAliceBefore = await membership.getClaimableMemberRewards(await alice.getAddress());
    expect(claimableAliceBefore).to.be.gt(0n);
    const aliceBalBefore = await token.balanceOf(await alice.getAddress());
    await (await membership.connect(alice).claimMemberRewards()).wait();
    const aliceBalAfter = await token.balanceOf(await alice.getAddress());
    expect(aliceBalAfter - aliceBalBefore).to.equal(claimableAliceBefore);

    // Proposals: create a battery across all actions (rotate proposers due to single-active-per-proposer rule)
    // 1) Pause joins
    await openVoteExecute(alice, async (s) =>
      governance.connect(s).createProposalSetJoinPaused(true, 0, "Pause joins", "Pause intake")
    );
    // Proceed: later we will explicitly unpause via onlyDAO under dictatorship

    // 2) Update config: update fee splits (no fee change)
    await openVoteExecute(bob, async (s) =>
      governance
        .connect(s)
        .createProposalUpdateConfig(0, 2000, 5000, 2000, true, 0, "Update config", "Splits only")
    );
    const cfg1 = await membership.getConfig();
    expect(cfg1.burnBpsOut).to.equal(2000n);
    expect(cfg1.treasuryBpsOut).to.equal(5000n);
    expect(cfg1.memberPoolBpsOut).to.equal(2000n);

    // 3) Set max members
    await openVoteExecute(carol, async (s) =>
      governance.connect(s).createProposalSetMaxMembers(10, 0, "Cap 10", "Limit members")
    );
    expect(await membership.getMemberCount()).to.equal(5n);

    // 4) Update metadata
    await openVoteExecute(dave, async (s) =>
      governance
        .connect(s)
        .createProposalUpdateMetadata("New Name", "New Desc", "https://new.logo", 0, "Meta", "update")
    );

    // 5) Update proposal fee bps
    await openVoteExecute(alice, async (s) =>
      governance.connect(s).createProposalSetProposalFeeBps(100, 0, "Fee", "Set proposal fee")
    );
    // 6) Update referral share bps
    await openVoteExecute(bob, async (s) =>
      governance.connect(s).createProposalSetReferralShareBps(100, 0, "Referral", "Set referral share")
    );

    // 7) Set entry fee curve (simple static tail only)
    const curve = {
      primary: { style: 0, rateBps: 0, length: 0 },
      additionalSegments: []
    };
    await openVoteExecute(carol, async (s) =>
      governance.connect(s).createProposalSetEntryFeeCurve(curve, 0, 0, "Curve", "Set static curve")
    );

    // 8) External call proposal: templ -> batchDAO(approve, stake)
    const Staking = await ethers.getContractFactory("MockStaking");
    const staking = await Staking.deploy();
    await staking.waitForDeployment();

    // Ensure templ has treasury tokens to stake: disband access token treasury adds to member pool,
    // but we want tokens in the templ treasury; so first transfer extra tokens to templ directly
    await (await token.connect(deployer).transfer(templ.target, ethers.parseUnits("1000", 18))).wait();

    const TreasuryIface = treasury.interface;
    const TokenIface = token.interface;
    const StakeIface = staking.interface;

    const approveCalldata = TokenIface.encodeFunctionData("approve", [await staking.getAddress(), ethers.parseUnits("500", 18)]);
    const stakeCalldata = StakeIface.encodeFunctionData("stake", [await token.getAddress(), ethers.parseUnits("500", 18)]);

    const targets = [await token.getAddress(), await staking.getAddress()];
    const values = [0, 0];
    const calldatas = [approveCalldata, stakeCalldata];

    const batchSelector = TreasuryIface.getFunction("batchDAO").selector; // call TEMPL.batchDAO via CallExternal
    const params = ethers.AbiCoder.defaultAbiCoder().encode(
      ["address[]", "uint256[]", "bytes[]"],
      [targets, values, calldatas]
    );

    await openVoteExecute(dave, async (s) =>
      governance
        .connect(s)
        .createProposalCallExternal(templ.target, 0, batchSelector, params, 0, "Batch approve+stake", "atomic")
    );

    // Staked balance moved from templ -> staking
    expect(await staking.staked(templ.target)).to.equal(ethers.parseUnits("500", 18));

    // 9) Withdraw treasury to recipient
    await openVoteExecute(alice, async (s) =>
      governance
        .connect(s)
        .createProposalWithdrawTreasury(
          await token.getAddress(),
          await eve.getAddress(),
          ethers.parseUnits("100", 18),
          0,
          "Withdraw",
          "Pay ops"
        )
    );

    // 10) Disband external rewards: ETH and external ERC20
    // Fund templ with ETH and EXT token
    await (await deployer.sendTransaction({ to: templ.target, value: ethers.parseEther("5") })).wait();
    await (await extraToken.connect(deployer).transfer(templ.target, ethers.parseUnits("1000", 18))).wait();

    await openVoteExecute(bob, async (s) =>
      governance.connect(s).createProposalDisbandTreasury(ethers.ZeroAddress, 0, "Disband ETH", "split ETH")
    );
    await openVoteExecute(carol, async (s) =>
      governance.connect(s).createProposalDisbandTreasury(await extraToken.getAddress(), 0, "Disband EXT", "split EXT")
    );

    // External rewards present and claimable
    const tokensList = await membership.getExternalRewardTokens();
    expect(tokensList).to.include.members([ethers.ZeroAddress, await extraToken.getAddress()]);
    const [slice, hasMore] = await membership.getExternalRewardTokensPaginated(0, 1);
    expect(slice.length).to.equal(1);
    expect(hasMore).to.equal(true);

    const claimableExtAlice = await membership.getClaimableExternalReward(
      await alice.getAddress(),
      await extraToken.getAddress()
    );
    expect(claimableExtAlice).to.be.gt(0n);
    const extBalBefore = await extraToken.balanceOf(await alice.getAddress());
    await (await membership.connect(alice).claimExternalReward(await extraToken.getAddress())).wait();
    const extBalAfter = await extraToken.balanceOf(await alice.getAddress());
    expect(extBalAfter - extBalBefore).to.equal(claimableExtAlice);

    // 11) Change priest via governance
    await openVoteExecute(dave, async (s) =>
      governance.connect(s).createProposalChangePriest(await alice.getAddress(), 0, "New priest", "rotate")
    );
    expect(await templ.priest()).to.equal(await alice.getAddress());

    // 12) Enable dictatorship via governance, then exercise all DAO setters directly as priest
    await openVoteExecute(alice, async (s) =>
      governance.connect(s).createProposalSetDictatorship(true, 0, "Dictatorship on", "enable")
    );
    expect(await templ.priestIsDictator()).to.equal(true);

    // Now direct-onlyDAO calls by priest should work
    // a) Unpause joins
    await (await treasury.connect(alice).setJoinPausedDAO(false)).wait();
    expect((await membership.getConfig()).joinPaused).to.equal(false);
    // b) Set quorum bps
    await (await treasury.connect(alice).setQuorumBpsDAO(5000)).wait();
    expect(await templ.quorumBps()).to.equal(5000n);
    // c) Set post-quorum voting period
    await (await treasury.connect(alice).setPostQuorumVotingPeriodDAO(12 * 60 * 60)).wait();
    expect(await templ.postQuorumVotingPeriod()).to.equal(12n * 60n * 60n);
    // d) Set burn address
    await (await treasury.connect(alice).setBurnAddressDAO(await eve.getAddress())).wait();
    expect(await templ.burnAddress()).to.equal(await eve.getAddress());
    // e) Set pre-quorum voting period (via DAO setter)
    await (await treasury.connect(alice).setPreQuorumVotingPeriodDAO(36 * 60 * 60)).wait();
    expect(await templ.preQuorumVotingPeriod()).to.equal(36n * 60n * 60n);
    // f) Update proposal fee
    await (await treasury.connect(alice).setProposalCreationFeeBpsDAO(0)).wait();
    expect(await templ.proposalCreationFeeBps()).to.equal(0n);
    // g) Update referral share
    await (await treasury.connect(alice).setReferralShareBpsDAO(0)).wait();
    expect(await templ.referralShareBps()).to.equal(0n);
    // h) Update curve (keep static)
    await (await treasury.connect(alice).setEntryFeeCurveDAO(curve, 0)).wait();
    // i) Update config (entry fee only)
    await (await treasury.connect(alice).updateConfigDAO(ethers.parseUnits("90", 18), false, 0, 0, 0)).wait();
    expect((await membership.getConfig()).fee).to.equal(ethers.parseUnits("90", 18));
    // j) Set max members directly
    await (await treasury.connect(alice).setMaxMembersDAO(100)).wait();
    expect(await templ.maxMembers()).to.equal(100n);

    // k) BatchDAO direct: approve EXT -> transferFrom by external caller
    const ExternalTarget = await ethers.getContractFactory("ExternalCallTarget");
    const ext = await ExternalTarget.deploy();
    await ext.waitForDeployment();
    // Use batchDAO to setNumber and setNumberPayable with ETH
    const setNum = ext.interface.encodeFunctionData("setNumber", [123]);
    const setNumPayable = ext.interface.encodeFunctionData("setNumberPayable", [456]);
    await (await treasury.connect(alice).batchDAO([ext.target, ext.target], [0, ethers.parseEther("1")], [setNum, setNumPayable])).wait();
    expect(await ext.storedValue()).to.equal(456n);

    // l) Cleanup enumeration once external rewards are fully settled
    // Ensure there is no remaining external reward for EXT by letting all members claim
    // Claim EXT for a couple of members to drain pool
    const tokens = await membership.getExternalRewardTokens();
    expect(tokens).to.include(await extraToken.getAddress());
    // Let all members attempt claims to settle pool
    for (const who of [priest, alice, bob, carol, dave]) {
      const claimable = await membership.getClaimableExternalReward(
        await who.getAddress(),
        await extraToken.getAddress()
      );
      if (claimable > 0n) {
        await (await membership.connect(who).claimExternalReward(await extraToken.getAddress())).wait();
      }
    }
    // Pool may still have tiny remainder; flush by disbanding zero-amount path is not possible; instead force remainder to 0 by updating membership count bias: add a new joiner (eve)
    await (await token.connect(eve).approve(templ.target, ethers.MaxUint256)).wait();
    await (await membership.connect(eve).join()).wait();
    // After a join, remainder distribution gets flushed; attempt claims again
    for (const who of [priest, alice, bob, carol, dave, eve]) {
      const claimable = await membership.getClaimableExternalReward(
        await who.getAddress(),
        await extraToken.getAddress()
      );
      if (claimable > 0n) {
        await (await membership.connect(who).claimExternalReward(await extraToken.getAddress())).wait();
      }
    }
    const stateEXT = await membership.getExternalRewardState(await extraToken.getAddress());
    expect(stateEXT.poolBalance).to.equal(0n);
    expect(stateEXT.remainder).to.equal(0n);
    // Cleanup directly under dictatorship via onlyDAO
    await (await treasury.connect(alice).cleanupExternalRewardToken(await extraToken.getAddress())).wait();

    // m) Withdraw ETH via DAO (top-up ETH after previous disbands/claims)
    await (await deployer.sendTransaction({ to: templ.target, value: ethers.parseEther("5") })).wait();
    await (await treasury.connect(alice).withdrawTreasuryDAO(ethers.ZeroAddress, await dave.getAddress(), ethers.parseEther("0.25")))
      .wait();

    // n) Turn dictatorship off via DAO call
    // Change priest directly under dictatorship, then disable dictatorship as new priest
    await (await treasury.connect(alice).changePriestDAO(await dave.getAddress())).wait();
    expect(await templ.priest()).to.equal(await dave.getAddress());
    await (await treasury.connect(dave).setDictatorshipDAO(false)).wait();
    expect(await templ.priestIsDictator()).to.equal(false);

    // Governance views sanity
    // New proposal to test proposal views and pagination
    const lastId = await openVoteExecute(bob, async (s) =>
      governance.connect(s).createProposalSetBurnAddress(await protocol.getAddress(), 0, "Burn sink", "rotate")
    );
    const [preJS, quorumJS] = await governance.getProposalJoinSequences(lastId);
    const [eligiblePre, eligiblePost] = (await governance.getProposalSnapshots(lastId));
    const hasVoted = await governance.hasVoted(lastId, await alice.getAddress());
    expect(preJS).to.be.greaterThan(0n);
    expect(eligiblePre).to.be.greaterThan(0n);
    expect(hasVoted.voted).to.equal(true);
    expect(hasVoted.support).to.equal(true);

    const active = await governance.getActiveProposals();
    if (active.length > 0) {
      const [page, more] = await governance.getActiveProposalsPaginated(0, Math.min(2, active.length));
      expect(page.length).to.be.gt(0);
      expect(typeof more).to.equal("boolean");
      // Prune at most 5 entries
      await governance.connect(alice).pruneInactiveProposals(5);
    }
  });
});
