# Security Audit: Templ Core Contracts

Date: 2026-01-04
Commit: 2e264b5f189f42015f7c96f14566fc6c04584031

## Scope
In scope (core contracts):
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
- contracts/TemplFactoryTypes.sol
- contracts/TemplDeployer.sol

Out of scope:
- contracts/mocks/*
- contracts/echidna/*
- contracts/tools/*

## Methodology
- Manual review focused on access control, reentrancy, governance flows, token accounting, and upgrade surfaces.
- No automated static analysis or fuzzing executed as part of this review.

## Summary of Findings
- Critical: 0
- High: 0
- Medium: 1
- Low: 1
- Informational: 2

## Findings

### [M-1] External reward accounting assumes vanilla ERC-20 behavior
**Impact:** If the DAO disbands or registers a rebasing or fee-on-transfer token as an external reward, member claims can revert or deliver less than the on-chain accounting expects. This can permanently strand rewards or create unpredictable payouts for members.

**Details:** External rewards rely on internal accounting (`poolBalance`, `cumulativeRewards`) while claims are paid via `_safeTransfer`, which does not verify balance deltas. There is no vanilla-token validation for external rewards, so non-standard tokens can desync accounting and cause claim failures.

**Recommendation:** Enforce vanilla ERC-20 behavior for external reward tokens (e.g., probe on `reconcileExternalRewardTokenDAO` similar to factory safe deploy checks), or adjust claim logic to reconcile against actual balances and handle fee-on-transfer/rebasing semantics. At minimum, document that only vanilla tokens are supported for external rewards.

**References:**
- contracts/TemplTreasury.sol:196
- contracts/TemplMembership.sol:263
- contracts/TemplBase.sol:1825

### [L-1] Protocol fee recipient (and burn address) cannot be the payer in joins
**Impact:** If the payer is the `protocolFeeRecipient` (or the `burnAddress`) and the corresponding fee is non-zero, the join will revert with `NonVanillaToken`. This makes it impossible for those addresses to join as members when fees are enabled.

**Details:** `_safeTransferFrom` enforces a strict balance delta on the recipient. When `from == to`, the recipient balance does not change, so the check fails even though the transfer is effectively a no-op. Join flows always attempt to transfer protocol/burn allocations from the payer, so a payer that equals those recipients will fail.

**Recommendation:** Special-case `from == to` transfers (skip or treat as success) for join-time fee transfers, or document that protocol fee recipient and burn address cannot join while fees are enabled.

**References:**
- contracts/TemplMembership.sol:160
- contracts/TemplBase.sol:1841

### [I-1] Module addresses are only checked for non-zero in the router constructor
**Impact:** Misconfigured deployments can set a module address to an EOA or a non-contract address, causing routed calls to become no-ops or revert unexpectedly. This can silently create a broken templ instance.

**Recommendation:** Add `code.length > 0` validation for module addresses in the constructor (similar to `setRoutingModuleDAO`), and/or enforce this invariant in the factory.

**References:**
- contracts/TEMPL.sol:114

### [I-2] Routing upgrades allow mapping selectors to the router itself or incompatible modules
**Impact:** A governance mistake (or compromised governance) can map selectors to `address(this)` or incompatible modules and brick functionality via self-delegatecall loops or storage layout mismatches.

**Recommendation:** Disallow `module == address(this)` and consider adding allowlists or interface checks for module upgrades. Operationally, pair routing changes with timelocks and thorough verification.

**References:**
- contracts/TEMPL.sol:634

## Additional Notes
- Governance can execute arbitrary external calls via proposals, so DAO security (quorum parameters, execution delay, multisig, timelocks) is a critical trust assumption.
- Access token behavior is validated to be vanilla for joins, but external reward tokens are not; treat them accordingly in operations and docs.
