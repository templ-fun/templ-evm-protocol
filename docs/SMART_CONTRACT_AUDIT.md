# Templ.fun Smart Contract Audit

**Date:** 2025-09-26
**Auditor:** ChatGPT (OpenAI autonomous agent)

## Executive Summary
- **Scope:** `contracts/` Solidity sources for the Templ.fun protocol (`TEMPL`, `TemplFactory`, and supporting modules).
- **Assessment period:** Single-pass manual review with tooling assistance (no on-chain deployment).
- **Overall risk posture:** The codebase is generally well-structured with clear separation of membership, treasury, and governance concerns. One medium-severity governance vulnerability was identified along with several centralization and assumption-based observations. No critical issues were found.

### Severity Breakdown
| Severity | Count |
| --- | --- |
| Critical | 0 |
| High | 0 |
| Medium | 1 |
| Low | 1 |
| Informational | 2 |

## Methodology
1. Reviewed architecture and storage layout in `TemplBase` and derived modules to understand cross-cutting state. 【F:contracts/TemplBase.sol†L12-L320】
2. Traced membership purchase, reward accounting, and claiming flows for ERC-20 and ETH distributions. 【F:contracts/TemplMembership.sol†L43-L200】【F:contracts/TemplTreasury.sol†L176-L227】
3. Analyzed governance proposal lifecycle, quorum handling, and execution paths. 【F:contracts/TemplGovernance.sol†L140-L552】
4. Evaluated factory deployment constraints and constructor invariants. 【F:contracts/TemplFactory.sol†L10-L142】
5. Considered failure modes, reentrancy surfaces, centralization toggles, and token compatibility assumptions.

## System Overview
- `TEMPL` composes membership, treasury, and governance modules with immutable protocol-level fee parameters set in the factory. 【F:contracts/TEMPL.sol†L10-L58】
- `TemplBase` manages core configuration (fee splits, quorum, execution delay), priest authority, member registry, proposal storage, and reward checkpoints shared across modules. 【F:contracts/TemplBase.sol†L12-L320】
- `TemplMembership` handles access purchases, distribution of entry fees across burn/treasury/member pools, and member reward claims (including external ERC-20/ETH rewards). 【F:contracts/TemplMembership.sol†L43-L200】
- `TemplTreasury` exposes DAO/priest actions for withdrawals, fee updates, pausing, disbanding the treasury into rewards, and priest rotation. 【F:contracts/TemplTreasury.sol†L41-L227】
- `TemplGovernance` implements proposal creation, voting, quorum tracking, and execution of treasury/governance actions with optional dictatorship mode. 【F:contracts/TemplGovernance.sol†L32-L552】
- `TemplFactory` deploys templ instances with defaults or caller-provided configuration, enforcing percentage constraints against the protocol fee. 【F:contracts/TemplFactory.sol†L10-L142】

## Findings

### [M-01] Quorum guarantee can be bypassed after it is reached once
**Location:** `TemplGovernance._createBaseProposal`, `TemplGovernance.vote`, `TemplGovernance.executeProposal` 【F:contracts/TemplGovernance.sol†L248-L337】【F:contracts/TemplGovernance.sol†L520-L548】

**Description:**
- `_createBaseProposal` seeds every proposal with a YES vote from the proposer and records the total eligible voters at creation time.
- In `vote`, quorum is only checked while `proposal.quorumReachedAt == 0`. Once YES votes satisfy the quorum percentage, the contract records `quorumReachedAt`, snapshots state, and replaces the proposal end time with `block.timestamp + executionDelayAfterQuorum`.
- Subsequent vote changes are allowed, but the quorum condition is never revalidated. `executeProposal` only checks that quorum was reached at least once and that `yesVotes > noVotes` at execution time.

An attacker (or cooperative majority) can therefore:
1. Reach quorum by coordinating sufficient YES votes.
2. After the quorum timestamp is recorded, switch some votes to NO so that the remaining YES votes fall below the quorum threshold while still exceeding the NO tally.
3. Wait out the execution delay and execute the proposal with sub-quorum YES support.

This breaks the intended guarantee that executed proposals maintain quorum-level support and lets proposals pass with lower-than-configured backing.

**Impact:** Medium. Governance decisions can execute with a smaller affirmative set than the configured quorum, undermining stakeholder safety assumptions and facilitating governance capture after a single quorum event.

**Recommendation:**
- Revalidate the quorum condition at execution by checking `yesVotes * 100 >= quorumPercent * eligibleVotersSnapshot` (pre- or post-quorum) immediately before execution.
- Alternatively, update the voting logic to clear `quorumReachedAt` if YES votes drop below the threshold so the execution delay cannot start without continuous quorum support.

### [L-01] Priest-originated treasury disband proposals bypass quorum requirements
**Location:** `TemplGovernance.createProposalDisbandTreasury` 【F:contracts/TemplGovernance.sol†L164-L177】

**Description:** When the current priest creates a disband-treasury proposal, the contract sets `quorumExempt = true`. The proposer automatically casts a YES vote, so—absent explicit NO votes—the treasury can be swept into member rewards after the voting period with a single supporting voter. While this is documented behavior, it materially lowers the decision threshold for a sensitive treasury action even when the DAO is otherwise operating under normal quorum rules.

**Impact:** Low. The action still requires waiting out the proposal period and can be vetoed by NO votes, but it introduces a centralization lever that stakeholders should acknowledge.

**Recommendation:** Require quorum even for priest-initiated disband proposals or add an execution delay similar to other quorum-governed actions so the broader DAO can respond. At minimum, highlight this centralization vector in documentation and operational playbooks.

### Informational Observations
1. **Fee-on-transfer tokens are unsupported.** The membership contract assumes transfers are value-conserving and explicitly notes that fee-on-transfer access tokens break accounting. Integrators should restrict acceptable access tokens accordingly. 【F:contracts/TemplMembership.sol†L86-L90】
2. **Dictatorship mode centralizes authority.** When `priestIsDictator` is enabled, `onlyDAO` allows the priest to invoke treasury and configuration functions directly. Operational controls should ensure the priest key is well protected and dictatorship toggles are auditable. 【F:contracts/TemplBase.sol†L203-L216】【F:contracts/TemplTreasury.sol†L41-L134】

## Recommendations & Best Practices
- Address the quorum revalidation bug (Finding M-01) prior to deployment or upgrade.
- Review governance documentation to make the special-casing of priest disband proposals explicit, or adjust the code as suggested.
- Maintain strict operational security for the priest role and consider on-chain timelocks or multisig delegation if dictatorship mode is ever enabled.
- Keep automated tests, formal verification, or fuzzing harnesses updated to cover vote-changing edge cases uncovered in this review.

## Appendix: Suggested Test Enhancements
- Add scenario tests where quorum is reached, votes are changed afterward, and execution is attempted to prevent regressions around quorum enforcement.
- Extend governance tests to cover priest-created disband proposals, ensuring community expectations about quorum are verified in CI.

---
Prepared for Templ.fun by ChatGPT on 2025-09-26.
