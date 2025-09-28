# templ.fun Protocol Audit Notes

## Scope & Approach
- Reviewed Solidity sources under `contracts/` with emphasis on deployment configuration (`TemplFactory`), governance/membership flows (`TemplBase`, `TemplMembership`, `TemplGovernance`, `TemplTreasury`), and supporting libraries.
- Inspected backend implementation in `backend/src` covering registration flows, persistence, and Telegram notifier scheduling.
- Skimmed frontend/service utilities to confirm alignment with backend contract expectations.
- Cross-referenced documentation in `docs/` to confirm behaviour matches written expectations.

## Findings

### 1. Daily digest failures suppress future retries (backend)
- `sendDailyDigests` updates `record.lastDigestAt = now` inside the `catch` clause when Telegram delivery fails, so a transient API outage blocks reminders for the full 24‑hour window instead of retrying soon after recovery.【F:backend/src/server.js†L678-L699】
- Recommendation: only advance `lastDigestAt` after a successful send, or shorten the retry interval when a failure occurs so members still get a digest the same day.

### 2. New or restored templs wait a full day for the first digest (backend)
- Fresh registrations and persistence restores initialise `lastDigestAt` with `Date.now()`, meaning communities must wait 24 hours before the notifier attempts the first "gm" message after a deploy or restart.【F:backend/src/services/registerTempl.js†L55-L90】【F:backend/src/server.js†L600-L639】
- Recommendation: seed `lastDigestAt` far enough in the past (or `0`) so the next scheduler run emits an immediate digest, satisfying the docs’ expectation that daily summaries resume promptly after restarts.

### 3. Telegram chat identifiers accept arbitrary strings (backend)
- `normaliseChatId` only trims the provided value; non-numeric strings or obviously invalid IDs still persist and the notifier later attempts to post to them, causing avoidable Telegram API errors.【F:backend/src/services/registerTempl.js†L26-L40】
- Recommendation: validate chat IDs match Telegram’s numeric formats (including negative IDs for supergroups) before persisting so broken bindings are rejected early.

### 4. Home-link strings are unbounded on-chain (contracts/backend)
- Deployers can supply arbitrarily large `homeLink` values when calling `TemplFactory`, which are then stored on-chain and forwarded to Telegram without length checks.【F:contracts/TemplFactory.sol†L114-L142】【F:contracts/TemplBase.sol†L334-L341】【F:backend/src/telegram.js†L205-L240】
- Oversized links inflate deployment costs and can exceed Telegram’s message limits even after sanitisation. Imposing a reasonable max length (e.g. 256 bytes) would keep notifications reliable while preserving flexibility.

## Additional Observations
- Contract-side accounting, quorum handling, and treasury flows align with the documented spec; no critical deviations were detected during review.
- Backend persistence correctly reloads templ watchers and performs trusted factory verification when configured; the main reliability risk is confined to the digest scheduler noted above.
- Frontend services rely on backend validation for signatures and contract origin; no direct issues were spotted in the SPA for the reviewed flows.

## Suggested Next Steps
1. Patch the notifier scheduler to retry failed digests promptly and to send an initial digest soon after bootstrapping a templ.
2. Harden chat-id parsing to reject malformed inputs at registration time.
3. Enforce a maximum `templHomeLink` length in both the factory deployment path and backend updates.

Addressing the above will improve operational resilience (notifications) and reduce the risk of user misconfiguration affecting downstream services.
