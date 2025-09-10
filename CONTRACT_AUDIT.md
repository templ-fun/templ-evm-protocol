## TEMPL Smart Contract Audit

Date: 2025-09-10
Auditor: Codex CLI (OpenAI)
Scope: `contracts/TEMPL.sol` (Solidity 0.8.23) with accompanying errors lib and tests
Commit: 6e66cb8ddc1c1b3473355ba8606ca4b09e7e4e7e

### Executive Summary

- Overall security posture: strong. The contract follows prudent patterns (typed governance proposals, nonReentrant external entry points, SafeERC20 for transfers, explicit access controls) and is accompanied by comprehensive tests (132 passing) that meaningfully exercise reentrancy, treasury accounting, voting eligibility, pagination, and wrapper behaviors.
- Critical/High severity issues: none found.
- Medium severity issues: none found.
- Low/Informational issues: a few minor observations and best‑practice recommendations (see Findings).
- Tests: comprehensive and passing locally (`npx hardhat test`), including adversarial mocks for reentrancy and proposal flows. Treasury math is validated with invariant‑style checks.

### In-Scope Artifacts

- contracts/TEMPL.sol
- contracts/TemplErrors.sol
- contracts/mocks/* (used by tests)
- hardhat.config.js (compiler/version settings)
- test/*.test.js (behavioral and adversarial test suites)

Notes: This audit focuses primarily on the TEMPL contract and the correctness and completeness of its tests, per the request.

### Methodology

- Manual, line‑by‑line code review of `contracts/TEMPL.sol` and `contracts/TemplErrors.sol`.
- Reasoning about invariants, attack surface, and failure modes.
- Review of test coverage and adversarial scenarios.
- Local execution of the Hardhat test suite.

### System Overview

TEMPL is a membership contract where users purchase access with an ERC‑20 token. Each purchase splits the entry fee into 30% burned, 30% to a tracked treasury, 30% to a member pool (to be claimed by existing members), and 10% to the protocol fee recipient. Governance is member‑based with one vote per member. Proposals are typed (not arbitrary calldata) and, upon passage, can:

- Pause/unpause purchases
- Update the entry fee (token change is disabled post‑deploy)
- Withdraw treasury/donations (a specific token/ETH or all of a token) with protections to preserve the member pool reserves
- Disband the treasury by allocating it to the member pool equally across members

Key design choices that reduce risk:

- Typed proposal creation functions instead of arbitrary function execution
- `onlyDAO` wrappers callable only by `address(this)`, thus gating execution to passed proposals
- `nonReentrant` on all state‑changing external entry points (`purchaseAccess`, `executeProposal`, `claimMemberPool`)
- `SafeERC20` for all token transfers
- Treasury accounting that preserves the member pool’s reserved balance

### Threat Model & Assumptions

- ERC‑20 tokens may be non‑standard or malicious (hence SafeERC20 usage is important). A malicious token can still attempt reentrancy via callbacks; nonReentrancy guards mitigate this.
- Governance is one‑person‑one‑vote for members; proposer auto‑votes “yes”.
- The `protocolFeeRecipient` is immutable post‑deployment.
- The access token address is immutable post‑deployment (token change disabled by governance).
- Time‑based behavior relies on `block.timestamp` which can be miner‑skewed by ~seconds but is standard for voting windows.

## Findings

No critical or high severity issues were found. The following minor observations and recommendations are provided for hardening and clarity.

1) Voting eligibility strictly excludes same‑timestamp joiners (Low/UX)
- Code: `contracts/TEMPL.sol:368-369`
  - `if (members[msg.sender].timestamp >= proposal.createdAt) revert TemplErrors.JoinedAfterProposal();`
- Impact: If a member joins in the same timestamp as proposal creation (e.g., same block second), they are ineligible to vote even though they did not join “after”. This is more of a UX/policy nuance than a security risk.
- Recommendation: Consider changing `>=` to `>` so that addresses with identical timestamps (same second) are allowed to vote. This aligns with the test commentary about “same block” expectations.

2) Non‑paginated active proposals function can be expensive (Informational)
- Code: `contracts/TEMPL.sol:679-695`
- Impact: `getActiveProposals()` traverses the full `proposalCount`. It’s `view`, so off‑chain it’s fine, but on‑chain callers could hit gas limits as the proposal set grows.
- Recommendation: Prefer `getActiveProposalsPaginated` for all on‑chain or gas‑sensitive use. Keep the warning comment; ensure UIs only call the paginated variant.

3) Burning by transfer to a dead address (Informational)
- Code: `contracts/TEMPL.sol:230`
- Impact: “Burn” relies on sending to `0x...dEaD` rather than using a token’s `burn` interface. For most ERC‑20s, this is acceptable; some exotic tokens could theoretically recover balances or behave oddly.
- Recommendation: Document this assumption in `CONTRACTS.md`. If targeting specific tokens that support `burn`, consider allowing an optional burn‑interface path.

4) Entry fee divisibility constraint depends on token decimals (Informational)
- Code: enforced across constructor and `_updateConfig()` (`contracts/TEMPL.sol:179-181`, `contracts/TEMPL.sol:560-563`)
- Impact: The “divisible by 10” check enforces round splits for integer math in smallest units. With non‑18‑decimals tokens, this policy is still safe but arbitrary.
- Recommendation: Current tests validate edge cases. Keep as is if intended; otherwise consider making the rule explicit in docs (e.g., designed for 18‑decimals tokens) or make the constraint configurable at deploy time.

5) View functions compute “UI‑facing” treasury as current accessToken minus pool (Informational)
- Code: `contracts/TEMPL.sol:786-796`, `contracts/TEMPL.sol:816-819`
- Impact: ETH and other ERC‑20 donations are not included in `treasury` output of `getTreasuryInfo()/getConfig()`. This is by design (only accessToken “treasury” is reported), but UIs should be aware.
- Recommendation: Document the meaning of “treasury” in both functions. Consider a separate view that enumerates balances of all tokens and ETH held by the contract.

6) Non‑critical centralization/immutability note (Informational)
- Code: `protocolFeeRecipient` is immutable (`contracts/TEMPL.sol:20`) and cannot be changed.
- Impact: If the recipient needs to rotate keys, a new deployment would be required.
- Recommendation: If operationally useful, expose a governance‑controlled way to update the fee recipient in a future version. Not a vulnerability.

## Test Review & Results

- Command executed: `npx hardhat test` — 132 passing tests locally.
- Notable coverage:
  - Reentrancy attempts via malicious token callbacks (purchase and claims) → correctly reverted due to `ReentrancyGuard`.
  - Treasury accounting across mixed scenarios (fees vs. donations, withdraw vs. withdrawAll) including preservation of member pool reserve and correct reduction of tracked `treasuryBalance`.
  - Voting rules (join time eligibility, proposer auto‑vote, vote flipping, ties fail, execution gating, min/max/default voting periods).
  - Governance wrappers (`onlyDAO`) validated via self‑call harness and typed proposal creation compatibility layer.
  - Pagination logic for active proposals.
  - Member pool distribution invariants and rounding behavior.

Overall, the test suite meaningfully exercises both the happy paths and adversarial edges.

## Invariants & Accounting Notes

- Member pool preservation: Withdrawals of the `accessToken` never deplete the portion reserved for the member pool (`memberPoolBalance`). Functions compute “available” as `balanceOf(this) - memberPoolBalance` and guard against underflow (`contracts/TEMPL.sol:503-507`, `contracts/TEMPL.sol:534-537`).
- Tracked treasury: `treasuryBalance` tracks fees from purchases. When withdrawing `accessToken`, it is reduced by `min(amount, treasuryBalance)`. Donations can be withdrawn even if they exceed tracked fees; the tracker falls to zero but member pool is preserved (`contracts/TEMPL.sol:509-513`, `contracts/TreasuryWithdrawAssets.test.js`).
- Member pool distribution: On each new member after the first, the 30% pool share plus any `memberRewardRemainder` is evenly allocated to existing members via `cumulativeMemberRewards`, with remainder rolled forward (`contracts/TEMPL.sol:212-219`). Claims are the delta between `cumulativeMemberRewards` and a member’s snapshot (`contracts/TEMPL.sol:594-602`), bounded by `memberPoolBalance - memberRewardRemainder` to ensure reserves for rounding (“dust”) (`contracts/TEMPL.sol:610-611`).
- Reentrancy: All external functions that move funds or mutate state in sensitive contexts are `nonReentrant` (`purchaseAccess`, `claimMemberPool`, `executeProposal`). Internal calls perform checks‑effects‑interactions; token transfers use SafeERC20.

## Line‑By‑Line Review (contracts/TEMPL.sol)

Top of file
- 1-2: SPDX and pragma 0.8.23 (automatic overflow checks active).
- 4-7: Imports OpenZeppelin IERC20, SafeERC20, ReentrancyGuard, and local error library.
- 9: Contract `TEMPL` inherits `ReentrancyGuard`.
- 10-11: Using directives, including the custom errors library for reverts.
- 13-17: Basis point constants for fee splits; dead address constant for burn.

Immutable addresses & config/state
- 19-25: Immutable `priest`, `protocolFeeRecipient`, `accessToken`; mutable `entryFee`, treasury/pool balances; `paused` flag.

Members and rewards
- 28-33: `Member` struct includes purchase flag, join timestamp and block, and `rewardSnapshot` for pool claims.
- 35-39: Mappings and counters for members, pool claims, cumulative rewards, and remainder.

Governance structures
- 41-60: `Proposal` struct stores metadata and typed action parameters; mappings track voter participation and choice.
- 62-68: Proposal indexing and voting period constraints.
- 70-76: Typed `Action` enum enumerates allowed governance actions (no arbitrary calls).

Accounting totals
- 78-82: Totals for audits/analytics: purchases, burned, to treasury/pool/protocol.

Events
- 84-137: Rich event set for purchases, claims, proposal changes, treasury actions, and config updates.

Modifiers
- 139-157: `onlyMember`, `onlyDAO` (contract‑only), `notSelf` (blocks DAO calling `purchaseAccess`), and `whenNotPaused`.

Constructor & ETH receiver
- 167-187: Constructor validates non‑zero addresses and fee constraints; sets immutables and initial state. Entry fee must be ≥10 and divisible by 10.
- 189-190: `receive()` accepts ETH donations directly.

Membership purchase
- 196-245: `purchaseAccess()` (nonReentrant, paused check, and `notSelf`).
  - 204: Extra balance pre‑check; SafeERC20 transfers will still revert if allowance is insufficient.
  - 206-211: Mark membership; record time/block; push into `memberList`; increment totalPurchases.
  - 212-219: For N>1 members: allocate the pool’s 30% share to existing members via `cumulativeMemberRewards`, rolling forward remainder.
  - 221-227: Update tracked balances and totals.
  - 229-233: SafeERC20 transfer pattern: burn (dead address) + contract + protocol recipient.
  - Emits `AccessPurchased` with amounts and metadata.

Base proposal creation
- 247-283: `_createBaseProposal()` validates title/description; enforces one active proposal per account (resets when previous ended or executed); applies min/max/default voting periods; auto‑votes yes for proposer; sets active flags; emits `ProposalCreated`.

Typed proposal creation
- 285-355: `createProposalSetPaused`, `createProposalUpdateConfig` (validates new fee if provided), `createProposalWithdrawTreasury`, `createProposalWithdrawAllTreasury`, `createProposalDisbandTreasury`.

Voting
- 363-394: `vote()` (onlyMember). Validates proposal, voting window, and join‑time eligibility (`>=` comparison; see Finding 1). Supports vote flipping with proper tallies; emits `VoteCast`.

Execution
- 401-433: `executeProposal()` (nonReentrant). Validates voting finished, not already executed, and yes>no. Marks executed, clears active flag for proposer, dispatches to the typed internal implementation, emits `ProposalExecuted`.

DAO‑only wrappers
- 443-465: `withdrawTreasuryDAO()` / `withdrawAllTreasuryDAO()` — external `onlyDAO` wrappers around internal implementations.
- 474-489: `updateConfigDAO()` / `setPausedDAO()` / `disbandTreasuryDAO()` similarly gate governance changes.

Internal implementations
- 492-523: `_withdrawTreasury()` handles three cases:
  - accessToken: compute available = current bal − memberPoolBalance; ensure sufficient; reduce tracked `treasuryBalance` by `min(amount, treasuryBalance)`; transfer out.
  - ETH: check balance, transfer via `.call`, revert on failure.
  - other ERC‑20: ensure balance, SafeERC20 transfer.
  - Emits `TreasuryAction`.
- 525-555: `_withdrawAllTreasury()` mirrors above but withdraws the full available for the chosen asset; for accessToken it preserves the pool reserve and reduces `treasuryBalance` by the portion covered by fees; emits `TreasuryAction`.
- 557-565: `_updateConfig()` — token change disabled after deploy; updates entry fee if >0 with same divisibility/min checks; emits `ConfigUpdated`.
- 567-570: `_setPaused()` — toggles pause; emits `ContractPaused`.
- 572-587: `_disbandTreasury()` — moves entire tracked `treasuryBalance` to the member pool, evenly allocates via `cumulativeMemberRewards` with remainder; ensures non‑zero treasury and at least one member; emits `TreasuryDisbanded`.

Pool accounting & claims
- 594-602: `getClaimablePoolAmount()` — returns delta of accrual vs. snapshot if member.
- 607-620: `claimMemberPool()` (nonReentrant) — validates non‑zero claimable and pool has enough distributable (excludes `memberRewardRemainder`), updates snapshot/claims/pool balance, transfers tokens, and emits `MemberPoolClaimed`.

Views & helpers
- 634-657: `getProposal()` — full proposal data; computes `passed` as `time>=end && yes>no`.
- 667-672: `hasVoted()` — returns vote status for `_voter`.
- 679-695: `getActiveProposals()` — unpaginated; see Findings.
- 704-742: `getActiveProposalsPaginated()` — efficient paginated query with `limit` guard.
- 749-751: `hasAccess()` — simple membership status.
- 760-767: `getPurchaseDetails()` — returns purchase metadata.
- 778-797: `getTreasuryInfo()` — “UI‑facing” treasury equals current accessToken minus member pool; returns totals and protocol recipient.
- 808-819: `getConfig()` — returns core config and “UI‑facing” treasury/pool metrics.
- 825-827: `getMemberCount()` — returns `memberList.length`.
- 834-839: `getVoteWeight()` — 1 for members, 0 for non‑members.

## Additional Observations

- Governance hardening: The typed action model plus `onlyDAO` wrappers effectively remove arbitrary `delegatecall/call` risk that is common in generic governance executors.
- Reentrancy: Non‑reentrancy on external entry points, plus use of SafeERC20 and effects‑then‑interactions pattern, provides solid protection. Tests demonstrate reentrancy attempts fail as expected.
- Storage growth: `memberList` grows monotonically. This is acceptable given it is only used for counts and distribution math; there are no iteration‑heavy on‑chain loops over `memberList`.
- Time checks: Using `block.timestamp` is standard; note miners can skew within seconds. For governance windows on the order of days, this is acceptable.

## Recommendations (Non‑Blocking)

- Voting equality nuance: Consider allowing same‑timestamp joiners to vote by changing `>=` to `>` (see Finding 1) if this matches product intent.
- Treasury introspection: Optionally add a view that reports balances for ETH and arbitrary ERC‑20s held by the contract for richer UI/ops visibility.
- Document token assumptions: Clarify behavior around burning by dead address and the entry fee divisibility rule in `CONTRACTS.md`.
- Consider event indexing: Current events are sufficiently indexed for typical analytics. If UIs need reverse lookups by recipient or token, additional indexes can be added.

## Tests & Tooling

- Compiler: Solidity 0.8.23, viaIR enabled, optimizer runs=200 (good defaults).
- Tests: Run with Hardhat; comprehensive unit tests present in `test/` with mocks for reentrancy and DAO harness. All tests passed locally (132 passing).
- Static analysis: Slither config is present; consider integrating it in CI. No critical anti‑patterns were apparent during manual review.

## Conclusion

The TEMPL contract is well‑structured with a strong security posture, clear accounting invariants, and comprehensive tests. No critical or high‑severity issues were identified. The minor issues and recommendations above are non‑blocking and focus on UX clarity and further hardening/documentation.

