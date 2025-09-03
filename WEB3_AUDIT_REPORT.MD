# TEMPL Smart Contracts Audit Report

## Overview
- **Repository:** templ-contracts
- **Scope:** `contracts/TEMPL.sol`, `contracts/TestToken.sol`
- **Tools Used:** Hardhat tests, Slither static analysis

## Summary
The contracts implement a DAO-governed membership system with treasury management. Tests and static analysis were executed on the unmodified contracts and all tests passed. Slither reported informational findings around timestamp usage, low-level calls, and naming conventions. No critical vulnerabilities were identified in automated analysis; manual review found areas for improvement described below.

## Findings
### High
1. [Mitigated] Arbitrary external call execution – `executeDAO` has been removed. Proposal execution is now restricted to an allowlist of DAO functions (pause/unpause, config updates, and treasury transfers of the TEMPL-denominated token). This eliminates the broad external call surface.

### Medium
1. **Treasury withdrawals depend solely on DAO access control** – `withdrawTreasuryDAO` and `withdrawAllTreasuryDAO` transfer treasury funds via proposals; access is constrained by the allowlist. Reentrancy protection is applied at the proposal execution entrypoint.

2. **Timestamp-based logic** – Voting windows and proposal timing rely on `block.timestamp`, which can be slightly manipulated by miners.

### Low
1. **Member pool subtraction may revert** – `claimMemberPool` subtracts `memberRewardRemainder` from `memberPoolBalance` before comparing with claimable amounts; inconsistent state could cause underflow reverts. 
2. [Removed] Low-level ETH return helper used in prior tests (`ReturnEth`) is not part of production flows after removal of arbitrary external execution.

### Informational
- Entry fee distribution logic divides payments among burn address, treasury, member pool, and protocol fee recipient.
- Configuration updates require zero treasury and member pool balances before changing the payment token.
- The `priest` address has elevated voting weight until membership exceeds a threshold.
