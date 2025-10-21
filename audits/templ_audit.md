# templ.fun Smart Contract Audit

## Summary
- **Scope:** Full review of the TEMPL router and its membership, treasury, and governance modules, plus the factory deployment path.
- **Findings:** No critical, high, or medium severity issues identified. One defense-in-depth test was added to ensure external reward cleanup cannot be abused to resurrect stale claims.
- **Testing:** `npm test` (Hardhat) with the full suite.

## Architecture Notes
- Membership joins enforce `nonReentrant`, pause controls, and fee splits before crediting treasury or protocol balances, preventing reentrancy and quota bypass attacks during `_join` flows.【F:contracts/TemplMembership.sol†L15-L120】
- External reward claims snapshot cumulative payouts and prevent access token reuse, so stale snapshots cannot be replayed after a token is deregistered.【F:contracts/TemplMembership.sol†L200-L222】
- Treasury disbands register external tokens lazily and sync reward checkpoints while capping remainders, ensuring members share donations fairly and that governance cannot leak funds by undercounting pool balances.【F:contracts/TemplBase.sol†L954-L1005】

## Threat Modeling
- **Reentrancy:** Guarded at the module entry points (`join`, reward claims, proposal execution) through `ReentrancyGuard` inheritance, and token interactions rely on `_safeERC20Call` to bubble errors.
- **Governance capture:** Dictatorship mode only allows priest-controlled actions, yet DAO proposals can still disable it, requiring quorum and YES majority to execute configuration changes.
- **Treasury drains:** Withdrawals and disbands enforce available balance checks against both tracked treasury amounts and outstanding member pools, limiting double-spend vectors.

## Additional Testing
- Added `prevents legacy claims after cleanup when external rewards are re-registered` to confirm that once an external reward token is cleaned up, fresh distributions do not leak previously claimed balances to legacy members or newcomers. This test walks through cleanup, new membership, and redistribution to validate snapshot hygiene.【F:test/DisbandTreasury.test.js†L372-L442】

## Recommendations
- Maintain careful monitoring of external reward token lists; while cleanup is permissionless, the added test demonstrates the registry remains safe to reuse without wiping historical snapshots.
- Continue to run the full Hardhat suite before deployments; it exercises 276 scenarios including the new regression.

## Tests Executed
- `npm test`
