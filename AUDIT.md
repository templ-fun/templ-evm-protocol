Templ Protocol Audit Report
===========================

Scope
- Contracts: contracts/*.sol (TEMPL, TemplBase, Modules, Factory, Curve, Defaults, Errors, libraries)
- Tooling: Hardhat tests executed locally; Echidna/Slither configs reviewed (not executed in this environment)
- Commit time: current workspace state at audit

Summary
- Overall design is modular and conservative: storage-centralized in TemplBase, modules accessed via delegatecall, strict onlyDAO gating, per-proposal join-sequence snapshots and post-quorum timelock, and thorough unit tests plus property fuzzing harness.
- No critical issues found. One medium-severity issue identified and fixed in this PR.

Key Changes (fixed in this PR)
1) Anchored post-quorum execution delay to snapshot
   - Issue: executeProposal compared block.timestamp < proposal.quorumReachedAt + executionDelayAfterQuorum using the current, mutable executionDelayAfterQuorum instead of the per-proposal snapshot.
   - Impact: Changing the global delay after quorum could unexpectedly shorten/extend the wait for already-quorate proposals.
   - Fix: Check block.timestamp >= proposal.endTime (which is set at quorum) for gating. File: contracts/TemplGovernance.sol.

2) [Removed] Access-token enforcement was considered but not adopted; the protocol relies on deployers to choose vanilla ERC-20s as documented.

Findings

Severity: Medium
- M-01: Post-quorum execution delay not anchored (Fixed)
  - Details: See Key Changes #1.
  - Recommendation: Keep as implemented; snapshot per-proposal and gate off endTime.

Severity: Low / Design Notes
- L-01: CallExternal proposals can target arbitrary addresses (including self).
  - Context: Explicitly documented and intentional (admin-style action). onlyDAO gating prevents unauthorized direct calls; nonReentrant prevents re-entrancy into protected paths; self-calls to non-reentrant DAO functions will revert.
  - Recommendation: Optional — disallow target == address(this) to reduce foot-guns, or require a specialized proposal type for self-calls if a stricter governance posture is desired.

- L-02: Read-heavy views with O(n) iteration (getActiveProposals, getExternalRewardTokensPaginated).
  - Context: View-only; acceptable for off-chain UIs.
  - Recommendation: None required.

Informational
- I-01: Uniform 1/1 voting weight is by design to keep governance simple and sybil resistance is enforced economically via the join fee.
- I-02: Parameter updates (e.g., quorum) apply globally; per-proposal snapshot anchors are already used where needed.

Positive Observations
- Strong reentrancy hygiene: nonReentrant on join/claims/execute/treasury moves; notSelf to prevent contract-initiated join flows; SafeERC20 usage.
- Robust governance snapshots: join sequence snapshot at creation and quorum prevents eligibility swings.
- Clear, centralized errors and events; consistent basis points handling and split validation.
- Extensive test suite and Echidna hooks configured; high signal coverage for intended invariants.

Tools & Validation
- Ran npm test: all suites passing (321 passing including new test).
- Reviewed Slither/Echidna configs; did not run Slither here due to environment constraints. Property fuzzing recommended in CI/CD as already configured.

Recommendations (Non-blocking)
- Consider explicitly disallowing CallExternal self-target if the governance model prefers strictly typed actions.
- Keep Echidna in CI with increasing limits over time; add a fuzz target for proposal sequencing/staleness if desired.
