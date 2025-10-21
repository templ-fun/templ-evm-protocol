# templ.fun Protocol Overview

## What It Does
- templ.fun lets communities spin up private “templ” groups that collect an access-token treasury, stream rewards to existing members, and govern configuration or payouts on-chain.
- Each templ is composed from three delegatecall modules – membership, treasury, and governance – orchestrated by the root `TEMPL` contract. All persistent state lives in `TemplBase`, so modules share storage and act like facets of a single contract.
- Deployers can apply join-fee curves, referral rewards, proposal fees, and dictatorship (priest) overrides. Governance maintains control after launch by voting on configuration changes or treasury actions.

## Protocol At A Glance
- Roles
  - Priest: auto‑enrolled first member; can enable/disable dictatorship and propose like any member.
  - Members: one‑address‑one‑vote; earn member‑pool rewards from subsequent joins.
  - DAO: the `TEMPL` contract executing governance decisions via delegatecalls back into itself.
- Tokens
  - Access token (ERC‑20): paid to join; used for member rewards, treasury accounting, and proposal fees.
  - External rewards: donated ETH/ERC‑20 that can be distributed evenly to members via a “disband” action.
- Modules
  - `TemplMembershipModule`: joins, claims, member views.
  - `TemplTreasuryModule`: DAO actions for treasury/config/metadata/curves and cleanup.
  - `TemplGovernanceModule`: proposals, voting, snapshots, execution (including external calls).

## Join Flow & Fee Split
Given `price = entryFee` and `BPS_DENOMINATOR = 10_000`:
- Burn: `burnAmount = price * burnBps / 10_000` → payer → `burnAddress`.
- Protocol: `protocolAmount = price * protocolBps / 10_000` → payer → `protocolFeeRecipient`.
- Member pool: `memberPoolAmount = price * memberPoolBps / 10_000`.
- Treasury: `treasuryAmount = price - burnAmount - memberPoolAmount - protocolAmount`.

Transfers during join:
- Payer → `burnAddress`: burnAmount
- Payer → `protocolFeeRecipient`: protocolAmount
- Payer → TEMPL: treasuryAmount + memberPoolAmount
- Optional referral: if `referralShareBps > 0` and `referral` is an existing member ≠ recipient:
  - `referralAmount = memberPoolAmount * referralShareBps / 10_000`, TEMPL → referral

Distribution and accounting:
- `distributablePool = memberPoolAmount - referralAmount`
- If members exist: `totalRewards = distributablePool + memberRewardRemainder`
  - `rewardPerMember = floor(totalRewards / memberCount)`, `memberRewardRemainder = totalRewards % memberCount`
  - `cumulativeMemberRewards += rewardPerMember`
- New member snapshot: `rewardSnapshot = cumulativeMemberRewards` (no reward from their own join)
- Balances:
  - `treasuryBalance += treasuryAmount` (access token only)
  - `memberPoolBalance += distributablePool` (reserved for claims)
- Unsupported tokens: fee‑on‑transfer or rebasing access tokens are not supported.

## Proposal Creation Fee
- `proposalCreationFeeBps` charges proposers a fee in the access token:
  - `proposalFee = entryFee * proposalCreationFeeBps / 10_000`.
  - Collected via `safeTransferFrom(proposer → TEMPL)` and added to `treasuryBalance`.
  - Creation path is `nonReentrant` and tested against hook/reentrancy behaviors.

## Treasury & External Rewards
- Access token treasury
  - `treasuryBalance` tracks the access‑token portion routed to treasury via joins and proposal fees.
  - DAO withdrawals of the access token are limited by contract balance minus `memberPoolBalance` (reserved for member claims).
- External tokens & ETH
  - Anyone can send ETH/ERC‑20 to the templ address. These do not affect `treasuryBalance` until disbursed.
  - DAO can “disband” a token:
    - Access token → moves into `memberPoolBalance` and updates the main member accumulator.
    - Other ERC‑20/ETH → credited into a per‑token external reward pool with its own accumulator + checkpoints.
  - Members claim via `claimExternalReward(tokenOrZero)`; snapshots ensure new members don’t claim past distributions.
  - External reward enumeration is capped at 256 tokens; DAO can remove a fully settled token via `cleanupExternalRewardToken(address)`.

## Deployment Flow & Public Interfaces
The canonical workflow deploys shared modules once, followed by a factory and any number of templ instances. The snippets below assume a Hardhat project (`npx hardhat console` or scripts that import `hardhat`) using ethers v6.

1. **Deploy the shared modules**
   ```js
   const Membership = await ethers.getContractFactory("TemplMembershipModule");
   const membershipModule = await Membership.deploy();
   await membershipModule.waitForDeployment();

   const Treasury = await ethers.getContractFactory("TemplTreasuryModule");
   const treasuryModule = await Treasury.deploy();
   await treasuryModule.waitForDeployment();

   const Governance = await ethers.getContractFactory("TemplGovernanceModule");
   const governanceModule = await Governance.deploy();
   await governanceModule.waitForDeployment();
   ```
   These modules map directly to [`contracts/TemplMembership.sol`](contracts/TemplMembership.sol), [`contracts/TemplTreasury.sol`](contracts/TemplTreasury.sol), and [`contracts/TemplGovernance.sol`](contracts/TemplGovernance.sol). They are pure logic contracts; all storage lives in `TemplBase`.

2. **Deploy the factory**
   ```js
   const protocolFeeRecipient = "0x..."; // collects protocol share of each join
   const protocolBps = 1_000;            // 10% (expressed in basis points)

   const Factory = await ethers.getContractFactory("TemplFactory");
   const factory = await Factory.deploy(
     protocolFeeRecipient,
     protocolBps,
     await membershipModule.getAddress(),
     await treasuryModule.getAddress(),
     await governanceModule.getAddress()
   );
   await factory.waitForDeployment();
   ```
   Constructor parameters (see [`contracts/TemplFactory.sol`](contracts/TemplFactory.sol)):
   - `protocolFeeRecipient`: receives the protocol’s share of every join.
   - `protocolBps`: splitter share (basis points) kept by the protocol. All templ splits must sum to 10_000, so templ-level burn/treasury/member shares must account for this.
   - Module addresses: delegatecall targets for every templ the factory deploys.

3. **Create a templ instance**
   ```js
   const templTx = await factory.createTemplWithConfig({
     priest: "0xPriest...",                 // auto-enrolled administrator (priest)
     token: "0xAccessToken...",             // ERC-20 used for joins / treasury accounting
     entryFee: ethers.parseUnits("100", 18),// base entry fee (must be ≥10 and divisible by 10)
     burnBps: -1,                           // burn share (bps), -1 keeps factory default
     treasuryBps: -1,                       // treasury share (bps), -1 keeps factory default
     memberPoolBps: -1,                     // member pool share (bps), -1 keeps factory default
     quorumBps: 3_300,                      // YES votes required for quorum (basis points)
     executionDelaySeconds: 7 * 24 * 60 * 60,// execution delay after quorum (seconds)
     burnAddress: ethers.ZeroAddress,       // burn destination (defaults to 0x...dEaD)
     priestIsDictator: false,               // true lets the priest bypass governance
     maxMembers: 250,                       // optional membership cap (0 = uncapped)
     curveProvided: true,                   // provide custom curve instead of factory default
     curve: {
       primary: { style: 2, rateBps: 11_000, length: 0 }, // exponential tail (infinite length)
       additionalSegments: []              // optional extra segments (empty keeps single segment)
     },
     name: "MOG MOGGERS",                   // templ metadata surfaced to UIs
     description: "mog or get mogged",      // metadata short description (can be empty)
     logoLink: "https://example.com/logo.png",// metadata image (can be empty)
     proposalFeeBps: 500,                   // 5% of the current entry fee charged per proposal
     referralShareBps: 500                  // 5% of the member-pool allocation paid to referrals
   });
   const receipt = await templTx.wait();
   const templAddress = receipt.logs.find(log => log.eventName === "TemplCreated").args.templ;
   ```

   Key configuration knobs (resolved inside `TemplFactory._deploy` and `TEMPL`):
   - `priest`: auto-enrolled member with the ability to toggle dictatorship or act before governance is active.
   - `token`: ERC-20 used for joins, rewards, and treasury balances.
   - `entryFee`: initial fee (must be ≥10 and divisible by 10). The pricing curve adjusts the next `entryFee` after each successful join.
   - `burnBps/treasuryBps/memberPoolBps`: fee split (basis points) between burn address, templ treasury, and member rewards pool. Must sum with `protocolBps` to 10_000.
   - `quorumBps`: minimum YES threshold (basis points) to satisfy quorum.
   - `executionDelaySeconds`: waiting period after quorum before execution can occur.
   - `burnAddress`: recipient of the burned allocation (default: `0x...dEaD`).
   - `priestIsDictator`: if true, governance functions are priest-only until the dictator disables it.
   - `maxMembers`: optional membership cap that auto-pauses joins when reached.
   - `curveProvided`: set to `true` when supplying a custom `CurveConfig`; otherwise the factory default is applied.
   - `curve`: `CurveConfig` describing how the entry fee evolves. The factory ships an exponential default; additional segments can model piecewise-linear or static phases. See `contracts/TemplCurve.sol` for enum definitions.
   - `proposalFeeBps`: optional fee (basis points) deducted from the proposer’s wallet and credited to the templ treasury when a proposal is created.
   - `referralShareBps`: portion of the member pool allocation paid to a referrer on each join.

Once the templ is live, all user interactions flow through the deployed `TEMPL` address (`contracts/TEMPL.sol`), which delegates to the module responsible for the invoked selector. The `TemplFactory` can be toggled to permissionless mode (see `setPermissionless`) to allow anyone to deploy new templs.

### Hardhat Deployment Scripts
The repository ships end-to-end scripts at the repository root that mirror the sequence above:

- [`scripts/deploy-factory.cjs`](scripts/deploy-factory.cjs) – Deploys the shared modules (if addresses aren’t supplied via env vars) and produces a wired `TemplFactory`.
- [`scripts/deploy-templ.cjs`](scripts/deploy-templ.cjs) – Uses an existing factory (or deploys one with modules) to instantiate a templ and dumps a deployment artifact under `deployments/`.
- [`scripts/verify-templ.cjs`](scripts/verify-templ.cjs) – Utility for reconstructing constructor arguments and verifying a templ instance on chain.

Example commands (environment variables follow the same names used inside each script):

```bash
# Deploy shared modules + factory (examples use Base mainnet; adjust --network as needed)
PROTOCOL_FEE_RECIPIENT=0xYourRecipient \
PROTOCOL_BP=1000 \
npx hardhat run --network base scripts/deploy-factory.cjs

# Deploy a templ via factory (token, priest, fee splits, etc. come from env)
FACTORY_ADDRESS=0xFactoryFromPreviousStep \
TOKEN_ADDRESS=0xAccessToken \
ENTRY_FEE=100000000000000000000 \
TEMPL_NAME="templ.fun OG" \
TEMPL_DESCRIPTION="Genesis collective" \
npx hardhat run --network base scripts/deploy-templ.cjs

# Verify the factory (on Basescan for chain 8453)
npx hardhat verify --network base 0xFactoryFromPreviousStep 0xYourRecipient 1000 0xMembershipModule 0xTreasuryModule 0xGovernanceModule

# Verify a templ (script auto-reconstructs constructor args)
npx hardhat run --network base scripts/verify-templ.cjs --templ 0xYourTempl --factory 0xFactoryFromPreviousStep
```

Refer to the inline env-variable docs in `scripts/deploy-factory.cjs` and `scripts/deploy-templ.cjs` for the latest configuration options and verification helpers.

## Module Responsibilities
- **TemplMembershipModule**
  - Handles joins (with optional referrals), distributes entry-fee splits, accrues member rewards, and exposes read APIs for membership state and treasury summaries.
  - Maintains join sequencing to enforce governance eligibility snapshots and reports cumulative burns (`getTreasuryInfo` → `burned`).

- **TemplTreasuryModule**
  - Provides governance-controlled treasury actions: withdrawals, disbands to member/external pools, priest changes, metadata updates, referral/proposal-fee adjustments, and entry-fee curve updates.
  - Surfaces helper actions such as cleaning empty external reward tokens.

- **TemplGovernanceModule**
  - Manages proposal lifecycle (creation, voting, execution), quorum/eligibility tracking, dictatorship toggles, and external call execution with optional ETH value.
  - Exposes proposal metadata, snapshot data, join sequence snapshots, voter state, and active proposal pagination.

- **TemplFactory**
  - Normalizes deployment config, validates split sums (bps), enforces permissionless toggles, and emits creation metadata (including curve details).
  - Stores `TEMPL` init code across chunks to avoid large constructor bytecode.

These components share `TemplBase`, which contains storage, shared helpers (entry-fee curves, reward accounting, SafeERC20 transfers), and cross-module events.

### Quick Reference
- **Testing:** `npx hardhat test` (default), `npx hardhat coverage` for coverage, `npm run slither` for static analysis.
- **Treasury Insights:** `getTreasuryInfo()` returns `(treasuryAvailable, memberPool, protocolFeeRecipient, totalBurned)`.
- **Entry Fee Curves:** configure piecewise segments (`CurveConfig`) to unlock linear or exponential pricing after a given number of joins.
- **Proposal Fees:** governance updates them via `setProposalCreationFeeBpsDAO`; the templ contract auto-collects the fee (in the access token) before recording a proposal.

### Core Interfaces (selected)
- Membership (from `TemplMembershipModule`):
  - Actions: `join()`, `joinWithReferral(address)`, `joinFor(address)`, `joinForWithReferral(address,address)`, `claimMemberRewards()`, `claimExternalReward(address)`.
  - Views: `getClaimableMemberRewards(address)`, `getExternalRewardTokens()`, `getExternalRewardState(address)`, `getClaimableExternalReward(address,address)`, `isMember(address)`, `getJoinDetails(address)`, `getTreasuryInfo()`, `getConfig()`.
  - `getConfig()` returns `(accessToken, entryFee, joinPaused, totalJoins, treasuryAvailable, memberPoolBalance, burnBps, treasuryBps, memberPoolBps, protocolBps)`.
- Treasury (from `TemplTreasuryModule`, callable by DAO via governance or priest during dictatorship):
  - `withdrawTreasuryDAO(address token, address recipient, uint256 amount, string reason)`
  - `disbandTreasuryDAO(address token)`
  - `updateConfigDAO(address tokenOrZero, uint256 newEntryFeeOrZero, bool applySplit, uint256 burnBps, uint256 treasuryBps, uint256 memberPoolBps)`
  - `setMaxMembersDAO(uint256)`, `setJoinPausedDAO(bool)`, `changePriestDAO(address)`, `setDictatorshipDAO(bool)`, `setTemplMetadataDAO(string,string,string)`, `setProposalCreationFeeBpsDAO(uint256)`, `setReferralShareBpsDAO(uint256)`, `setEntryFeeCurveDAO(CurveConfig,uint256)`, `cleanupExternalRewardToken(address)` (DAO‑only)
- Governance (from `TemplGovernanceModule`):
  - Create proposals: `createProposalSetJoinPaused`, `createProposalUpdateConfig`, `createProposalWithdrawTreasury`, `createProposalDisbandTreasury`, `createProposalChangePriest`, `createProposalSetDictatorship`, `createProposalSetMaxMembers`, `createProposalUpdateMetadata`, `createProposalSetProposalFeeBps`, `createProposalSetReferralShareBps`, `createProposalSetEntryFeeCurve`, `createProposalCallExternal`.
  - Cleanup proposals: `createProposalCleanupExternalRewardToken(address,uint256,string,string)` to remove an empty external reward token from enumeration (DAO‑gated; reverts unless pool and remainder are zero).
  - Vote/execute: `vote(uint256,bool)`, `executeProposal(uint256)`.
  - Views: `getProposal(uint256)`, `getProposalSnapshots(uint256)`, `getProposalJoinSequences(uint256)`, `getActiveProposals()`, `getActiveProposalsPaginated(uint256,uint256)`, `hasVoted(uint256,address)`.

### Behavior Notes
- Dictatorship mode (`priestIsDictator`) allows the priest to call `onlyDAO` functions directly. Otherwise, all `onlyDAO` actions are executed by governance via `executeProposal`.
- Membership cap vs. pause:
  - When `memberCount >= maxMembers`, the contract auto-pauses joins (`joinPaused = true`). See `TemplBase._autoPauseIfLimitReached()` (contracts/TemplBase.sol:1081).
  - Unpausing without increasing `maxMembers` does not enable new joins. Join attempts will revert with `MemberLimitReached` due to the cap check in `TemplMembershipModule._join` (contracts/TemplMembership.sol:50–52).
  - Recommended practice: if the cap is reached and you want to reopen membership, first increase `maxMembers` (or remove the cap), then unpause. This avoids confusing states where the templ appears unpaused but joins still revert at the cap guard.
- External-call proposals can execute arbitrary calls with optional ETH; they should be used cautiously.

### Security Notes
- Dictatorship mode (`priestIsDictator`): when enabled, the priest can call DAO‑only functions directly. Otherwise, they must be executed via proposals.
- External-call proposals: allow arbitrary calls/value and can drain treasury; ensure UIs warn voters appropriately.
- Cleanup of external rewards: `cleanupExternalRewardToken(address)` is now DAO‑only. It can only remove tokens whose external reward pool and remainder are fully settled; otherwise it reverts.

### Quorum & Timeouts
- Pre‑quorum voting window:
  - On creation, proposals set `endTime = block.timestamp + votingPeriod` (7–30 days).
  - Members may vote until `endTime`; attempts after that revert with `VotingEnded` (contracts/TemplGovernance.sol:319).
  - If quorum is never reached by `endTime`, the proposal cannot be executed (`QuorumNotReached`).
- When quorum is reached:
  - Records `quorumReachedAt`, `quorumSnapshotBlock`, and locks join eligibility via a join‑sequence snapshot.
  - Resets `endTime = block.timestamp + executionDelayAfterQuorum` and leaves voting open during this delay window (contracts/TemplGovernance.sol:353).
  - After the delay, proposals are executable if both conditions hold:
    - Quorum maintained: `yesVotes * 10_000 >= quorumBps * eligibleVoters` (uses the pre‑quorum eligible voter count at creation).
    - Majority yes: `yesVotes > noVotes`.
  - Execute guard checks: contracts/TemplGovernance.sol:367.
  - Note for indexers/UIs: the “active proposals” list uses `endTime` to decide activeness. After the delay passes (and the proposal becomes executable), it will drop from the active list even though it can still be executed; query individual proposals via `getProposal()` to surface execution‑ready items.
- Quorum‑exempt proposals (priest’s `DisbandTreasury`):
  - Do not use the execution delay; they require waiting until the original `votingPeriod` elapses, then a simple majority (`yesVotes > noVotes`).
  - Execute guard for quorum‑exempt: contracts/TemplGovernance.sol:375.
