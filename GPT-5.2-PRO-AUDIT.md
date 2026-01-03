# TEMPL Smart Contract Security Audit

**Repository:** `code/` (provided as `code.zip`)

**Audit date:** 2026-01-01

## Executive summary

This review covers the **core on-chain contracts** of the TEMPL system. The architecture is a router contract (`TEMPL`) that delegates functionality to stateless module contracts via `delegatecall` (a “diamond-like” pattern). Membership, governance, treasury, and council logic all share the same storage layout via `TemplBase`.

Overall, the codebase shows strong security awareness (e.g., `onlyDelegatecall` guards, careful proposal lifecycle logic, explicit quorum/threshold checks, and consistent use of OpenZeppelin utilities). **No obvious direct, permissionless fund-drain bugs were identified** in the happy-path logic.

However, one issue is particularly important:

- **High severity:** the external-reward checkpoint mechanism cannot safely handle **join and external-treasury disband happening in the same block**. This can **permanently lock** a large share of external reward tokens (including ETH) inside the contract, due to an unavoidable intra-block ordering ambiguity in the current snapshot design.

The other findings are primarily governance consistency, deployment hardening, and operational/liveness concerns.

### Findings summary

| Severity | Count |
|---|---:|
| High | 1 |
| Medium | 1 |
| Low | 3 |
| Informational | 2 |

## Scope

### In-scope (core contracts)

- `contracts/TEMPL.sol`
- `contracts/TemplBase.sol`
- `contracts/TemplMembership.sol`
- `contracts/TemplGovernance.sol`
- `contracts/TemplTreasury.sol`
- `contracts/TemplCouncil.sol`
- `contracts/TemplFactory.sol`
- `contracts/TemplDeployer.sol`
- `contracts/TemplCurve.sol`
- `contracts/TemplDefaults.sol`
- `contracts/TemplErrors.sol`
- `contracts/tools/BatchExecutor.sol` (reviewed as ancillary utility)

### Out-of-scope

- Mocks, test harnesses, Echidna/scaffold contracts (`contracts/mocks`, `contracts/echidna`) and off-chain tooling.

## Methodology

- Manual, line-by-line review of Solidity source with a focus on:
  - Access control & privilege boundaries
  - Reentrancy and external call surfaces
  - Arithmetic correctness (especially fee splits, reward accounting, and curve math)
  - Governance lifecycle, quorum/threshold semantics, snapshotting, and liveness
  - Upgrade/module-routing safety
  - Token-handling assumptions (ERC20 edge cases)

> Note: Automated test execution and third-party static analysis tools were not run in this environment.

## System overview

### High-level architecture

- **`TEMPL`** is the canonical contract users interact with.
  - It maintains a mapping of `selector => module address`.
  - Its `fallback()` delegates calls to the configured module.
  - `setRoutingModuleDAO()` allows governance (or dictator-priest) to update routing.

- **Modules** (`TemplMembershipModule`, `TemplGovernanceModule`, `TemplTreasuryModule`, `TemplCouncilModule`) are intended to be stateless and are protected by an `onlyDelegatecall` sentinel to prevent calling state-mutating functions on the module implementations directly.

- **`TemplBase`** defines all shared storage and the core internal logic.

- **`TemplFactory` + `TemplDeployer`** deploy new templates.

### Roles and permissions

- **Member:** address that joined. Members can create proposals (subject to fee and one-active-proposal rule).
- **Council member:** subset of members. When `councilModeEnabled`, only council members may vote.
- **Priest:** special member set at deployment; may have special privileges depending on `priestIsDictator`.
- **DAO:** represented as `address(this)`; `onlyDAO` functions can be called via self-call (typically through proposal execution), and additionally by the priest while in dictatorship.

### Key trust assumptions

- The **access token must be “vanilla” ERC20** (no transfer fee/rebasing/callback semantics). Violating this assumption can break accounting and lock funds.
- Governance is powerful by design: proposals can withdraw funds and perform arbitrary external calls.
- Module routing upgrades must preserve storage layout.

---

## Findings

### H-01: External reward checkpointing can permanently lock funds due to intra-block join/disband ambiguity

**Severity: High**

#### Where

- `TemplBase._recordExternalCheckpoint()`
- `TemplBase._externalBaselineForMember()`
- `TemplMembershipModule._join()` (stores `Member.blockNumber`/`Member.timestamp`)
- `TemplBase._disbandTreasury()` for non-access-token assets (records checkpoints)

#### Description

External rewards use a checkpointing approach to avoid storing per-member snapshots for every external token at join-time.

- When an external token is disbanded, the system increments `externalRewards[token].cumulativeRewards` and writes an `ExternalRewardCheckpoint` containing:
  - `blockNumber = block.number`
  - `timestamp = block.timestamp`
  - `cumulative = cumulativeRewards`

- When a member claims, the contract computes a baseline using the member’s recorded join `blockNumber`/`timestamp` and finds the latest checkpoint “at or before” that join.

The problem: **block.timestamp is constant within a block**, and `block.number` is obviously constant within a block. Therefore, **joins and checkpoints created in the same block are not orderable on-chain**.

The current comparison logic treats `checkpoint.blockNumber == member.blockNumber` **and** `checkpoint.timestamp == member.timestamp` as **checkpoint <= join**.

This causes a critical edge case:

1. A member joins in block **N** (member stores `blockNumber=N` and `timestamp=T`).
2. Later in the *same block N* (after the join tx), someone executes an external-token treasury disband, which records a checkpoint with the same `(blockNumber=N, timestamp=T)`.
3. When the joining member later claims, the baseline search will treat that checkpoint as “before join”, setting the baseline to the *post-disband cumulative*.

This **incorrectly excludes** the joiner from claiming the disband distribution **even though** the disband’s `perMember = toSplit / memberCount` calculation *included* them (because they were already a member when the disband executed).

#### Impact

- The joiner’s `perMember` share becomes **unclaimable**.
- The unclaimable amount remains inside `externalRewards[token].poolBalance`.
- `poolBalance` is treated as **reserved for members**:
  - It cannot be withdrawn via `_withdrawTreasury()`.
  - It is **not** part of `rewardRemainder` and therefore cannot be swept by `_sweepExternalRewardRemainder()`.
  - It prevents cleanup (`cleanupExternalRewardToken`) because `poolBalance != 0`.

This can lock a **large fraction** of an external token disband. For example, with 3 members and a large disband, excluding one member locks ~⅓ of the distribution permanently.

#### Exploit / reproduction sketch

This is easiest to reproduce with **any external token** (including ETH):

- Have a proposal that is ready to execute `DisbandTreasury(token)`.
- Submit a `join()` tx and an `executeProposal(disband)` tx such that both land in the same block with ordering:
  - `join()` first
  - `executeProposal(disband)` second

The joining address will be included in `memberCount` used by the disband, but will later be unable to claim its share.

This can happen accidentally (normal mempool ordering) or intentionally (bundling/MEV ordering).

#### Recommendation

A robust fix requires an ordering signal that can disambiguate **intra-block** ordering.

Recommended options:

1. **Introduce a monotonic “event sequence”** incremented on both joins and external-reward checkpoint writes.
   - Store `member.joinEventSeq` at join.
   - Store `checkpoint.eventSeq` at each external reward checkpoint.
   - Baseline selection uses `eventSeq`, not `(blockNumber, timestamp)`.

2. **Enforce a one-block separation rule** between joins and external-token disbands.
   - Track `lastJoinBlock` and require `block.number > lastJoinBlock` in `_disbandTreasury()` for external tokens (and/or pause joins for at least one block).
   - This does not solve *all* ordering issues, but it prevents the catastrophic “join before disband in same block” case.

3. If you cannot change storage layout, document a strict operational rule:
   - **Pause joins before disbanding external rewards**, execute disband, then unpause.
   - This is a mitigation, not a fix.

---

### M-01: Council mode and council membership changes can alter vote eligibility during an active proposal

**Severity: Medium**

#### Where

- `TemplGovernanceModule.vote()` checks `councilModeEnabled` and `councilMembers[msg.sender]` at vote time.
- Proposal snapshots capture voter counts (`eligibleVoters`, `postQuorumEligibleVoters`) but do **not** snapshot the voting *regime*.

#### Description

The proposal system snapshots:

- `eligibleVoters` at proposal creation, based on `_eligibleVoterCount()` (members vs council count).
- `postQuorumEligibleVoters` and `quorumJoinSequence` at quorum.

However, **vote eligibility** is decided by the **current** value of:

- `councilModeEnabled`
- `councilMembers[msg.sender]`

This means that while a proposal is active, another proposal could:

- Toggle council mode, or
- Add/remove council members,

and immediately change who can vote on the still-active proposal.

#### Impact

- Governance outcomes can become inconsistent and surprising:
  - A proposal created under member voting can suddenly become council-only mid-vote.
  - A proposal can become much harder (or impossible) to reach quorum if council mode is enabled mid-flight.
  - Conversely, disabling council mode mid-flight can open voting to all members.
- This can be used for governance manipulation (by coordinating multiple proposals) or can create liveness failures.

#### Recommendation

- Snapshot the *voting regime* for each proposal at creation (or at least at quorum):
  - Store `proposal.votingMode` (member vs council) and enforce eligibility against that.
  - If council mode, snapshot a council membership “epoch” or disallow council membership mutations during active proposals.

Alternative: disallow council mode toggles and council membership changes when `activeProposalIds` contains any active proposal.

---

### L-01: Vanilla-token safety checks are optional at deployment; incompatible access tokens can break accounting

**Severity: Low** (can become **High** operationally if users assume factory deployments are always safe)

#### Where

- `TemplFactory.safeDeployFor()` performs `_probeVanillaToken(token)`.
- Other factory deployment paths (e.g. `createTempl`, `createTemplFor`, `createTemplWithConfig`, `createTemplForWithConfig`) do **not**.

#### Description

Many invariants assume `accessToken` transfers are exact:

- `memberPoolBalance` and `treasuryBalance` are increased by computed amounts, not by observed transfer deltas.
- If the token is fee-on-transfer/rebasing/callback-driven, the contract’s internal accounting can diverge from real balances.

While `safeDeployFor()` probes vanilla behavior, it is optional and not enforced across all deployment entrypoints.

Additionally, `_probeVanillaToken` cannot detect every “non-vanilla” behavior (e.g., recipient-dependent taxes/blacklists/maxTx rules), so even safeDeployFor should be treated as best-effort.

#### Impact

- Accounting mismatches can:
  - Prevent claims (insufficient balance relative to tracked pool),
  - Prevent withdrawals/disbands,
  - Or strand funds in reserved balances.

#### Recommendation

- Consider enforcing a vanilla-token probe in **all** factory deployment functions (or at least in permissionless mode), with an explicit opt-out for advanced users.
- Consider probing transfers to the same recipient patterns used by `join()`:
  - payer → burnAddress
  - payer → templ
  - payer → protocolFeeRecipient
- Document that “vanilla token” is a hard requirement and that safeDeployFor is best-effort.

---

### L-02: Several module view functions can be called directly on the module implementation and return misleading values

**Severity: Low**

#### Where

- Examples in `TemplMembershipModule`:
  - `getJoinDetails()`, `getTreasuryInfo()`, `getConfig()`, `getMemberCount()`, etc.

#### Description

Some module view functions do not use `onlyDelegatecall`. If a frontend or integrator mistakenly calls the module address directly (instead of the router `TEMPL`), it will read the module’s own storage (effectively zero/uninitialized), returning incorrect values.

This is not a direct state-safety vulnerability, but it is a practical integration hazard.

#### Recommendation

- Add `onlyDelegatecall` to view functions as well, or
- Clearly document that module addresses must not be queried directly.

---

### L-03: `join()` performs ERC20 transfers even when computed amounts are zero

**Severity: Low**

#### Where

- `TemplMembershipModule._join()` executes `transferFrom` calls for burn/treasury/memberPool/protocol even if the amounts evaluate to 0.

#### Description

The join flow calls ERC20 transfers for up to three destinations regardless of amount:

- burn portion
- templ (treasury + member pool)
- protocol fee recipient

Some non-standard ERC20 implementations revert on `transfer`/`transferFrom` of `0`.

While the protocol’s “vanilla token” assumption likely excludes these tokens, adding guards costs little and improves robustness.

#### Recommendation

Wrap token transfers in `if (amount != 0)` blocks.

---

### I-01: Registering many external reward tokens can increase join gas and provide a governance-level griefing vector

**Severity: Informational**

#### Where

- `TemplBase.MAX_EXTERNAL_REWARD_TOKENS = 256`
- `TemplBase._flushExternalRemainders()` iterates over all `externalRewardTokens` during `join()`.

#### Description

Joins iterate across every registered external reward token, performing storage reads per token.

Even if it rarely updates state, this can increase join gas costs materially if the list is large.

Because registering tokens is DAO-controlled, this is mainly a governance / misconfiguration risk.

#### Recommendation

- Consider lowering `MAX_EXTERNAL_REWARD_TOKENS`.
- Consider tracking a smaller set of “active remainder tokens” to avoid full scans.
- Or remove `_flushExternalRemainders()` if it is not needed for the intended economics.

---

### I-02: Active proposal index pruning only removes from the tail; proposal creation could be temporarily blocked at the cap

**Severity: Informational**

#### Where

- `TemplBase.MAX_ACTIVE_PROPOSALS = 10_000`
- `TemplGovernanceModule.pruneInactiveProposals()` prunes from the tail until it hits an active entry.

#### Description

If `activeProposalIds.length` reaches the cap and the last entry remains active, `pruneInactiveProposals` cannot remove inactive proposals earlier in the array. New proposals revert with `TooManyProposals()` until the tail entry becomes inactive.

This is unlikely in normal operation due to proposal fees, but it is a potential liveness edge case.

#### Recommendation

- Consider adding a pruning function that can scan and remove inactive proposals in the middle (bounded by a caller-specified step limit).

---

## Additional notes and good practices observed

- Strong use of:
  - `onlyDelegatecall` pattern to prevent direct module calls for state mutation
  - `ReentrancyGuard` on key flows (`join`, proposal creation/execution, claims)
  - Explicit revert reasons via custom errors
  - Bounded governance metadata lengths
  - Slippage protection for joins (`joinWithMaxEntryFee`)

- Governance logic is thoughtfully designed around:
  - Pre-quorum and post-quorum windows
  - Join-sequence snapshotting to prevent vote manipulation via late joins

## Recommendations

1. **Fix H-01 before mainnet deployment** if external reward disbands are expected to be used with meaningful value.
2. Add governance snapshot hardening around council mode/membership changes (M-01) or explicitly document this behavior as intended.
3. Make access-token safety checks harder to bypass in factory deployments (or prominently warn users in UI).
4. Consider small compatibility hardening changes (0-amount transfer guards, onlyDelegatecall on views).

---

## Appendix: Severity rubric

- **High:** can cause significant loss of funds or permanent loss of access to funds with realistic conditions.
- **Medium:** can materially impact governance integrity, safety, or liveness; may require coordination or special conditions.
- **Low:** limited impact, configuration pitfalls, or integration hazards.
- **Informational:** best practices, design notes, and non-urgent improvements.
