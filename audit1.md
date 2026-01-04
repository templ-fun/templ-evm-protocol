# templ.fun Core Contracts Security Audit

## Overview
- Review type: Manual code review (no on-chain tests or fuzzing executed).
- Scope focus: Core contracts only (router, modules, factory, deployer, and shared libraries).
- Out of scope: `contracts/mocks/`, `contracts/echidna/`, `contracts/tools/`, tests, scripts.

## In-Scope Files
- `contracts/TEMPL.sol`
- `contracts/TemplBase.sol`
- `contracts/TemplMembership.sol`
- `contracts/TemplTreasury.sol`
- `contracts/TemplGovernance.sol`
- `contracts/TemplCouncil.sol`
- `contracts/TemplFactory.sol`
- `contracts/TemplDeployer.sol`
- `contracts/TemplFactoryTypes.sol`
- `contracts/TemplCurve.sol`
- `contracts/TemplDefaults.sol`
- `contracts/TemplErrors.sol`

## Summary of Findings
- Critical: 0
- High: 0
- Medium: 1
- Low: 1
- Informational: 3

## Findings

### M-01: Member-wide proposals can snapshot post-quorum voter counts to council size
Severity: Medium

When a proposal is created in member-wide mode (`councilSnapshotEpoch == 0`), the post-quorum voter count is set using `_eligibleVoterCount()` when quorum is reached. `_eligibleVoterCount()` depends on the current `councilModeEnabled` flag. If council mode is enabled before quorum is reached, the post-quorum denominator will be `councilMemberCount` instead of the member count at quorum time. This breaks the intended snapshot semantics for member-wide proposals and can allow a proposal to execute after yes votes fall below the member quorum threshold (as long as yes votes remain above the smaller council-based threshold).

Evidence:
- `contracts/TemplGovernance.sol:479`
- `contracts/TemplBase.sol:910`
- `contracts/TemplBase.sol:852`

Impact:
- Governance integrity risk. A member-wide proposal can be executed with fewer yes votes than expected if council mode is enabled mid-flight and votes change after quorum.

Recommendation:
- For proposals with `councilSnapshotEpoch == 0`, set `postQuorumEligibleVoters` based on `memberCount` at quorum time (ignoring `councilModeEnabled`). Apply the same logic in `_maybeTriggerInstantQuorum`.

---

### L-01: Entry fee curve can violate the documented minimum fee and divisibility constraints
Severity: Low

The minimum entry fee constraints (`>= 10` and divisible by 10) are only enforced when setting the base entry fee. The current entry fee is recomputed from the curve without validation. Exponential segments allow `rateBps` values below 10_000, which can create a decaying curve that drives `entryFee` below 10 or to non-multiples of 10 (and potentially to 0), despite the documented constraints.

Evidence:
- `contracts/TemplBase.sol:833`
- `contracts/TemplBase.sol:1299`
- `contracts/TemplBase.sol:1292`

Impact:
- Economic consistency risk. A decaying curve can lead to free or oddly priced joins and reduce proposal fees to 0, undermining the entry-fee invariants described in docs.

Recommendation:
- Enforce a floor and divisibility check on computed `entryFee` (e.g., validate after `_refreshEntryFeeFromState`) or disallow exponential rates below 10_000 to prevent decay. Alternatively, pre-validate curves against the intended maximum membership range.

---

### I-01: Vanilla ERC-20 requirement is not enforced for all deployment paths
Severity: Informational

The protocol relies on vanilla ERC-20 semantics, but this is only probed in `safeDeployFor`. `createTempl`, `createTemplFor`, and direct deployments do not perform any token behavior checks. A non-vanilla token (fee-on-transfer, rebasing, hook-based) can break accounting assumptions.

Evidence:
- `contracts/TemplFactory.sol:265`
- `contracts/TemplFactory.sol:279`

Recommendation:
- Consider making token probing mandatory for factory deployments or add an explicit token check in the router constructor to reduce footguns.

---

### I-02: Module addresses are not checked for code at deployment
Severity: Informational

The router only validates module addresses are non-zero at deployment. If a factory is deployed or configured with an EOA or an address without code, delegatecalls become no-ops, leading to non-functional templs with misleading success returns.

Evidence:
- `contracts/TEMPL.sol:114`

Recommendation:
- Add `code.length > 0` checks for module addresses in the router or factory constructors.

---

### I-03: Governance has admin-level power via CallExternal and routing updates
Severity: Informational

`createProposalCallExternal`, `batchDAO`, and `setRoutingModuleDAO` allow governance to execute arbitrary calls and rewire module selectors. This is a powerful admin-equivalent capability and should be treated as such in operational security and UI warnings.

Evidence:
- `contracts/TemplGovernance.sol:287`
- `contracts/TemplTreasury.sol:212`
- `contracts/TEMPL.sol:642`

Recommendation:
- Ensure UI and documentation continue to surface this clearly. Consider optional timelocks or additional constraints if the threat model requires them.

## Notes
- No tests were run during this review. Behavior was evaluated via static analysis of the current workspace state.
