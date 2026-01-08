templ.fun UI Integration Guide

Purpose: give UI developers a single place to see which contract, function, params, and allowances are required to perform all core templ actions. UIs always call the TEMPL router. Modules are for routing/introspection only.

Router-first rule
- Always call the `TEMPL` contract for all actions. Direct calls to module implementations revert by design.
- Discover module mapping if needed via:
  - `TEMPL.getRegisteredSelectors()` to see the canonical ABI surface per module.
  - `TEMPL.getModuleForSelector(bytes4)` to sanity-check routing for a selector.
  - `TEMPL.MEMBERSHIP_MODULE()`, `TEMPL.TREASURY_MODULE()`, `TEMPL.GOVERNANCE_MODULE()`, `TEMPL.COUNCIL_MODULE()` return implementation addresses (do not call them directly).

Governance-controlled upgrades
- No protocol admin: there is no owner or protocol dev key that can change behavior for a templ. Routing changes are only possible via that templ’s own governance.
- Introspection: `getRegisteredSelectors()` is a static helper for the shipped modules; the live mapping is authoritative and can be read via `getModuleForSelector(bytes4)` per selector.
- How to upgrade via UI: build a `createProposalCallExternal` targeting the templ address with the `setRoutingModuleDAO(address,bytes4[])` selector and ABI‑encoded params. After the proposal passes and executes, calls to those selectors will route to the new module.
- Module access guard: module implementations revert on direct calls; all interactions must flow through `TEMPL` (delegatecall) to share storage and enforce guards.

Common preflight helpers
- Access token and entry fee: `TEMPL.getConfig()` → `(token, fee, joinPaused, joins, treasury, pool, burnBps, treasuryBps, memberPoolBps, protocolBps)`
- Treasury/burn display: `TEMPL.getTreasuryInfo()` → `(treasury, memberPool, protocolRecipient, burned)`
- Member status: `TEMPL.isMember(address)`; count: `TEMPL.getMemberCount()`

Allowances and approvals
- Joins (all variants): approve the access token to `templ.target` before calling the join. Recommend a buffer of `2 × entryFee` to absorb fee changes and cover the first proposal creation fee. Always make this adjustable and never default to unlimited.
- Proposal creation fee: when `proposalCreationFeeBps > 0` and the computed `proposalFee = entryFee * proposalCreationFeeBps / 10_000` is non-zero, non-council proposers must approve `proposalFee` to `templ.target` prior to any `createProposal*` call (council proposers are fee‑exempt while council mode is active).
- Donations: no approvals are needed. Donors send ETH directly to the templ address, or call token `transfer(templ.target, amount)`.

Donations: address and custody
- Donation address: Always use the templ (router) address (`templ.target`) for donations. There is no separate treasury address on-chain; “treasury” is an internal accounting bucket within the templ contract.
- ETH donations: Send ETH directly to `templ.target` (receive() accepts ETH). Governance can withdraw it; disbanding sweeps the full balance to the protocol fee recipient.
- ERC‑20 donations: Transfer tokens to `templ.target` (no prior approval needed by the recipient). Governance can withdraw them; disbanding non‑access tokens sweeps the full balance to the protocol fee recipient.
- NFTs (ERC‑721): The templ can custody NFTs, but it does not implement `IERC721Receiver`. `safeTransferFrom(..., templ.target, ...)` will revert. Use `transferFrom` to the templ, or have governance “pull” via `transferFrom(owner, templ.target, tokenId)` after the owner grants approval. Move NFTs later via external‑call proposals (e.g., `createProposalCallExternal` calling the NFT’s `safeTransferFrom`).
- Membership note: Direct donations (including the access token) do not grant membership. UIs should route joining through `join*` flows, which pull the access token and update on-chain membership state.

Allowance checklist (TL;DR)
- join / joinWithReferral / joinFor / joinForWithReferral / joinWithMaxEntryFee / joinWithReferralMaxEntryFee / joinForWithMaxEntryFee / joinForWithReferralMaxEntryFee → approve access token to `templ.target` (payer = `msg.sender`).
- createProposal* (if fee > 0) → approve access token to `templ.target` for `proposalFee` unless the proposer is a council member and council mode is active.
- claimMemberRewards → no approvals.
- batchDAO / external calls (proposals) → no user approvals; if tokens need templ approvals, include them inside the batch.

Join slippage handling (race‑proof UX)
- On submit, re‑read `entryFee` from `getConfig()` and check current allowance. If `allowance < entryFee`, prompt to top‑up approval. With the recommended 2× buffer, this should be rare.
- For on-chain slippage caps, use `joinWithMaxEntryFee` / `joinWithReferralMaxEntryFee` / `joinForWithMaxEntryFee` / `joinForWithReferralMaxEntryFee`.
- Show a concise note explaining that the approval buffer both guarantees the join and pre‑funds the first proposal fee.
- Runtime entry fees are normalized to ≥10 and divisible by 10; decaying curves floor at 10, so display the on-chain `entryFee` verbatim.
- `baseEntryFee` anchors may be non-divisible by 10 after retargets; only `entryFee` is guaranteed divisible.

0) Deploy From Factory
- Surface factory deployment in the UI for creating new templs. UIs call the factory to create a templ, then switch to the `TEMPL` router for all runtime actions.
- Access control: read `factory.permissionless()` and `factory.factoryDeployer()`.
  - When `permissionless == false`, only `factoryDeployer` may create templs; disable the create UI for others.
  - When `permissionless == true`, anyone may create templs.

Minimal/default deploy (no custom splits)
- Use `factory.createTempl(token, entryFee, name, description, logoLink)` when the deployer is also the priest.
- Use `factory.createTemplFor(priest, token, entryFee, name, description, logoLink, proposalFeeBps, referralShareBps)` to set an explicit priest and fee knobs. Other parameters use factory defaults.
- Defaults applied by the factory:
  - Splits: burn 3,000 bps; treasury 3,000 bps; memberPool 3,000 bps; protocol `PROTOCOL_BPS`.
  - Governance: quorum 3,300 bps; post‑quorum voting window 36 hours; burn address dead address.
  - Caps/curve: `maxMembers = 249`; curve is exponential for 248 paid joins (through member #249 including the priest), then static tail if the cap is raised.
  - Metadata caps: name ≤256 bytes; description ≤2048 bytes; logo URI ≤2048 bytes.
- Ethers v6 example (default deploy):
```js
const factory = await ethers.getContractAt("TemplFactory", factoryAddress);
// Priest = msg.sender (deployer). Use createTempl
const tx = await factory.createTempl(
  tokenAddress,
  entryFee,                 // ≥10 and divisible by 10 (raw token units)
  templName,
  templDescription,
  templLogoLink
);
const receipt = await tx.wait();
// Parse TemplCreated event or pre‑read via staticCall for the new templ address
const templAddress = await factory.createTempl.staticCall(
  tokenAddress, entryFee, templName, templDescription, templLogoLink
);
```

Complete custom deploy (full config)
- Use `factory.createTemplWithConfig(CreateConfig)` to set all parameters. Recommended when your UI exposes fee splits, quorum/delay, cap, curve, and metadata.
- Struct fields (sentinels apply defaults):
  - `priest`: EOA that becomes priest (zero uses `msg.sender`).
  - `token`: ERC‑20 access token (assumed vanilla; contracts do not enforce this, so UIs should warn on known tax/rebase/hook tokens).
  - `entryFee`: ≥10 and divisible by 10 (raw token units).
  - `burnBps`, `treasuryBps`, `memberPoolBps`: `int256`; use `-1` to apply factory defaults; otherwise 0…10,000.
  - `quorumBps`: 0 applies default; otherwise 0…10,000.
  - `executionDelaySeconds`: 0 applies default; otherwise within [1 hour, 30 days].
  - `burnAddress`: zero applies default.
  - `maxMembers`: 0 for uncapped; otherwise positive cap. Auto‑pause at cap.
  - `curveProvided`: false applies factory default curve.
  - `curve`: `{ primary: {style, rateBps, length}, additionalSegments: CurveSegment[] }` (≤8 segments total; if `additionalSegments` is empty, `primary.length` must be 0; otherwise `primary.length` must be >0 and the last additional segment must have `length = 0`).
  - `name`, `description`, `logoLink`: UI metadata.
  - `proposalFeeBps`: bps of entry fee charged to proposers.
  - `referralShareBps`: bps share taken from member‑pool slice for referrers.
  - `yesVoteThresholdBps`: bps of votes cast required for proposals to pass (0 applies default).
  - `councilMode`: boolean to start in council governance mode.
  - `instantQuorumBps`: bps of eligible voters required for instant quorum (0 applies default).
- Constraints your UI must enforce:
  - Fee split must sum to 10,000 bps including protocol share (factory enforces `burn + treasury + memberPool + PROTOCOL_BPS == 10,000`).
  - Percent fields in [0, 10,000].
  - Curve config: ≤8 total segments; if `additionalSegments` is empty, `primary.length` must be 0. If `additionalSegments` is non-empty, `primary.length` must be >0, intermediate additional segments must have `length > 0`, and the final additional segment must have `length = 0`.
  - Curve segment rates: static requires `rateBps = 0`; exponential requires `rateBps > 0` (linear allows any `rateBps`, including 0).
  - No minimums on burn/treasury/memberPool splits (0 is valid); only the protocol share is fixed by factory config.
  - `yesVoteThresholdBps`: 0 applies default; otherwise must be in [100, 10,000].
  - `instantQuorumBps`: 0 applies default; otherwise must be in [1, 10,000] and `instantQuorumBps >= effectiveQuorumBps` (the default quorum when `quorumBps == 0`).
  - Entry fee constraints as above; runtime curve recomputes normalize to ≥10 and divisible by 10.
- Ethers v6 example (full config):
```js
const factory = await ethers.getContractAt("TemplFactory", factoryAddress);
const config = {
  priest: priestAddress,
  token: tokenAddress,
  entryFee,                      // raw token units, ≥10 and % 10 == 0
  burnBps: 3000,                 // or -1 to use default
  treasuryBps: 3000,             // or -1 to use default
  memberPoolBps: 3000,           // or -1 to use default
  quorumBps: 3300,               // or 0 for default
  executionDelaySeconds: 36*60*60, // or 0 for default
  burnAddress: ethers.ZeroAddress, // zero for default
  maxMembers: 249,
  curveProvided: true,
  curve: {
    primary: { style: 2, rateBps: 10094, length: 248 },
    additionalSegments: [{ style: 0, rateBps: 0, length: 0 }]
  },
  name: templName,
  description: templDescription,
  logoLink: templLogoLink,
  proposalFeeBps: 2500,
  referralShareBps: 2500,
  yesVoteThresholdBps: 5100,
  councilMode: true,
  instantQuorumBps: 10000
};
// Preview the address then send the tx
const templAddress = await factory.createTemplWithConfig.staticCall(config);
await factory.createTemplWithConfig(config);
```

Post‑deploy handoff
- The `TemplCreated` event includes all genesis parameters and the new templ address. UIs can parse it or use the `staticCall` preview.
- After deployment, switch to the `TEMPL` router at `templAddress` for all subsequent actions (allowances, joins, proposals, etc.).
- If the UI supports permissioning, expose a minimal admin panel to flip `factory.setPermissionless(true)` when connected as `factoryDeployer` (otherwise hide this control).

1) Join (default)
- Step A: read `const [token, entryFee] = (await templ.getConfig());`
- Step B: `IERC20(token).approve(templ.target, entryFee)`
- Step C: `templ.join()`
- Errors to surface as UX: paused (`joinPaused`), cap reached, already joined, insufficient balance/allowance, `EntryFeeTooHigh` for max‑entry‑fee joins.

2) Join With Referral
- Same as join, but call `templ.joinWithReferral(referrer)`.
- Explicit allowance: the payer (`msg.sender`) must approve the access token to `templ.target` for at least `entryFee` (recommended `2 × entryFee`).
- A valid referrer is a member and not the recipient; otherwise the referral payout is 0. Referral rewards are paid immediately from the member‑pool slice and emitted via `ReferralRewardPaid(referral, newMember, amount)`.
- Variant `templ.joinFor(recipient)`: payer is the caller; approve `entryFee` from the caller to `templ.target` before calling.
- Variant `templ.joinForWithReferral(recipient, referrer)`: payer is the caller; approve `entryFee` from the caller to `templ.target` before calling.

3) Claim Rewards (member pool)
- Member pool (access token):
  - UI pre-read: `templ.getClaimableMemberRewards(user)`
  - Claim: `templ.claimMemberRewards()`
- Note: Referral rewards are sent at join time to the referrer; there is no separate referral claim.

4) Create a Governance Proposal
- Preconditions: caller must be a member. If `proposalCreationFeeBps > 0`, approve `proposalFee` in access tokens to the templ before creating.
- Voting period: pass `0` to use the templ’s default pre‑quorum window, or a custom number of seconds within the allowed range.
- Common creators (see full list below):
  - Pause/resume joins: `templ.createProposalSetJoinPaused(bool paused, uint256 votingPeriod, string title, string description)`
  - Update entry fee / split: `templ.createProposalUpdateConfig(uint256 newFee, uint256 newBurnBps, uint256 newTreasuryBps, uint256 newMemberPoolBps, bool updateSplit, uint256 votingPeriod, string title, string description)`
  - Withdraw treasury/external funds: `templ.createProposalWithdrawTreasury(address tokenOrZero, address recipient, uint256 amount, uint256 votingPeriod, string title, string description)`
  - Arbitrary external call: `templ.createProposalCallExternal(address target, uint256 value, bytes4 selector, bytes params, uint256 votingPeriod, string title, string description)`
- Building CallExternal params (ethers v6 style):
  - Selector: `target.interface.getFunction("fn").selector`
  - Params: `ethers.AbiCoder.defaultAbiCoder().encode(["type",...], [values...])`
  - calldata is selector || params; the module does this packing for you when you pass both.
- Full proposal surface and payload shapes:
  - Read `contracts/TemplGovernance.sol` and `contracts/TemplCouncil.sol` create functions for the complete list and param types.
  - For any proposal id, use `TEMPL.getProposalActionData(id)` to fetch `(Action action, bytes payload)` and inspect the exact payload for rendering and indexing.

Allowance steps for proposal creation (ethers v6):
```js
const [accessToken, entryFee] = await templ.getConfig();
const bps = await templ.proposalCreationFeeBps();
const proposalFee = (entryFee * bps) / 10_000n;
if (proposalFee > 0n) {
  const token = await ethers.getContractAt("IERC20", accessToken);
  const allowance = await token.allowance(await signer.getAddress(), templ.target);
  if (allowance < proposalFee) {
    await token.approve(templ.target, proposalFee);
  }
}
// Now call any createProposal*
```

5) Vote on a Proposal
- Call: `templ.vote(uint256 proposalId, bool support)`
- Snapshot rules enforced on-chain:
  - Eligibility locks at creation by join sequence; after quorum, it re‑snapshots. UI can show `getProposalSnapshots(id)` and `getProposalJoinSequences(id)`.
  - Voting mode is snapshotted per proposal; use `getProposalVotingMode(id)` instead of the current `councilModeEnabled` when deciding who can vote.
  - For member‑wide proposals, the post‑quorum eligible voter count snapshots `memberCount` at quorum even if council mode toggles later.
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
- Entry fee curve proposals accept a full `CurveConfig` and optional `baseEntryFee` (0 keeps current anchor). Base anchors must be ≥10 but do not need to be divisible by 10.

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
- `createProposalDisbandTreasury` (when proposed by the priest or a council member while council mode is enabled, the proposal is quorum-exempt but still must meet the YES vote threshold after voting ends)
- `createProposalChangePriest` (new priest must already be a member)
- `createProposalSetQuorumBps`
- `createProposalSetInstantQuorumBps`
- `createProposalSetPostQuorumVotingPeriod`
- `createProposalSetBurnAddress`
- `createProposalSetYesVoteThreshold`
- `createProposalSetCouncilMode`
- `createProposalAddCouncilMember`
- `createProposalRemoveCouncilMember`

Council proposal guards
- `createProposalAddCouncilMember`: the target must already be a member.
- `createProposalRemoveCouncilMember`: proposer must be a council member; removals that would leave the council empty revert.

DAO-only actions via `createProposalCallExternal` (target = templ)
- `setPreQuorumVotingPeriodDAO(uint256 newPeriod)`
- `sweepMemberPoolRemainderDAO(address recipient)`
- `batchDAO(address[] targets, uint256[] values, bytes[] calldatas)`
- `setRoutingModuleDAO(address module, bytes4[] selectors)`

Security notes for UIs
- Default to a bounded buffer, not unlimited. Approve `~2× entryFee` for joins (adjustable) and avoid unlimited approvals.
- External call proposals are as powerful as timelocked admin calls; surface clear warnings. For batching, prefer `batchDAO` (via `createProposalCallExternal`) or an executor contract like `contracts/tools/BatchExecutor.sol`.
- `CallExternal` and `batchDAO` can bypass access-token accounting; avoid targeting the templ or its modules and keep batch targets explicit and external.
- Only call the router. Modules revert on direct calls to prevent bypassing safety checks.
- Governance-only upgrades: there is no protocol-level upgrade authority. Routing and external-call abilities are controlled by each templ’s governance. Reflect this in copy to avoid confusing users about admin powers.

Minimal flow snippets (ethers v6)
- Join: read fee → approve(templ, fee) → `templ.join()`.
- Join with referral: approve → `templ.joinWithReferral(referrer)`.
- Claim member pool: preview → `templ.claimMemberRewards()`.
- Create proposal (pause joins): maybe approve proposalFee → `templ.createProposalSetJoinPaused(true, 0, "Pause joins", "Reason")`.
- Create proposal (external call): compute selector/params → `templ.createProposalCallExternal(target, value, selector, params, 0, title, desc)`.
  - Calldata size is capped at 4,096 bytes (selector + params); larger payloads must be moved off-chain or split via helper contracts.
- Vote: `templ.vote(id, true|false)`.
- Execute: `templ.executeProposal(id)`.

Where to look in code
- Router selectors and mapping: `contracts/TEMPL.sol`
  - Upgrade routing via DAO: `TEMPL.setRoutingModuleDAO(module, selectors)` can be called through a governance CallExternal proposal targeting the TEMPL address. This updates the fallback dispatch mapping without redeploying.
- Membership APIs: `contracts/TemplMembership.sol`
- Governance APIs: `contracts/TemplGovernance.sol`
- Treasury APIs: `contracts/TemplTreasury.sol`
- Council APIs: `contracts/TemplCouncil.sol`

Gotchas and validation checklist
- One active proposal per proposer: `templ.hasActiveProposal(user)` can be stale after expiry; if true, read `templ.activeProposalId(user)` and `templ.getProposal(id)` and only block creation when `executed == false` and `endTime` is still in the future.
- Voting window anchors at quorum: when quorum is reached, `endTime` resets to `block.timestamp + postQuorumVotingPeriod`, unless instant quorum triggers and `endTime` is set to `block.timestamp`. Always show the latest `endTime` from `getProposal(id)` and check `instantQuorumMet` via `templ.proposals(id)`; do not precompute.
- Pre‑quorum voting period bounds: enforce `[36h, 30d]`. Passing `0` applies the templ default.
- Title/description caps: title ≤256 bytes, description ≤2048 bytes. Truncate or warn before submit.
- Entry fee update constraints: new fee must be ≥10 and divisible by 10 (raw token units). Validate before proposing.
- Curve config bounds: ≤8 total segments; if `additionalSegments` is empty, `primary.length` must be 0. If `additionalSegments` is non-empty, `primary.length` must be >0, intermediate additional segments must have `length > 0`, and the final additional segment must have `length = 0`. Static segments require `rateBps = 0`; exponential segments require `rateBps > 0` (linear allows any `rateBps`, including 0).
- Batch external calls with ETH: when batching via `templ.batchDAO`, set `target = templ.getAddress()` and ensure the templ already holds sufficient ETH to cover the inner `values` (top-level `value` can be 0). Calls execute from the templ address, so any approve/transferFrom affects the templ's allowance/balance; any inner revert bubbles and reverts the whole batch.
- Pagination limits: `getActiveProposalsPaginated` requires `1 ≤ limit ≤ 100`.
- Join auto‑pause at cap: if `maxMembers` is set and reached, `joinPaused` flips true automatically. Always read `joinPaused` before enabling join UI.
- Referral rules: referrer must be an existing member and not the recipient; otherwise referral pays 0. Consider checking `isMember(referrer)` pre‑submit.
- ETH recipients: treasury ETH withdrawals call `recipient.call{value: amount}("")`. If the recipient is a non‑payable contract or reverts in `receive()`, the withdrawal reverts. Prefer EOA or payable targets.
- Action payload helper: call `TEMPL.getProposalActionData(id)` to fetch `(Action action, bytes payload)`. See README “Proposal Views” for payload shapes.

8) Donate (ETH or ERC‑20)
- Summary: Donations require no templ call. The templ accepts direct transfers of ETH or any ERC‑20; governance can withdraw these funds to recipients. Disbanding the access token moves it into the member pool; disbanding other tokens sweeps the full balance to the protocol fee recipient.
- ETH donation: present the templ address and let donors send ETH directly to `templ.target` (the contract address). This increases the templ’s ETH holdings immediately.
- ERC‑20 donation: instruct donors to call the token’s `transfer(templ.target, amount)` from their wallet. No allowance is needed for a simple `transfer`.
- Access‑token donations (the same token used for joins): they increase the templ’s on‑hand access‑token balance available to governance. UI display can reflect this via `getTreasuryInfo()` where `treasury = currentBalance(accessToken) − memberPoolBalance`.
- Suggested UI copy: “Donate to this templ by sending ETH or any ERC‑20 directly to the templ address. Funds are controlled by governance and may be withdrawn or disbanded by on‑chain votes.”
