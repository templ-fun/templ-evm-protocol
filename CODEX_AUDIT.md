# Codex Security Audit Report

## Scope
Core contracts reviewed:
- contracts/TEMPL.sol
- contracts/TemplBase.sol
- contracts/TemplMembership.sol
- contracts/TemplTreasury.sol
- contracts/TemplGovernance.sol
- contracts/TemplCouncil.sol
- contracts/TemplCurve.sol
- contracts/TemplDefaults.sol
- contracts/TemplErrors.sol
- contracts/TemplFactory.sol
- contracts/TemplDeployer.sol

Out of scope: tests, scripts, mocks, off-chain UI/indexers, and any external tokens or contracts.

## Methodology
- Manual, line-by-line review of core contracts and cross-module flows.
- Focus on access control, accounting correctness, reentrancy, upgrade/routing safety, and governance edge cases.
- No automated tools or tests were run.

## Summary
- Critical: 0
- High: 0
- Medium: 2
- Low: 2
- Informational: 0

## Findings

### Medium - Non-vanilla ERC-20 tokens can desync accounting
**Impact**: Fee-on-transfer, rebasing, or hook-based tokens can cause treasury and member pool balances to diverge from actual received amounts. This can make claims or withdrawals revert or become undercollateralized.

**Details**: Join accounting updates `treasuryBalance` and `memberPoolBalance` using the nominal `price` before transfers occur. If the token transfers less than the nominal amount, internal accounting assumes more funds than the contract holds.

**Recommendations**:
- Enforce vanilla ERC-20 semantics for all deployment paths, not only `safeDeployFor`.
- Alternatively, update balances using balance deltas instead of nominal `price` (measure before/after transfers).

**References**:
- contracts/TemplMembership.sol:117
- contracts/TemplMembership.sol:153
- contracts/TemplMembership.sol:159
- contracts/TemplFactory.sol:190
- contracts/TemplFactory.sol:279

---

### Medium - Council eligibility and quorum bases are not fully snapshotted
**Impact**: Changes to council membership or governance mode during an active proposal can alter who is eligible to vote or the quorum basis, which can change outcomes mid-flight.

**Details**: Voting checks current council membership at vote time, and quorum uses the current council member count when snapshots are taken. Council membership can be changed by governance while proposals are active.

**Recommendations**:
- Snapshot council membership (or council member count) at proposal creation and at quorum, and use those snapshots for eligibility and quorum checks.
- Alternatively, disallow council membership or mode changes while proposals are active.

**References**:
- contracts/TemplGovernance.sol:451
- contracts/TemplBase.sol:852
- contracts/TemplBase.sol:963

---

### Low - Proposal creators do not pre-validate all invariants enforced at execution
**Impact**: Proposals can pass voting and then revert at execution, wasting gas and confusing users.

**Details**: Some createProposal functions do not mirror the validations enforced in their setters. Examples include quorum vs instant quorum constraints, post-quorum period bounds, and council mode being unchanged.

**Recommendations**:
- Mirror setter validations in the corresponding proposal creation functions to fail early.

**References**:
- contracts/TemplCouncil.sol:52
- contracts/TemplGovernance.sol:137
- contracts/TemplGovernance.sol:173
- contracts/TemplBase.sol:1368
- contracts/TemplBase.sol:1430
- contracts/TemplBase.sol:1444

---

### Low - Routing upgrades can cause storage collisions
**Impact**: Governance can map selectors to a new module that declares additional storage variables, risking storage collision with the router's `_moduleForSelector` mapping and other shared storage. This can brick functions or corrupt state.

**Recommendations**:
- Enforce module templates that do not add storage variables, or use diamond storage with dedicated slots for extension state.
- Document this constraint prominently for any future upgrades.

**References**:
- contracts/TEMPL.sol:25
- contracts/TEMPL.sol:622

## Notes
- Governance has an intentionally powerful `CallExternal` path and `batchDAO`; these are expected trust assumptions rather than vulnerabilities.
- This review did not include automated testing, static analysis, or fuzzing.
