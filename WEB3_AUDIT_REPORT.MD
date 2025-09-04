# TEMPL Smart Contracts Audit Report

## Overview
- **Repository:** templ
- **Scope:** `contracts/TEMPL.sol`, `contracts/mocks/TestToken.sol`
- **Tools Used:** Hardhat tests, Slither static analysis

## Summary
The contracts implement a DAO-governed membership system with treasury management. Tests and static analysis were executed on the unmodified contracts and all tests passed. Slither reported informational findings around timestamp usage, low-level calls, and naming conventions. No critical vulnerabilities were identified in automated analysis; manual review found areas for improvement described below.

### Medium
1. **Treasury withdrawals depend solely on DAO access control** – `withdrawTreasuryDAO` and `withdrawAllTreasuryDAO` transfer treasury funds via proposals; access is constrained by the allowlist. Reentrancy protection is applied to proposal execution (and is also used on purchase and claims, see below).

2. **Timestamp-based logic** – Voting windows and proposal timing rely on `block.timestamp`, which can be slightly manipulated by miners.

### Low
1. **Member pool distributable math** – `claimMemberPool` computes `distributable = memberPoolBalance - memberRewardRemainder` and reverts if `distributable < claimable` (checked arithmetic). The invariant holds under normal flows and is covered by tests; keep it documented and guarded by tests when modifying distribution logic.

### Informational
- Entry fee distribution logic divides payments among burn address, treasury, member pool, and protocol fee recipient.
- Configuration updates require zero treasury and member pool balances before changing the payment token.
- The `priest` address has elevated voting weight until membership exceeds a threshold.

## Detailed Review

### Scope and Architecture
- Files reviewed: `contracts/TEMPL.sol`, `contracts/mocks/TestToken.sol`.
- Solidity 0.8.23 with OZ `IERC20` and `SafeERC20`.
- Non-upgradeable, constructor parameters set immutables for `priest`, `protocolFeeRecipient`, vote weights, and thresholds; `accessToken` and `entryFee` are mutable via DAO proposal with safety checks.

### Governance Surface
- Proposal creation restricts `callData` to an allowlist at two layers:
  - At creation: `createProposal` extracts the selector and reverts unless it matches one of `{setPausedDAO, updateConfigDAO, withdrawTreasuryDAO, withdrawAllTreasuryDAO, sweepMemberRewardRemainderDAO}`.
  - At execution: `_executeCall` enforces the same allowlist prior to a `call` to `address(this)`.
- Single active proposal per member enforced; executed/expired proposals clear the active flag.
- Voting rules:
  - One member-one vote; `priest` weight is `priestVoteWeight` while `members.length < priestWeightThreshold`; otherwise weight is 1.
  - Anti-gaming rule: voter must have joined before `proposal.createdAt`.
  - Simple majority `yesVotes > noVotes` required; anyone may execute after `endTime`.

### Treasury and Pool Flows
- `purchaseAccess()` transfers: 30% burn (dead address), 30% treasury (contract balance), 30% member pool (contract balance), 10% protocol (external). Uses `safeTransferFrom` 4 times (burn + 3 transfers) and records accounting totals.
- Member pool distribution:
  - On each new member (except the very first), `cumulativeMemberRewards` increases by `30% / (members.length - 1)`, with integer remainder carried in `memberRewardRemainder`.
  - Each member has `memberRewardSnapshot`; `claimMemberPool()` pays `accrued - snapshot` and updates snapshot.
  - DAO can sweep remaining pool to a recipient via `sweepMemberRewardRemainderDAO`.

### Reentrancy and State Integrity
- Custom `nonReentrant` guard with status word applied to `purchaseAccess`, `executeProposal`, and `claimMemberPool` (state-changing flows with token transfers). A dedicated `ReentrantToken` test confirms guard efficacy.
- `executingProposalId` is set/cleared around `_executeCall` to bind treasury events (`TreasuryAction`) to the active proposal id.
- Config updates (`updateConfigDAO`) prevent token changes when treasury or pool balances are non-zero, reducing risk of stranded funds.

### Edge Cases and View Functions
- Voting period constraints are enforced (min=7 days, max=30 days; default=7 days).
- `getActiveProposals()` and paginated `getActiveProposalsPaginated()` are read helpers; the former is O(n) across `proposalCount` and may become gas-heavy on-chain (acceptable for off-chain calls, but should be used cautiously from other contracts).
- Comprehensive views (`getProposal`, `getTreasuryInfo`, `getConfig`, etc.) support client queries without exposing additional attack surface.

### Additional Observations
- The DAO cannot reduce `entryFee` below 10 or break the 30/30/30/10 split (must be divisible by 10).
- Self-call protections:
  - `notSelf` prevents the contract from invoking `purchaseAccess()` on itself.
  - `onlyDAO` gate restricts sensitive methods to proposal execution context.
- Events are consistently emitted for purchase, votes, executions, treasury actions, config updates, and member claims, supporting indexers.

## Recommendations
- Keep the allowlist in `createProposal` and `_executeCall` in sync if expanded in future; add unit tests that diff both sets.
- Consider emitting an event for `setPausedDAO` to aid off-chain automation (already emits `ContractPaused`).
- If expected membership grows large, prefer paginated reads in clients; avoid calling `getActiveProposals()` from other contracts.
- Consider storing `members.length` in a cached variable if used extensively to save gas in hot paths (micro-optimization).
