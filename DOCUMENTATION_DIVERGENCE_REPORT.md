# Documentation Divergence Report

This document lists all divergences found between the TEMPL.sol contract implementation and the README.md documentation.

## Analysis Date: 2025-08-26

## Function-by-Function Analysis

### 1. purchaseAccess()

**Contract Implementation:**
```solidity
function purchaseAccess() external whenNotPaused nonReentrant
```
- Has `whenNotPaused` modifier
- Has `nonReentrant` modifier
- Requires exactly 4 transfers (burn, treasury, pool, protocol)
- Can revert on calculation error check

**README Documentation:**
- ✅ Correctly states "reentrancy protected"
- ❌ **MISSING**: Does not mention `whenNotPaused` modifier - function can be paused
- ✅ Correctly describes fee distribution

---

### 2. createProposal()

**Contract Implementation:**
```solidity
function createProposal(string memory _title, string memory _description, bytes memory _callData, uint256 _votingPeriod) external onlyMember returns (uint256)
```
- Returns proposal ID
- Auto-cleans up expired/executed proposals before checking active status
- If voting period is 0, uses DEFAULT_VOTING_PERIOD (7 days)

**README Documentation:**
- ✅ Correctly states "1 active limit enforced"
- ❌ **MISSING**: Does not mention auto-cleanup of stale proposals
- ❌ **MISSING**: Does not mention default voting period behavior when 0 is passed

---

### 3. vote()

**Contract Implementation:**
```solidity
function vote(uint256 _proposalId, bool _support) external onlyMember
```
- Error message says "You cannot vote on proposals created before you joined" 
- The actual check is: `purchaseTimestamp[msg.sender] < proposal.createdAt`

**README Documentation:**
- ✅ Correctly states "Flash-loan protected"
- ⚠️ **CONFUSING**: Error message wording is backwards - it actually prevents voting on proposals created AFTER you joined, not before

---

### 4. executeProposal()

**Contract Implementation:**
```solidity
function executeProposal(uint256 _proposalId) external
```
- NO nonReentrant modifier (intentionally to allow internal calls)
- Can be called by ANYONE (not just members)
- If execution fails, reverts the executed flag and restores active proposal status

**README Documentation:**
- ❌ **INCORRECT**: States "Atomic with revert safety" but doesn't clarify that ANYONE can execute
- ❌ **MISSING**: Does not mention the restoration of proposal state on failure

---

### 5. withdrawTreasuryDAO()

**Contract Implementation:**
```solidity
function withdrawTreasuryDAO(address recipient, uint256 amount, string memory reason) external onlyDAO nonReentrant
```
- Uses `proposalCount - 1` for event emission

**README Documentation:**
- ✅ Correctly states "Proposal + reentrancy guard"
- ⚠️ **UNCLEAR**: Doesn't explain the proposalCount - 1 logic for events

---

### 6. executeDAO()

**Contract Implementation:**
```solidity
function executeDAO(address target, uint256 value, bytes memory data) external onlyDAO nonReentrant returns (bytes memory)
```
- Returns bytes memory from the external call
- Can send ETH (value parameter)

**README Documentation:**
- ✅ Correctly states "Arbitrary calls protected"
- ✅ Shows correct usage in examples

---

### 7. updateConfigDAO()

**Contract Implementation:**
```solidity
function updateConfigDAO(address _token, uint256 _entryFee) external onlyDAO
```
- NO nonReentrant modifier
- Can change access token mid-flight (risky!)
- Passing 0 for fee keeps current fee

**README Documentation:**
- ❌ **MISSING**: Does not mention lack of reentrancy protection
- ❌ **MISSING**: Does not warn about risks of changing token mid-flight

---

### 8. setPausedDAO()

**Contract Implementation:**
```solidity
function setPausedDAO(bool _paused) external onlyDAO
```
- NO nonReentrant modifier
- Only affects purchaseAccess(), not other functions

**README Documentation:**
- ❌ **MISLEADING**: Called "Emergency circuit breaker" but only pauses purchases, not entire contract
- ❌ **MISSING**: Does not specify what gets paused

---

### 9. claimMemberPool()

**Contract Implementation:**
```solidity
function claimMemberPool() external nonReentrant
```
- Updates claims BEFORE transfer (correct pattern)

**README Documentation:**
- ✅ Correctly states "Claim rewards safely"

---

### 10. getActiveProposalsPaginated()

**Contract Implementation:**
```solidity
function getActiveProposalsPaginated(uint256 offset, uint256 limit) external view returns (uint256[] memory proposalIds, bool hasMore)
```
- Limit must be 1-100
- Scans beyond returned results to determine hasMore flag

**README Documentation:**
- ✅ Correctly documented with limit range
- ✅ Correctly shows usage

---

### 11. getClaimablePoolAmount()

**Contract Implementation:**
```solidity
function getClaimablePoolAmount(address member) public view returns (uint256)
```
- Loops from memberIdx + 1 to poolDeposits.length
- Integer division causes precision loss

**README Documentation:**
- ✅ Correctly states "O(n) complexity documented"
- ✅ Mentions integer division dust

---

### 12. Member Pool Distribution Logic

**Contract Implementation:**
- First member gets 0 from their own purchase
- Distribution is `poolDeposits[i] / eligibleMembers` where eligibleMembers = i

**README Documentation Table:**
```
Members | Each Member Receives
--------|--------------------
   1    | 30% of next joiner's fee
   2    | 15% each
   3+   | 10% each (capped)
```
- ❌ **INCORRECT**: Says "3+ | 10% each (capped)" but it's NOT capped at 10%
- The actual formula is 30% / number_of_existing_members
- With 4 members: 30% / 4 = 7.5% each
- With 10 members: 30% / 10 = 3% each

---

### 13. Priest Voting Weight

**Contract Implementation:**
- Priest gets enhanced weight when `members.length < priestWeightThreshold`
- Weight becomes 1 when `members.length >= priestWeightThreshold`

**README Documentation:**
- ✅ Correctly describes the threshold behavior


### 15. Access Control

**Contract Implementation:**
- onlyDAO modifier: `require(msg.sender == address(this))`
- This means DAO functions can ONLY be called by the contract itself (via proposals)

**README Documentation:**
- ✅ Correctly implies this with "proposal required"

---

## CRITICAL DIVERGENCES

### 1. Member Pool Distribution Math ERROR
**SEVERITY: HIGH**
- README states "3+ members get 10% each (capped)"
- Reality: No cap exists, it keeps dividing (4 members = 7.5%, 5 = 6%, etc.)

### 2. Pause Functionality Scope
**SEVERITY: MEDIUM**  
- README implies "Emergency circuit breaker" pauses everything
- Reality: Only pauses purchaseAccess(), all other functions work

### 3. executeProposal() Access
**SEVERITY: MEDIUM**
- README doesn't clarify that ANYONE (not just members) can execute passed proposals
- This is actually a feature for decentralization but should be documented

### 4. Token Change Risk
**SEVERITY: HIGH**
- updateConfigDAO can change the access token
- README doesn't warn this could break accounting if done mid-flight

### 5. Stale Proposal Auto-Cleanup
**SEVERITY: LOW**
- createProposal() auto-cleans expired proposals
- Not mentioned in README but useful feature

## RECOMMENDATIONS

1. **Fix Member Pool Distribution table** - Remove "capped" language, show actual percentages
2. **Clarify pause scope** - Specify it only pauses new memberships
3. **Document executeProposal accessibility** - Explain anyone can execute for decentralization
4. **Add token change warning** - Warn about updateConfigDAO token change risks
5. **Document deprecated functions** - Mention they exist for ABI compatibility
6. **Fix vote() error message** - The contract's error message is confusing

## MINOR INCONSISTENCIES

- Contract uses `proposalCount - 1` in treasury events (implementation detail)
- Some DAO functions lack reentrancy guards (updateConfigDAO, setPausedDAO)
- Default voting period behavior when passing 0 not documented

---

**Report Generated By:** Contract-to-Documentation Analysis Tool
**Files Analyzed:** 
- `/contracts/TEMPL.sol`
- `/README.md`