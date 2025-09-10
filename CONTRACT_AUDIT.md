TEMPL Smart Contract Audit

Date: 2025-09-10
Audited by: Codex CLI Assistant

Scope
- Contracts: `contracts/TEMPL.sol`, `contracts/TemplErrors.sol`
- Mocks used for tests: `contracts/mocks/*.sol` (read for test context only)
- Tests: all files under `test/`

Methodology
- Manual, line-by-line review of `contracts/TEMPL.sol` and auxiliary errors library.
- Review of the complete Hardhat test-suite to understand intended invariants and assess coverage.
- Attempted static analysis with Slither using provided config. Slither compilation failed under direct Solc invocation due to a “Stack too deep” error when compiling the single file outside Hardhat (suggest enabling `viaIR` when running Slither separately). All tests were executed locally via `npm test` and passed (132 tests).

System Overview
TEMPL is a DAO-governed membership contract where users pay an ERC‑20 `accessToken` `entryFee` to join. Each purchase distributes:
- 30%: burned to a dead address
- 30%: added to DAO treasury (`treasuryBalance`)
- 30%: added to a member reward pool (`memberPoolBalance`) and virtually accrued to existing members using a snapshot mechanism
- 10%: protocol fee sent to `protocolFeeRecipient`

Members have 1 vote each. Proposals are “typed” (no arbitrary calldata) and mapped via an enum to internal actions:
- Set pause flag
- Update config (only fee; token changes disabled)
- Withdraw (part or all) of treasury assets (ERC‑20 or ETH)
- Disband treasury: move entire treasury to the member pool and split equally via the snapshot system

Key Invariants and Assumptions
- Access token is a standard, non-rebasing, non-fee-on-transfer ERC‑20 (OpenZeppelin-compatible semantics). Using deflationary/rebasing tokens can break accounting.
- `accessToken` is immutable once set at construction time; governance cannot change it.
- All token transfers rely on OZ `SafeERC20` wrappers.
- Reentrancy is blocked on state-changing functions that transfer tokens.

Summary of Findings
- No critical or high-severity issues found in the intended threat model (typed governance; no arbitrary execution).
- M‑1 fixed in code and covered by tests; M‑2 remains a design caveat.
- L‑2, L‑3, L‑4 fixed in code (removal of unused fields, invalid action revert, optimized active proposals).
- Several low/informational observations and gas notes.
- Test coverage is broad and exercises the core flows, edge cases, reentrancy protections, and accessToken donations.

Severity Definitions
- Critical: Loss of funds or permanent system compromise under expected assumptions.
- High: Fund impact or control loss requiring uncommon preconditions.
- Medium: Meaningful risk under plausible conditions or foot-guns that can lock funds.
- Low: Edge-case misbehavior, missing checks, or DoS with limited impact.
- Info: Clarity/maintainability/test coverage/gas optimizations.


Findings

[M‑1] AccessToken donations could become stranded (Resolved)
- Resolution: For the `accessToken`, withdrawals now operate on `available = balanceOf(this) - memberPoolBalance` so donations are withdrawable while the member pool is always preserved. The legacy `treasuryBalance` tracker is reduced only for the portion covered by fee-sourced funds (never below zero).
- UI: `getTreasuryInfo()` and `getConfig()` now report `treasury` as `max(balanceOf(this) - memberPoolBalance, 0)`, ensuring donations appear in UI.
- Tests: Added two cases covering partial and full withdrawals of donated accessToken while keeping `memberPoolBalance` intact.

[M‑2] Incompatibility with fee-on-transfer/rebasing tokens can break accounting
- Location: `contracts/TEMPL.sol:198`–`248`
- Description: The contract assumes standard ERC‑20 semantics. If the access token charges a transfer fee or rebases, the three `safeTransferFrom` calls may deliver fewer/more tokens than expected without reverting, breaking invariants (e.g., `treasuryBalance + memberPoolBalance` exceeding the real token balance).
- Impact: Medium — incorrect internal balances; later claims/withdraws can revert or underflow if the physical balance is smaller than tracked balances.
- Recommendation: Enforce standard token behavior by either documenting the requirement (strongly) or adding pre/post balance checks in `purchaseAccess()` to assert exact amounts are received/burned. If discrepancies are detected, revert to protect invariants.

[L‑1] Voting eligibility equality semantics may exclude “same-second” joiners
- Location: `contracts/TEMPL.sol:371`–`373`
- Description: The check `members[msg.sender].timestamp >= proposal.createdAt` rejects voters whose `timestamp == createdAt`. If proposals and joins occur within the same second, a legitimate pre-proposal joiner in the same block/second may be unable to vote.
- Impact: Low — edge-case mismatch between intent and implementation; tests note the scenario but do not enforce equality behavior.
- Recommendation: If intended to allow “same-second” joiners, change to `>` instead of `>=`. Otherwise, update docs/tests to explicitly state equal timestamps are ineligible.

[L‑2] Unused fields: `eligibleVoters`, `memberIndex` (Resolved)
- Change: Removed `eligibleVoters` from the `Proposal` struct and the `memberIndex` mapping; also removed the associated writes. These were unused and only added surface/ABI bloat via the public getter of `proposals`.
- Impact: Low — no behavior change. Public getter for `proposals` returns a shorter tuple; named fields still accessible for those used in tests/UI.

[L‑3] Executing with an invalid `action` becomes a no-op (Resolved)
- Change: Added an explicit `else revert TemplErrors.InvalidCallData()` branch in `executeProposal` to assert type safety if an unmapped enum is ever forced (e.g., via a harness).
- Impact: Low — improves defensive programming with no functional change under normal usage.

[L‑4] `getActiveProposals()` iterates all proposals twice (Resolved)
- Change: Replaced with a single-pass approach using a temporary array and a final copy sized to `count`.
- Impact: Low — marginal view-time optimization; aligns with the paginated approach.

[Info‑1] Governance can move any asset; pause only affects purchases
- Location: Multiple; pause gating at `contracts/TEMPL.sol:198`
- Note: `setPausedDAO` does not block governance or claiming (intended). Call out explicitly in docs to avoid confusion.

[Info‑2] Reentrancy coverage is solid
- Locations:
  - `purchaseAccess()` and `claimMemberPool()` guarded with `nonReentrant`.
  - `executeProposal()` is `nonReentrant`; underlying transfers in withdraw/disband paths cannot reenter governance flow.
- Tests confirm reentrancy protection using a purpose-built reentrant token.

[Info‑3] Token change disabled in governance
- Location: `contracts/TEMPL.sol:545`–`552`
- Note: Deliberate safety constraint; documented by custom error. Good pattern.

[Info‑4] Arithmetic safety and rounding
- Solidity ^0.8.23; division rounding is consistently handled via `memberRewardRemainder`. The snapshot pattern prevents double-claiming and accounts for indivisible “dust”. Tests exercise distribution and rounding thoroughly.

[Gas] Minor opportunities (non-functional)
- Use `unchecked { ++i; }` in tight internal loops (view functions) where overflow is impossible.
- Cache storage reads in views when looping (e.g., `proposalCount` and `proposals[i]`).
- Consider consolidating the two loops in `getActiveProposals()` into one with a temporary dynamic array and a final copy (already used in paginated).


Test Suite Assessment
- Command run: `npm test` — 130 tests passing locally.
- Coverage highlights:
  - Happy-path and revert-path testing for purchases, voting, proposal creation, execution, and pausing.
  - Treasury withdrawals for ETH and arbitrary ERC‑20 (including `withdrawAll`) and their revert conditions.
  - Member pool distribution, rounding edge-cases, claim accounting, and pool balance integrity.
  - Reentrancy tests for both `purchaseAccess` and `claimMemberPool` using a malicious ERC‑20.
  - Governance wrappers (`onlyDAO`) are covered via a harness.
  - Pagination and active proposal filtering tested under multiple scenarios.
- Note: There is no direct test for “donation of `accessToken`” (Finding M‑1). Consider adding coverage to capture and validate the proposed behavior fix.


Line-by-Line Notes (contracts/TEMPL.sol)
The notes below traverse the file top-to-bottom, focusing on correctness, safety, and intent. Trivial syntactic lines (e.g., braces) are omitted.

- contracts/TEMPL.sol:1 — SPDX identifier present (MIT). Good.
- contracts/TEMPL.sol:2 — `pragma ^0.8.23`; uses built-in overflow checks. Good.
- contracts/TEMPL.sol:4–6 — Imports OZ `IERC20`, `SafeERC20`, and `ReentrancyGuard`. Good choices.
- contracts/TEMPL.sol:7 — Imports shared custom errors library `TemplErrors`.
- contracts/TEMPL.sol:9 — `TEMPL` extends `ReentrancyGuard`.
- contracts/TEMPL.sol:10–11 — `using SafeERC20` and `using TemplErrors`.
- contracts/TEMPL.sol:13–16 — Split constants: 30/30/30/10. Fixed percentages; not configurable (simplifies audits and removes governance risk of fee changes to allocations).
- contracts/TEMPL.sol:17 — `DEAD_ADDRESS` set to 0x...dEaD (widely used burn sink). Many tokens consider it irrecoverable. OK.
- contracts/TEMPL.sol:19–25 — Immutable roles (`priest`, `protocolFeeRecipient`, `accessToken`), mutable `entryFee`, and accounting state (`treasuryBalance`, `memberPoolBalance`, `paused`). Straightforward.
- contracts/TEMPL.sol:28–33 — `Member` struct: purchase flag, timestamps, and `rewardSnapshot` (snapshot pattern used for pool accrual). Sound approach.
- contracts/TEMPL.sol:35–41 — Member accounting: `members`, `memberList`, `memberIndex` (unused), `memberPoolClaims`, `cumulativeMemberRewards`, `memberRewardRemainder`. Remainder mechanism prevents truncation loss.
- contracts/TEMPL.sol:42–62 — `Proposal` struct: metadata, typed action parameters, vote tallies, timings, and nested mappings for votes. Clean separation; avoids arbitrary `call`.
- contracts/TEMPL.sol:64–71 — Proposal registry, single-active tracking per proposer, voting period bounds. Reasonable defaults: min=7 days (same as default), max=30 days.
- contracts/TEMPL.sol:72–78 — Enum of allowable actions (typed governance). Prevents arbitrary execution. Good.
- contracts/TEMPL.sol:80–85 — Totals for auditability (burned/treasury/pool/protocol). Useful for invariants.
- contracts/TEMPL.sol:86–139 — Events are comprehensive and indexed appropriately.
- contracts/TEMPL.sol:141–159 — Modifiers:
  - `onlyMember`: guards member-only endpoints.
  - `onlyDAO`: restricts to `address(this)`; used for governance wrappers.
  - `notSelf`: prevents the DAO calling `purchaseAccess`.
  - `whenNotPaused`: restricts membership purchases only.
- contracts/TEMPL.sol:169–189 — Constructor validations: non-zero addresses, non-zero and constrained fee (>=10 and %10==0). Sets immutables and initial state. Good.
- contracts/TEMPL.sol:191–192 — `receive()` allows ETH donations (no fallback). OK.
- contracts/TEMPL.sol:198–248 — `purchaseAccess()`:
  - Guards: `whenNotPaused`, `notSelf`, `nonReentrant`.
  - Checks: already purchased; `balanceOf` >= `entryFee`.
  - Accounting updates: mark purchase, timestamps, membership index/list, increment `totalPurchases`.
  - Pool accrual: if >1 member, compute `(30% of fee + previous remainder)` split across previous members; update `cumulativeMemberRewards` and carry forward remainder.
  - Snapshot: new member’s `rewardSnapshot` set after accrual, preventing retroactive reward claim.
  - Update aggregates and balances; compute `thirtyPercent` once; update totals.
  - Transfers (OZ SafeERC20): burn 30% to dead address; send 60% to contract; send 10% to protocol.
  - Emits `AccessPurchased` with detailed meta.
  - Notes:
    - Assumes non-deflationary ERC‑20 (Finding M‑2).
    - If transfer fee is charged, internal balances will be wrong.
- contracts/TEMPL.sol:250–287 — `_createBaseProposal()`:
  - Validates title/description; enforces single-active-proposal per proposer, clearing stale trackers if expired/executed.
  - Voting period clamped to [MIN, MAX] with default of 7 days.
  - Initializes proposal, auto-YES votes for proposer, sets `eligibleVoters` snapshot (not used elsewhere), and marks active.
  - Emits `ProposalCreated`.
- contracts/TEMPL.sol:289–359 — Typed proposal creators; each sets the `action` and stores parameters. Fee validation for update path keeps constraints at creation time.
- contracts/TEMPL.sol:361–398 — `vote()`:
  - Guards: `onlyMember`; checks proposal exists and `block.timestamp < endTime`.
  - Eligibility: rejects voters with `members[msg.sender].timestamp >= createdAt` (see Finding L‑1 for equality semantics).
  - Handles first vote vs. change-of-vote correctly, adjusting tallies idempotently.
  - Emits `VoteCast`.
- contracts/TEMPL.sol:405–435 — `executeProposal()`:
  - Guard: proposal exists, voting period ended, not executed, and simple majority (`yes > no`).
  - Clears active-proposal tracker for proposer.
  - Dispatches to internal implementation based on `action` (no arbitrary call).
  - Emits `ProposalExecuted`.
  - Note: Unmapped `action` becomes a no-op (Finding L‑3; unreachable in practice).
- contracts/TEMPL.sol:438–467 — External governance-only wrappers (`onlyDAO`) for withdrawing assets and updating config; these delegate to internal functions.
- contracts/TEMPL.sol:493–517 — `_withdrawTreasury()` (internal):
  - Validates non-zero recipient and non-zero amount.
  - For the `accessToken`, caps by `available = balanceOf(this) - memberPoolBalance`; reduces legacy `treasuryBalance` by the fee-covered portion (clamped). Transfers via `safeTransfer`.
  - For ETH, uses `.call{value: amount}("")` and reverts on failure.
  - For other ERC‑20s, caps by full token balance and transfers.
  - Emits `TreasuryAction`.
- contracts/TEMPL.sol:519–543 — `_withdrawAllTreasury()`:
  - `accessToken`: withdraws all `available = balanceOf(this) - memberPoolBalance`; reduces legacy `treasuryBalance` by the fee-covered portion.
  - ETH/other ERC‑20s: moves full address balance and reverts when zero.
  - Emits `TreasuryAction`.
- contracts/TEMPL.sol:545–553 — `_updateConfig()`: token change disabled; validates fees when non-zero and emits `ConfigUpdated`.
- contracts/TEMPL.sol:555–558 — `_setPaused()` with event.
- contracts/TEMPL.sol:560–575 — `_disbandTreasury()`:
  - Moves entire `treasuryBalance` to `memberPoolBalance` and zeroes treasury.
  - Splits equally: updates `cumulativeMemberRewards` by `treasury / n`, carries `remainder` into `memberRewardRemainder`.
  - Emits `TreasuryDisbanded`.
- contracts/TEMPL.sol:582–590 — `getClaimablePoolAmount()`: returns `cumulative - snapshot` for members; 0 for non-members.
- contracts/TEMPL.sol:595–608 — `claimMemberPool()`:
  - Guards: `onlyMember`, `nonReentrant`.
  - Computes `claimable`; requires `claimable > 0` and that `memberPoolBalance - memberRewardRemainder >= claimable`.
  - Advances snapshot, accrues to `memberPoolClaims`, reduces `memberPoolBalance`, and transfers tokens.
  - Emits `MemberPoolClaimed`.
  - Note: The check ensures reserved remainder is never paid out.
  
  - UI getters: `getTreasuryInfo()`/`getConfig()` now compute treasury as `balanceOf(this) - memberPoolBalance` (never negative), so donations are reflected.
- contracts/TEMPL.sol:622–646 — `getProposal()` view: returns a consolidated view plus a computed `passed` flag.
- contracts/TEMPL.sol:655–660 — `hasVoted()` view.
- contracts/TEMPL.sol:667–685 — `getActiveProposals()` view optimized to a single pass (L‑4 resolved).
- contracts/TEMPL.sol:694–732 — `getActiveProposalsPaginated()` view: more gas-efficient; enforces `1..100` `limit` and returns `hasMore`.
- contracts/TEMPL.sol:739–824 — Read-only helpers for membership, treasury info, config, member count, and voting weight (uniform 1 per member).


TemplErrors Review (contracts/TemplErrors.sol)
- Custom errors are clearly named and comprehensive. Several are legacy to older designs (e.g., `CallDataRequired`, `CallDataTooShort`, `InvalidCallData`) but harmless to retain.
- Good separation as a library to allow `using TemplErrors for *;` and avoid namespace clashes.


Recommendations Summary
1) Done: AccessToken donation handling (M‑1) fixed with available-balance calculation and UI getters updated; tests added.
2) Enforce standard token behavior in `purchaseAccess()` (M‑2) or document/guard against deflationary/rebasing tokens via balance-delta assertions.
3) Decide and document the intended equality semantics for voting eligibility (L‑1); optionally update the comparison.
4) Consider removing/documenting unused fields (`eligibleVoters`, `memberIndex`) (L‑2).
5) Optionally assert a default case in `executeProposal()` (L‑3) for future-proofing.
6) Prefer `getActiveProposalsPaginated()` in UIs; keep `getActiveProposals()` for small counts/testing (L‑4).


Appendix: Static Analysis
- `npm run slither` (project script) attempted to run Slither directly on `contracts/TEMPL.sol`. Compilation failed with Solc “Stack too deep” under single-file direct invocation.
- Suggest configuring Slither to use Hardhat’s compile artifacts or enabling the compiler `viaIR` path with optimizer when running Slither outside Hardhat.


Appendix: Test Results Snapshot
- Local run: `npm test` — 132 passing tests.
- Notable suites: reentrancy, treasury withdrawals (ERC‑20/ETH and reverts), pool distribution and rounding, governance wrappers, pagination, eligibility rules, pause behavior, invariants, plus accessToken donation withdrawals while preserving the member pool and dynamic UI treasury computation.

Final Assessment
The contract set presents a solid, typed-governance design with a clear fee split, robust reentrancy protection, and strong test coverage. The two medium risks identified are straightforward to mitigate with small, well-scoped changes. With those addressed and explicit documentation of token assumptions, the contract is well-positioned for deployment.
