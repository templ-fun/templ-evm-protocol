# TEMPL Smart Contracts Audit Report

## Overview
- **Repository:** templ-contracts
- **Scope:** `contracts/TEMPL.sol`, `contracts/ReturnEth.sol`, `contracts/TestToken.sol`
- **Tools Used:** Hardhat tests, Slither static analysis

## Summary
The contracts implement a DAO-governed membership system with treasury management. Tests and static analysis were executed on the unmodified contracts and all tests passed. Slither reported informational findings around timestamp usage, low-level calls, and naming conventions. No critical vulnerabilities were identified in automated analysis; manual review found areas for improvement described below.

## Findings
### High
1. **Arbitrary external call execution** – `executeDAO` enables proposals to call any external contract with ETH, transferring full control to DAO governance. Malicious proposals could drain funds or interact with unsafe contracts if not reviewed carefully.

### Medium
1. **Treasury withdrawals depend solely on DAO access control** – `withdrawTreasuryDAO` and `withdrawAllTreasuryDAO` transfer treasury funds without additional safeguards such as reentrancy protection, relying on proposals to call them correctly.

2. **Timestamp-based logic** – Voting windows and proposal timing rely on `block.timestamp`, which can be slightly manipulated by miners.

### Low
1. **Member pool subtraction may revert** – `claimMemberPool` subtracts `memberRewardRemainder` from `memberPoolBalance` before comparing with claimable amounts; inconsistent state could cause underflow reverts. 
2. **Low-level ETH return** – `ReturnEth.returnToCaller` uses a low-level call to send ETH back to the caller, which may expose reentrancy or failure scenarios if deployed in production.

### Informational
- Entry fee distribution logic divides payments among burn address, treasury, member pool, and protocol fee recipient.
- Configuration updates require zero treasury and member pool balances before changing the payment token.
- The `priest` address has elevated voting weight until membership exceeds a threshold.
