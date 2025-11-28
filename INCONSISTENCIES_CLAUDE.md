Claude Code (v2.0.55) Opus 4.5


# Inconsistency Analysis Report

This document captures inconsistencies found across the codebase, including naming conventions, documentation, code patterns, and configuration discrepancies.

## Summary

| Category | Count | Severity |
|----------|-------|----------|
| Code Inconsistencies | 8 | Medium |
| Naming Inconsistencies | 5 | Low |
| Documentation Inconsistencies | 4 | Low |
| Configuration Inconsistencies | 3 | Low |
| Pattern Inconsistencies | 6 | Low-Medium |

---

## 1. Code Inconsistencies

### 1.1 BPS_DENOMINATOR Duplication
**Severity:** Medium
**Location:** Multiple files

The constant `BPS_DENOMINATOR = 10_000` is defined independently in multiple contracts instead of being centralized in `TemplDefaults.sol`:

- `TemplBase.sol:19` - `uint256 internal constant BPS_DENOMINATOR = 10_000;`
- `TemplFactory.sol:19` - `uint256 internal constant BPS_DENOMINATOR = 10_000;`

**Recommendation:** Move `BPS_DENOMINATOR` to `TemplDefaults.sol` and import it, similar to how `DEFAULT_QUORUM_BPS` is handled.

---

### 1.2 Delegatecall Guard Implementation Inconsistency
**Severity:** Medium
**Location:** `TemplGovernance.sol` vs other modules

The governance module uses an internal function `_requireDelegatecall()` instead of the `onlyDelegatecall` modifier pattern used by other modules:

**TemplMembership.sol, TemplTreasury.sol, TemplCouncil.sol:**
```solidity
modifier onlyDelegatecall() {
    if (address(this) == SELF) revert TemplErrors.DelegatecallOnly();
    _;
}
```

**TemplGovernance.sol:**
```solidity
function _requireDelegatecall() internal view {
    if (address(this) == SELF) revert TemplErrors.DelegatecallOnly();
}
```

The governance module calls `_requireDelegatecall()` at the start of functions instead of using a modifier. While functionally equivalent, this creates an inconsistent pattern.

**Recommendation:** Standardize on either the modifier approach or the internal function approach across all modules.

---

### 1.3 Missing `onlyDelegatecall` on Some Governance Functions
**Severity:** Medium
**Location:** `TemplGovernance.sol`

Some functions in `TemplGovernance.sol` use `_requireDelegatecall()` while the `vote()` function at line 438 does not explicitly call either the modifier or the internal function check:

```solidity
function vote(uint256 _proposalId, bool _support) external onlyMember {
    _requireDelegatecall();  // This IS present
    ...
}
```

However, functions like `createProposalSetJoinPaused` use the internal function call pattern. This is consistent but the pattern differs from other modules.

---

### 1.4 Inconsistent Error Usage for Same Condition
**Severity:** Low
**Location:** Various

When a zero address module is passed, different error types are used:

- `TEMPL.sol:120` uses `TemplErrors.InvalidCallData()` for zero module addresses
- `TemplFactory.sol:197` uses `TemplErrors.InvalidCallData()` for zero module addresses
- `TemplBase.sol:1440` uses `TemplErrors.InvalidRecipient()` for zero council member

Both patterns are used for "invalid zero address" checks, creating inconsistency in what error a caller receives.

---

### 1.5 Default Curve Configuration Inconsistency
**Severity:** Medium
**Location:** `TemplFactory.sol` vs `test/utils/deploy.js`

The factory uses an exponential curve by default, but tests use a static curve by default:

**TemplFactory.sol (lines 160-168):**
```solidity
function _defaultCurveConfig() internal pure returns (CurveConfig memory cfg) {
    CurveSegment memory primary = CurveSegment({
        style: CurveStyle.Exponential,
        rateBps: DEFAULT_CURVE_EXP_RATE_BPS,  // 10_094
        length: uint32(DEFAULT_MAX_MEMBERS - 1)  // 248
    });
    ...
}
```

**test/utils/deploy.js (lines 5-8):**
```solidity
const STATIC_CURVE = {
  primary: { style: 0, rateBps: 0, length: 0 },
  additionalSegments: []
};
```

The test default is `STATIC_CURVE`, which differs significantly from the factory default curve.

---

### 1.6 Council Mode Default Inconsistency
**Severity:** Medium
**Location:** `TemplFactory.sol` vs `test/utils/deploy.js`

**TemplFactory.sol (line 298):**
```javascript
councilMode: true,  // Factory default
```

**test/utils/deploy.js (line 60):**
```javascript
councilMode = false,  // Test default
```

The factory starts templs in council mode by default, but tests default to `councilMode = false`.

---

### 1.7 Inconsistent Max Members Default
**Severity:** Low
**Location:** `TemplFactory.sol` vs `test/utils/deploy.js`

**TemplFactory.sol (line 27):**
```solidity
uint256 internal constant DEFAULT_MAX_MEMBERS = 249;
```

**test/utils/deploy.js (line 52):**
```javascript
maxMembers = 0,  // Test default (uncapped)
```

Factory applies a cap of 249 members, tests use uncapped by default.

---

### 1.8 Missing Proposal Creation Functions in Council Module
**Severity:** Low
**Location:** `TemplCouncil.sol` vs `TemplGovernance.sol`

The `TemplCouncilModule` contains only 4 proposal creation functions for council-specific actions:
- `createProposalSetYesVoteThreshold`
- `createProposalSetCouncilMode`
- `createProposalAddCouncilMember`
- `createProposalRemoveCouncilMember`

However, `createProposalSetPreQuorumVotingPeriod` exists nowhere (it's a DAO-only setter via `setPreQuorumVotingPeriodDAO` with no corresponding proposal creator). Users must use `createProposalCallExternal` to create a proposal for this.

---

## 2. Naming Inconsistencies

### 2.1 Event Naming: `*Updated` vs `*Changed`
**Severity:** Low
**Location:** `TemplBase.sol`

Events use inconsistent naming patterns:

**Using "Updated":**
- `ConfigUpdated`
- `JoinPauseUpdated`
- `MaxMembersUpdated`
- `QuorumBpsUpdated`
- `PostQuorumVotingPeriodUpdated`
- `BurnAddressUpdated`
- `PreQuorumVotingPeriodUpdated`
- `YesVoteThresholdUpdated`
- `InstantQuorumBpsUpdated`
- `CouncilModeUpdated`
- `PermissionlessModeUpdated`

**Using "Changed":**
- `PriestChanged`
- `DictatorshipModeChanged`
- `DeployerTransferred` (different pattern entirely)

**Recommendation:** Standardize on one naming convention (preferably `*Updated` since it's more common).

---

### 2.2 Parameter Naming: `_executionDelay` vs `postQuorumVotingPeriod`
**Severity:** Low
**Location:** `TEMPL.sol` constructor vs state variables

The constructor parameter is named `_executionDelay` but the corresponding state variable is `postQuorumVotingPeriod`:

**TEMPL.sol constructor (line 43):**
```solidity
/// @param _executionDelay Seconds to wait after quorum before executing a proposal.
```

**TemplBase.sol (line 80):**
```solidity
uint256 public postQuorumVotingPeriod;
```

This naming discrepancy can cause confusion.

---

### 2.3 Inconsistent `Bps` Suffix in Function Names
**Severity:** Low
**Location:** Various

Some functions include `Bps` suffix, others don't:

**With Bps:**
- `setQuorumBpsDAO`
- `setInstantQuorumBpsDAO`
- `setYesVoteThresholdBpsDAO`
- `setProposalCreationFeeBpsDAO`
- `setReferralShareBpsDAO`

**Without Bps (but dealing with bps values):**
- `createProposalSetProposalFeeBps` (has Bps)
- `createProposalSetReferralShareBps` (has Bps)

The pattern is generally consistent, but documentation could clarify that all fee/threshold values are in basis points.

---

### 2.4 Module Contract vs File Name Mismatch
**Severity:** Low
**Location:** File naming

Contract names include "Module" suffix but file names vary:

| Contract Name | File Name |
|--------------|-----------|
| `TemplMembershipModule` | `TemplMembership.sol` |
| `TemplTreasuryModule` | `TemplTreasury.sol` |
| `TemplGovernanceModule` | `TemplGovernance.sol` |
| `TemplCouncilModule` | `TemplCouncil.sol` |

File names don't include the "Module" suffix that contract names have.

---

### 2.5 Inconsistent NatSpec `@return` Parameter Naming
**Severity:** Low
**Location:** Various view functions

Some functions return tuples with named parameters while documentation uses different names:

**TemplBase.sol `_eligibleVoterCount` (line 842):**
```solidity
/// @return count Eligible voter count depending on council/member mode.
function _eligibleVoterCount() internal view returns (uint256 count) {
```

**TemplMembership.sol `getMemberCount` (line 321):**
```solidity
/// @return count Number of wallets with active membership (includes the auto-enrolled priest).
function getMemberCount() external view returns (uint256 count) {
```

These are consistent. However, `getConfig()` returns 10 values with abbreviated names in code but full names in docs.

---

## 3. Documentation Inconsistencies

### 3.1 README Factory Address May Be Outdated
**Severity:** Low
**Location:** `README.md:27`

The README lists a single factory address for Base:
```
Base: 0xc47c3088a0be67a5c29c3649be6e7ca8e8aeb5e3
```

However, the `deployments/` folder contains multiple factory deployment files for chain 8453, suggesting multiple deployments. The README should clarify which factory is canonical or list deployment history.

---

### 3.2 Inconsistent Voting Period Terminology
**Severity:** Low
**Location:** README.md vs Code

**README.md (line 736):**
```
"- Voting period: ≥36h (max 30 days)"
```

**TemplBase.sol (lines 285-287):**
```solidity
uint256 public constant MIN_PRE_QUORUM_VOTING_PERIOD = 36 hours;
uint256 public constant MAX_PRE_QUORUM_VOTING_PERIOD = 30 days;
```

The README mentions "voting period" generically, but the code specifically refers to "pre-quorum voting period". The post-quorum voting period is controlled by `postQuorumVotingPeriod` with no explicit min/max bounds in constants.

---

### 3.3 Missing Documentation for Some Errors
**Severity:** Low
**Location:** `TemplErrors.sol`

The `NonVanillaToken` error (line 117) is documented but only used in `TemplFactory.sol`. The NatSpec comment says "access token fails vanilla ERC-20 checks during safe deployment probing" which is accurate but could mention it's factory-only.

---

### 3.4 Event Documentation Formatting
**Severity:** Low
**Location:** `TemplBase.sol`

Some events have extra blank lines between the NatSpec and event declaration (inconsistent):

**Lines 376-377:**
```solidity
/// @notice Emitted when the membership cap is updated.
/// @param maxMembers New maximum member count (0 = uncapped).

event MaxMembersUpdated(uint256 indexed maxMembers);
```

The blank line between param documentation and event is inconsistent with other events.

---

## 4. Configuration Inconsistencies

### 4.1 Hardhat Config Mocha Grep Pattern
**Severity:** Low
**Location:** `hardhat.config.cjs:85-86`

```javascript
grep: usingCoverage ? '@(load|fuzz)' : undefined,
invert: usingCoverage ? true : undefined
```

When running coverage, tests tagged with `@load` or `@fuzz` are excluded. However, `package.json` scripts suggest `@load` tests are for load testing, not fuzzing. The pattern should potentially be just `@load` since fuzzing is done via Echidna, not Mocha.

---

### 4.2 Solhint Pragma Version vs Hardhat Config
**Severity:** Low
**Location:** `.solhint.json` vs `hardhat.config.cjs`

**.solhint.json:**
```json
"compiler-version": ["error", "^0.8.23"]
```

**hardhat.config.cjs:**
```javascript
version: "0.8.23"
```

Solhint allows `^0.8.23` (any 0.8.x >= 0.8.23) while Hardhat pins to exactly `0.8.23`. This is fine but could lead to confusion if a dev uses a pragma like `^0.8.24` (would pass solhint but fail Hardhat compile).

---

### 4.3 Test Script Exclusion Pattern
**Severity:** Low
**Location:** `package.json`

```json
"test": "npx hardhat test --grep '@load' --invert"
```

The grep pattern excludes `@load` tests but the config also mentions `@fuzz`. If there are `@fuzz` tagged tests in Mocha (vs Echidna), they would run in normal `npm test` but be excluded in coverage.

---

## 5. Pattern Inconsistencies

### 5.1 Storage Variable Initialization
**Severity:** Low
**Location:** `TEMPL.sol` constructor

Some state variables are explicitly set in the constructor while their defaults would suffice:

**Line 135:**
```solidity
joinPaused = false;
```

`joinPaused` is a `bool` which defaults to `false`. This explicit assignment is not harmful but inconsistent with not explicitly setting other default-value variables.

---

### 5.2 Modifier vs Guard Function Usage
**Severity:** Low
**Location:** Various modules

Modules use a mix of modifier chains and internal guard functions:

**TemplMembership.sol `join()` (line 32):**
```solidity
function join() external whenNotPaused notSelf nonReentrant onlyDelegatecall {
```

**TemplGovernance.sol `createProposalSetJoinPaused()` (line 33):**
```solidity
function createProposalSetJoinPaused(...) external nonReentrant returns (uint256 proposalId) {
    _requireDelegatecall();
    if (priestIsDictator) revert TemplErrors.DictatorshipEnabled();
```

The governance module uses inline checks instead of modifiers for delegatecall and dictatorship.

---

### 5.3 Return Style Inconsistency
**Severity:** Low
**Location:** Various

Some functions return named variables, others return expressions:

**TemplBase.sol (line 843):**
```solidity
function _eligibleVoterCount() internal view returns (uint256 count) {
    return councilModeEnabled ? councilMemberCount : memberCount;
}
```

**TemplBase.sol (line 1221):**
```solidity
function _min(uint256 a, uint256 b) internal pure returns (uint256 minValue) {
    return a < b ? a : b;
}
```

Both use named return variables but don't actually use implicit return (they still use `return` statement). This is consistent but the named return variable serves no purpose.

---

### 5.4 Event Emission Location
**Severity:** Low
**Location:** `TemplBase.sol` vs Modules

Some internal functions emit events directly, while others leave event emission to callers:

**`_setJoinPaused` emits:**
```solidity
function _setJoinPaused(bool _paused) internal {
    joinPaused = _paused;
    emit JoinPauseUpdated(_paused);
}
```

**`_registerModule` does NOT emit:**
```solidity
function _registerModule(address module, bytes4[] memory selectors) internal {
    // No event emitted here
}
```

The event `RoutingUpdated` is emitted in `setRoutingModuleDAO` which calls `_registerModule`.

---

### 5.5 Ternary vs If-Else for Default Values
**Severity:** Low
**Location:** `TemplBase.sol`

Some default value handling uses ternary, others use if-else:

**Ternary (line 716):**
```solidity
postQuorumVotingPeriod = _executionDelay == 0 ? DEFAULT_POST_QUORUM_VOTING_PERIOD : _executionDelay;
```

**If-else (lines 709-714):**
```solidity
if (_quorumBps == 0) {
    quorumBps = DEFAULT_QUORUM_BPS;
} else {
    if (_quorumBps > BPS_DENOMINATOR) revert TemplErrors.InvalidPercentage();
    quorumBps = _quorumBps;
}
```

The if-else version includes validation which justifies the different pattern, but similar validation-free defaults could use ternary consistently.

---

### 5.6 Loop Increment Style
**Severity:** Low
**Location:** Various

Most loops use prefix increment (`++i`) but this is consistent throughout.

---

## 6. Potential Issues (Not Strictly Inconsistencies)

### 6.1 Missing `createProposalSetPreQuorumVotingPeriod`
**Severity:** Medium
**Location:** `TemplGovernance.sol`

There is a DAO function `setPreQuorumVotingPeriodDAO` but no corresponding `createProposal*` function. Users must use `createProposalCallExternal` to change this parameter via governance.

---

### 6.2 No Pagination for Council Members
**Severity:** Low
**Location:** Contract design

External reward tokens have pagination (`getExternalRewardTokensPaginated`), but there's no way to enumerate council members. Only `councilMembers(address) → bool` and `councilMemberCount` exist.

---

## Recommendations

1. **Centralize Constants:** Move `BPS_DENOMINATOR` and other shared constants to `TemplDefaults.sol`.

2. **Standardize Guard Patterns:** Choose either modifier or internal function approach for delegatecall guards and apply consistently.

3. **Align Test Defaults with Production:** Consider having test utilities use factory-like defaults (exponential curve, council mode enabled) unless explicitly testing other configurations.

4. **Add Missing Proposal Creators:** Add `createProposalSetPreQuorumVotingPeriod` to `TemplGovernance.sol` for completeness.

5. **Event Naming Convention:** Standardize on `*Updated` suffix for all parameter change events.

6. **Documentation Sync:** Ensure README terminology matches code terminology (e.g., "pre-quorum voting period" vs "voting period").

---

*Generated: Analysis of templ.fun EVM smart contracts codebase*
