# Initial Production Audit

## Scope & Approach
- Reviewed Solidity contracts under `contracts/` with emphasis on membership joins, treasury flows, and governance execution.
- Audited backend Express service (`backend/src`) including registration, join verification, Telegram integration, and persistence helpers.
- Skimmed frontend service helpers to confirm signature generation and backend assumptions.
- Cross-referenced deployment/documentation guides for operational readiness.

## Findings

### High Severity
1. **Disband join lock can remain permanently engaged when execution reverts**
   - When a disband proposal reaches quorum the contract increments `activeDisbandJoinLocks` and flips `proposal.disbandJoinLock` so new memberships are blocked.【F:contracts/TemplGovernance.sol†L588-L619】
   - If execution later reverts (e.g., treasury already emptied) the proposal stays unexecuted but still counted as passed. `pruneInactiveProposals` only releases the lock when quorum was lost or the proposal had more NO than YES votes, so the lock never unwinds and `purchaseAccess` will revert forever.【F:contracts/TemplGovernance.sol†L570-L629】
   - **Impact:** New members can never join again even though the disband failed, effectively bricking the templ until a manual state intervention.
   - **Recommendation:** Always call `_releaseDisbandLock` when pruning an expired disband proposal, or broaden `_finalizeDisbandFailure` to release locks whenever execution did not succeed (e.g., `!proposal.executed`) regardless of the vote tally. Add regression coverage that simulates a quorumed disband whose execution reverts to ensure the lock clears.
   - **Status:** Fixed by releasing the disband lock whenever execution fails to complete and adding regression coverage for the revert path.【F:contracts/TemplGovernance.sol†L621-L628】【F:test/DisbandTreasury.test.js†L119-L155】

### Medium Severity
1. **Factory-origin verification may fail on hosted RPC providers**
   - `ensureTemplFromFactory` queries `provider.getLogs` without a `fromBlock`/`toBlock` range, relying on the default ("latest" for many providers). Providers such as Alchemy or Infura enforce a maximum block span; once the templ is older than that window the call will throw and block registrations even though the templ is legitimate.【F:backend/src/services/contractValidation.js†L74-L86】
   - **Recommendation:** Accept a configurable deployment block (env or DB) and call `getLogs({ fromBlock, toBlock: 'latest' })`, or fall back to binary search paging so verification works after long-lived deployments. Cache successes as today.
   - **Status:** Fixed by chunking log lookups with optional deployment block hints and covering pagination in unit tests.【F:backend/src/services/contractValidation.js†L8-L112】【F:backend/test/contractValidation.test.js†L1-L40】

### Low Severity
1. **Backend address normalisation only checks prefix/length**
   - `normaliseAddress` in both registration and join flows simply lowercases the string and checks for `0x` plus length 42, so values like `0xzz...` slip through until a downstream ethers call throws.【F:backend/src/services/registerTempl.js†L12-L20】【F:backend/src/services/joinTempl.js†L5-L13】
   - **Impact:** Bad input yields confusing 500/502 errors and prevents watchers from attaching, but it is easy to harden.
   - **Recommendation:** Replace the helper with `ethers.getAddress` (or `ethers.isAddress`) so validation fails fast and returns a clean 400.
   - **Status:** Fixed by reusing `ethers.getAddress` for address normalisation across services with dedicated tests for malformed inputs.【F:backend/src/services/registerTempl.js†L1-L26】【F:backend/test/services.test.js†L1-L28】

## Operational Readiness
- Follow the deployment checklist before first launch: run contract/back/frontend tests, set `REQUIRE_CONTRACT_VERIFY=1`, configure `TRUSTED_FACTORY_ADDRESS`, and provision Telegram + persistent DB secrets as documented.【F:docs/DEPLOYMENT_GUIDE.md†L162-L179】
- After addressing the findings above, rerun `npm run test:all` (or the per-package suites) to confirm regression coverage, then document the disband failure scenario in runbooks so operators can triage quickly.

## Next Steps
1. Patch the disband lock release logic and add automated coverage.
2. Harden factory verification for long-lived chains.
3. Tighten backend address validation and expand error messaging.
4. Execute the production checklist (envs, tests, bot binding) ahead of the initial templ launch.
