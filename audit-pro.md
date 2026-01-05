
# Security Audit Report — Templ Core Smart Contracts

Date: 2026-01-04  
Auditor: GPT-5.2 Thinking (static review)

## Scope

**In-scope (core, non-mock) Solidity contracts:**
- `contracts/TEMPL.sol`
- `contracts/TemplBase.sol`
- `contracts/TemplCouncil.sol`
- `contracts/TemplCurve.sol`
- `contracts/TemplDefaults.sol`
- `contracts/TemplDeployer.sol`
- `contracts/TemplErrors.sol`
- `contracts/TemplFactory.sol`
- `contracts/TemplFactoryTypes.sol`
- `contracts/TemplGovernance.sol`
- `contracts/TemplMembership.sol`
- `contracts/TemplTreasury.sol`
- `contracts/tools/BatchExecutor.sol`

**Out of scope:** `contracts/mocks/*`, `contracts/echidna/*`, tests, scripts, frontend.

## High-level architecture

- `TEMPL.sol` acts as a **router**: `fallback()` routes each selector to a module via `delegatecall`.
- Modules (`Membership`, `Governance`, `Treasury`, `Council`) inherit `TemplBase` which contains shared storage and helpers.
- “DAO-only” actions are gated by `onlyDAO`:
  - **Dictatorship enabled:** `msg.sender` may be the priest or the contract.
  - **Dictatorship disabled:** only `msg.sender == address(this)` is accepted, meaning actions must be invoked via a self-call executed by governance (i.e., proposals call the router itself).

This design is coherent, but it shifts a lot of security weight onto:
1) Correct selector routing, and  
2) The governance system’s ability to safely construct/execute self-calls.

## Summary of findings

| Severity | Count |
|---------:|------:|
| Critical | 0 |
| High | 1 |
| Medium | 2 |
| Low | 2 |
| Info | 5 |

---

## Findings

### [H-01] Selector routing is mutable by governance and can permanently brick or compromise the system

**Where**
- `TEMPL.sol`: `setRoutingModuleDAO(address module, bytes4[] selectors)` and `fallback()` routing
- Storage mapping: `_moduleForSelector[msg.sig]`

**Issue**
The router uses a diamond-style selector registry. Governance (or the priest in dictatorship mode) can change the module address for arbitrary selectors, including:
- mapping selectors to a module that **does not implement** them (bricking functionality),
- mapping selectors to a module with **incompatible storage layout** (state corruption),
- mapping selectors to an arbitrary implementation that performs malicious behavior under `delegatecall` (full takeover).

While “governance can do anything” is a common assumption, this is still a **high-impact operational risk**:
- a single mistaken proposal can irreversibly corrupt state,
- a malicious module can steal funds by writing router storage directly,
- recovery may be impossible without an emergency escape hatch.

**Recommendation**
- Strongly consider constraining routing changes:
  - allow only a fixed set of module implementation addresses (whitelist),
  - enforce “selector must exist” checks (e.g., `extcodesize` + `staticcall` to `supportsInterface`-style registry),
  - add a timelock + veto/guardian for routing changes,
  - or remove dynamic routing after initialization (immutable routing).
- If upgradability is desired, implement a well-audited upgrade pattern (e.g., EIP-2535 Diamond w/ facets + cut function constraints, or a standard proxy + separate modules).

---

### [M-01] Join gas can degrade due to `_flushExternalRemainders()` looping over all tracked external reward tokens

**Where**
- `TemplMembership.sol`: `_join()` calls `_flushExternalRemainders()`
- `TemplBase.sol`: `_flushExternalRemainders()` iterates `externalRewardTokens`

**Issue**
Every join triggers a loop over `externalRewardTokens` to distribute external reward remainders. The code caps tokens at `MAX_EXTERNAL_REWARD_TOKENS = 256`, but 256 iterations plus storage writes can still be expensive and make joining unreliable on congested networks or under adversarial conditions.

This becomes a griefing vector if governance (or a dictator priest) registers many external reward tokens, or if normal operation accumulates a large set over time.

**Recommendation**
- Consider amortizing remainder distribution:
  - distribute remainders lazily on claim (per-token) rather than on join,
  - allow batching/partial flushing with a cursor,
  - keep the cap but also provide a cheaper “skip flush” join path that sets snapshots safely (careful design required).

---

### [M-02] Governance “external call” proposals are effectively arbitrary contract calls with ETH forwarding

**Where**
- `TemplGovernance.sol`: execution uses `target.call{value: callValue}(callData)`

**Issue**
The `ExternalCall` execution path allows arbitrary calls to any target with any calldata and ETH value. In practice, this is equivalent to a generic executor (a treasury “multicall” with value).

This is not inherently a bug—many DAOs want it—but it is a **meaningful security surface**:
- it can call into risky protocols,
- it can approve tokens to malicious spenders,
- it can interact with tokens that have hooks/callbacks (ERC777-like),
- it can be used to modify routing via self-call to `setRoutingModuleDAO`.

**Recommendation**
- If you want *safer-by-default governance*, consider:
  - restricting targets (allowlist),
  - restricting selectors (denylist `approve`, `setRoutingModuleDAO`, etc.) unless explicitly enabled,
  - enforcing a timelock for `ExternalCall` proposals,
  - requiring higher quorum/threshold for `ExternalCall`.

---

### [L-01] ETH transfers use `.call` and depend on recipients; failures revert proposal execution

**Where**
- `TemplBase.sol`: `_withdrawTreasury()` ETH path, `_sweepExternalRewardRemainder()` ETH path
- `TemplMembership.sol`: `claimExternalReward(address(0))`

**Issue**
ETH is sent via `.call{value: amount}("")` and reverts on failure. This is generally best practice, but it creates an availability risk: if governance selects a recipient contract that rejects ETH, execution reverts.

**Recommendation**
- Keep as-is if “all-or-nothing” is desired.
- If governance prefers progress, consider:
  - sending to a pull-payment escrow,
  - storing a credit balance and letting recipients withdraw,
  - or adding a “force send” option via `selfdestruct`-style patterns (less desirable in 0.8+ environments).

---

### [L-02] Factory permissioning is centralized in `factoryDeployer`

**Where**
- `TemplFactory.sol`: `setPermissionless`, `transferDeployer`

**Issue**
Creation permissions are controlled by a single `factoryDeployer` address. If compromised, an attacker can toggle permissionless mode or reroute deployer privileges. This is a protocol-level trust/ops risk, not a contract logic bug.

**Recommendation**
- Use a multisig for `factoryDeployer`.
- Consider a timelock for changing permissioning / deployer address.

---

## Informational notes / Good practices observed

- **Non-vanilla tokens are rejected** for transfers that must match exact amounts (`_safeTransferFrom` checks balance deltas). This is a good defense against fee-on-transfer / rebasing tokens.
- **Reentrancy guard** (`ReentrancyGuard`) is used on key externally-invokable flows (joins, rewards claim, proposal execute, withdrawals).
- **DAO-only gating** via `onlyDAO` using self-call semantics is a reasonable pattern to prevent direct external invocation of privileged actions.
- **External reward accounting** uses checkpoints and per-member snapshots, which is generally sound for pro-rata distribution.
- **Caps** exist for several potentially unbounded structures (e.g., external reward token count, curve segments, string lengths).

---

## Recommended follow-up testing

1) **Invariant tests** (Foundry/Echidna style):
   - total accessToken in contract >= memberPoolBalance (and related relationships),
   - proposal execution cannot be re-entered to execute twice,
   - joining cannot dilute previously accrued rewards incorrectly,
   - disbanding external tokens preserves `poolBalance + remainder` invariants.

2) **Upgrade/routing safety tests** (if routing remains mutable):
   - selector reassignment cannot break core invariants or corrupt storage,
   - roll-forward and roll-back scenarios.

3) **Worst-case gas profiling**
   - join with `externalRewardTokens.length == 256`,
   - proposal execution with `batchDAO` / `ExternalCall` patterns.

---

## Disclaimer

This is a static review of the provided code snapshot. No deployment configuration, off-chain governance process, or external dependencies (tokens, target contracts, UI) were audited. A full audit should also include threat modeling, tests, and (ideally) formal/invariant verification for the accounting logic.
