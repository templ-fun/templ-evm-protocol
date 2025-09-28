# templ.fun Protocol Audit Notes

## Scope & Approach
- Reviewed Solidity sources under `contracts/` with emphasis on deployment configuration (`TemplFactory`), governance/membership flows (`TemplBase`, `TemplMembership`, `TemplGovernance`, `TemplTreasury`), and supporting libraries.
- Inspected backend implementation in `backend/src` covering registration flows, persistence, and Telegram notifier scheduling.
- Skimmed frontend/service utilities to confirm alignment with backend contract expectations.
- Cross-referenced documentation in `docs/` to confirm behaviour matches written expectations.

## Findings

### 1. Daily digest resilience (backend)
- **Status:** Fixed. `sendDailyDigests` only advances `lastDigestAt` after a successful notification, so temporary Telegram outages no longer suppress the next attempt.【F:backend/src/server.js†L682-L701】

### 2. First-digest delay after deploy/restore
- **Status:** Fixed. Registrations and rebind restores seed `lastDigestAt` with `0`, ensuring the next scheduler cycle posts an immediate digest when a templ comes online.【F:backend/src/services/registerTempl.js†L55-L90】

### 3. Telegram chat id validation
- **Status:** Fixed. Registration rejects non-numeric chat identifiers so operators catch bad bindings before the notifier starts polling.【F:backend/src/services/registerTempl.js†L26-L43】

### 4. Disband join lock handling (contracts)
- **Status:** Fixed. Disband proposals still engage the join lock immediately, but the contract now releases it automatically once the voting window lapses or the proposal executes, preventing inactive proposals from freezing new memberships indefinitely.【F:contracts/TemplMembership.sol†L44-L46】【F:contracts/TemplGovernance.sol†L601-L646】【F:contracts/TemplGovernance.sol†L668-L687】

### 5. On-chain home link length
- **Status:** Deferred by design. Home-link strings remain unbounded on-chain; any future limits will be enforced in the Telegram notifier layer instead of the core contracts, consistent with product requirements.

## Additional Notes
- Contract accounting, quorum handling, and treasury flows continue to match the documented spec after the disband-lock improvements.
- Backend persistence still restores templ watchers, performs trusted factory validation, and now provides more robust notification behaviour out of the box.
