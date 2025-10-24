templ.fun UI Integration Guide

Purpose: give UI developers a single place to see which contract, function, params, and allowances are required to perform all core templ actions. UIs always call the TEMPL router. Modules are for routing/introspection only.

Router-first rule
- Always call the `TEMPL` contract for all actions. Direct calls to module implementations revert by design.
- Discover module mapping if needed via:
  - `TEMPL.getRegisteredSelectors()` to see the canonical ABI surface per module.
  - `TEMPL.getModuleForSelector(bytes4)` to sanity-check routing for a selector.
  - `TEMPL.MEMBERSHIP_MODULE()`, `TEMPL.TREASURY_MODULE()`, `TEMPL.GOVERNANCE_MODULE()` return implementation addresses (do not call them directly).

Common preflight helpers
- Access token and entry fee: `TEMPL.getConfig()` → `(token, fee, joinPaused, joins, treasury, pool, burnBps, treasuryBps, memberPoolBps, protocolBps)`
- Treasury/burn display: `TEMPL.getTreasuryInfo()` → `(treasury, memberPool, protocolRecipient, burned)`
- Member status: `TEMPL.isMember(address)`; count: `TEMPL.getMemberCount()`
- External rewards list: `TEMPL.getExternalRewardTokens()` or paginated `getExternalRewardTokensPaginated(offset, limit)`

Allowances and approvals
- Joins: UIs should default to approving a buffer of `2 × entryFee` to the TEMPL address. This protects against fee increases caused by concurrent joins between your approval and `join()` submission, and it leaves headroom for your first proposal creation fee (when enabled) without prompting another approval. Always make this adjustable and never default to unlimited.
- Proposal creation: when `proposalCreationFeeBps > 0`, the proposer pays `proposalFee = entryFee * proposalCreationFeeBps / 10_000` in the access token. The 2× buffer above typically covers this; if not, prompt for a top‑up approval.
- External reward claims for ERC‑20s do not require approvals (the templ transfers out). ETH uses a plain call.

Join slippage handling (race‑proof UX)
- On submit, re‑read `entryFee` from `getConfig()` and check current allowance. If `allowance < entryFee`, prompt to top‑up approval. With the recommended 2× buffer, this should be rare.
- Show a concise note explaining that the approval buffer both guarantees the join and pre‑funds the first proposal fee.

1) Join (default)
- Step A: read `const [token, entryFee] = (await templ.getConfig());`
- Step B: `IERC20(token).approve(templ, entryFee)`
- Step C: `templ.join()`
- Errors to surface as UX: paused (`joinPaused`), cap reached, insufficient balance, invalid fee.

2) Join With Referral
- Same as join, but call `templ.joinWithReferral(referrer)`.
- The referrer must already be a member and cannot equal the recipient; referral rewards are paid immediately from the member-pool slice and emitted via `ReferralRewardPaid(referral, newMember, amount)`.
- Variants: sponsor another wallet with `templ.joinFor(recipient)` or `templ.joinForWithReferral(recipient, referrer)`.

3) Claim Rewards (member pool and external)
- Member pool (access token):
  - UI pre-read: `templ.getClaimableMemberRewards(user)`
  - Claim: `templ.claimMemberRewards()`
- External rewards (ERC-20 or ETH):
  - Enumerate tokens: `templ.getExternalRewardTokens()` (or paginated)
  - Per token preview: `templ.getClaimableExternalReward(user, token)` (use `address(0)` for ETH)
  - Claim: `templ.claimExternalReward(token)`
- Note: Referral rewards are sent at join time to the referrer; there is no separate referral claim.

4) Create a Governance Proposal
- Preconditions: caller must be a member. If `proposalCreationFeeBps > 0`, approve `proposalFee` in access tokens to the templ before creating.
- Voting period: pass `0` to use the templ’s default pre‑quorum window, or a custom number of seconds within the allowed range.
- Common creators (see full list below):
  - Pause/resume joins: `templ.createProposalSetJoinPaused(bool paused, uint256 votingPeriod, string title, string description)`
  - Update entry fee / split: `templ.createProposalUpdateConfig(uint256 newFee, uint256 newBurnBps, uint256 newTreasuryBps, uint256 newMemberPoolBps, bool updateSplit, uint256 votingPeriod, string title, string description)`
  - Withdraw treasury/external funds: `templ.createProposalWithdrawTreasury(address tokenOrZero, address recipient, uint256 amount, string reason, uint256 votingPeriod, string title, string description)`
 - Arbitrary external call: `templ.createProposalCallExternal(address target, uint256 value, bytes4 selector, bytes params, uint256 votingPeriod, string title, string description)`
- Building CallExternal params (ethers v6 style):
  - Selector: `target.interface.getFunction("fn").selector`
  - Params: `ethers.AbiCoder.defaultAbiCoder().encode(["type",...], [values...])`
  - calldata is selector || params; the module does this packing for you when you pass both.
- Full proposal surface and payload shapes:
  - Read `contracts/TemplGovernance.sol` create functions for the complete list and param types.
  - For any proposal id, use `TEMPL.getProposalActionData(id)` to fetch `(Action action, bytes payload)` and inspect the exact payload for rendering and indexing.

5) Vote on a Proposal
- Call: `templ.vote(uint256 proposalId, bool support)`
- Snapshot rules enforced on-chain:
  - Eligibility locks at creation by join sequence; after quorum, it re‑snapshots. UI can show `getProposalSnapshots(id)` and `getProposalJoinSequences(id)`.
- Helpful reads: `templ.getProposal(id)`, `templ.hasVoted(id, user)`.

6) Execute a Proposal
- Call: `templ.executeProposal(uint256 proposalId)` once it has passed and delay/quorum rules are satisfied.
- UI can precompute executability via `templ.getProposal(id)` (see `passed` field) and show countdowns from `endTime` and `getProposalSnapshots(id)`.

7) Read Balances for UI
- Treasury and burned totals for group header:
  - `const [treasury, memberPool, protocolRecipient, burned] = await templ.getTreasuryInfo();`
- Additional config for context: `templ.getConfig()`; member counts: `templ.getMemberCount()`, total joins: `templ.totalJoins()`.

Create with defaults or custom
- Voting window: pass `0` to any `createProposal*` to use the templ’s default pre‑quorum window; pass a custom number of seconds (within bounds) to override.
- Entry fee curve proposals accept a full `CurveConfig` and optional `baseEntryFee` (0 keeps current anchor).

Complete proposal creators (scan in code for params)
- `createProposalSetJoinPaused`
- `createProposalUpdateConfig`
- `createProposalSetMaxMembers`
- `createProposalUpdateMetadata`
- `createProposalSetProposalFeeBps`
- `createProposalSetReferralShareBps`
- `createProposalSetEntryFeeCurve`
- `createProposalCallExternal`
- `createProposalWithdrawTreasury`
- `createProposalDisbandTreasury`
- `createProposalChangePriest`
- `createProposalSetDictatorship`
- `createProposalCleanupExternalRewardToken`
- `createProposalSetQuorumBps`
- `createProposalSetPostQuorumVotingPeriod`
- `createProposalSetBurnAddress`

Security notes for UIs
- Default to a bounded buffer, not unlimited. Approve `~2× entryFee` for joins (adjustable) and avoid unlimited approvals.
- External call proposals are as powerful as timelocked admin calls; surface clear warnings. If batching is needed, use an executor contract like `contracts/tools/BatchExecutor.sol` and target it via `createProposalCallExternal`.
- Only call the router. Modules revert on direct calls to prevent bypassing safety checks.

Minimal flow snippets (ethers v6)
- Join: read fee → approve(templ, fee) → `templ.join()`.
- Join with referral: approve → `templ.joinWithReferral(referrer)`.
- Claim member pool: preview → `templ.claimMemberRewards()`.
- Claim external: list tokens → preview per token → `templ.claimExternalReward(token)`.
- Create proposal (pause joins): maybe approve proposalFee → `templ.createProposalSetJoinPaused(true, 0, "Pause joins", "Reason")`.
- Create proposal (external call): compute selector/params → `templ.createProposalCallExternal(target, value, selector, params, 0, title, desc)`.
- Vote: `templ.vote(id, true|false)`.
- Execute: `templ.executeProposal(id)`.

Where to look in code
- Router selectors and mapping: `contracts/TEMPL.sol:120`
- Membership APIs: `contracts/TemplMembership.sol:1`
- Governance APIs: `contracts/TemplGovernance.sol:1`
- Treasury APIs: `contracts/TemplTreasury.sol:1`
- Action payload helper: `contracts/TEMPL.sol:240` via `getProposalActionData`

Example: Approve + Deploy Vesting (from templ via batchDAO)
- Goal: create a proposal that atomically approves a vesting/streaming factory, then calls its `deploy_vesting_contract` entrypoint, with both calls originating from the templ address.
- Target factory: `0xcf61782465Ff973638143d6492B51A85986aB347` with selector `0x0551ebac` and params `(address token, address recipient, uint256 amount, uint256 vesting_duration)`.
- Pattern: build two inner calls and execute them via `TEMPL.batchDAO(address[],uint256[],bytes[])` called through `createProposalCallExternal` targeting the TEMPL router.

Ethers v6 encoding snippet (UI side):
```js
// Inputs the UI collects
const token = "0xAccessToken";              // templ access token
const factory = "0xcf61782465Ff973638143d6492B51A85986aB347"; // vesting/stream factory
const recipient = "0xRecipient";
const amount = ethers.parseUnits("1000", 18);
const vestingDuration = 60n * 60n * 24n * 365n; // 1 year

// 1) Build approve(token -> factory, amount)
const erc20 = await ethers.getContractAt("IERC20", token);
const approveSel = erc20.interface.getFunction("approve").selector;
const approveArgs = ethers.AbiCoder.defaultAbiCoder().encode(["address","uint256"],[factory, amount]);
const approveCalldata = ethers.concat([approveSel, approveArgs]);

// 2) Build deploy_vesting_contract(token, recipient, amount, vesting_duration)
const deploySel = "0x0551ebac"; // function selector
const deployArgs = ethers.AbiCoder.defaultAbiCoder().encode(
  ["address","address","uint256","uint256"],
  [token, recipient, amount, vestingDuration]
);
const deployCalldata = ethers.concat([deploySel, deployArgs]);

// 3) Wrap in templ.batchDAO
const targets = [token, factory];
const values = [0, 0];
const calldatas = [approveCalldata, deployCalldata];

const Treasury = await ethers.getContractFactory("TemplTreasuryModule");
const batchSel = Treasury.interface.getFunction("batchDAO").selector;
const batchParams = ethers.AbiCoder.defaultAbiCoder().encode(
  ["address[]","uint256[]","bytes[]"],
  [targets, values, calldatas]
);

// 4) Create the proposal: templ -> templ.batchDAO
await templ.createProposalCallExternal(
  await templ.getAddress(),
  0,
  batchSel,
  batchParams,
  0,
  "Approve + Deploy Vesting",
  "Approve access token then deploy a vesting/stream contract"
);
```

Important
- Calls execute from the templ address. Any `approve` and downstream `transferFrom` affect the templ’s allowance and balance, preserving custody in the templ.
- Keep `value=0` unless the target expects ETH.

5) Donate (ETH or ERC‑20)
- Summary: Donations require no templ call. The templ accepts direct transfers of ETH or any ERC‑20; governance can later withdraw these funds to recipients or disband them into member‑claimable external rewards.
- ETH donation: present the templ address and let donors send ETH directly to `templ.target` (the contract address). This increases the templ’s ETH holdings immediately.
- ERC‑20 donation: instruct donors to call the token’s `transfer(templ.target, amount)` from their wallet. No allowance is needed for a simple `transfer`.
- Access‑token donations (the same token used for joins): they increase the templ’s on‑hand access‑token balance available to governance. UI display can reflect this via `getTreasuryInfo()` where `treasury = currentBalance(accessToken) − memberPoolBalance`.
- External ERC‑20 donations (any other token): they become withdrawable by governance and disband‑able into external rewards (tracked per token). Tokens are auto‑registered for enumeration the first time governance disbands that token. Before the first disband, they won’t appear in `getExternalRewardTokens()` yet (they are still held and withdrawable).
- Suggested UI copy: “Donate to this templ by sending ETH or any ERC‑20 directly to the templ address. Funds are controlled by governance (or the priest if dictatorship is enabled) and may be withdrawn or distributed to members according to on‑chain votes.”
- Dictatorship behavior: when dictatorship is enabled, the priest can withdraw or disband donations immediately (no voting window); otherwise, movements happen through governance proposals.
