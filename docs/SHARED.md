# Shared Utilities

Use this doc to understand the JavaScript helpers under `shared/` that both the backend and frontend rely on. Everything is published as ESM-friendly plain JS so Node, Vite, and tests can import the same implementation.

## Modules

### signing.js

- Builds EIP-712 payloads (`buildCreateTypedData`, `buildJoinTypedData`, `buildRebindTypedData`) plus the lower-level `buildTemplTypedData` helper shared across actions.
- Normalises the `server` field via `readTemplEnv` so signatures bind to the configured `BACKEND_SERVER_ID` / `VITE_BACKEND_SERVER_ID`.
- Covered by `shared/signing.test.js` (runs under Node’s test runner and through the backend test suite).

### debug.js

- Exposes environment helpers used across packages: `isTemplDebugEnabled`, `isTemplE2EDebug`, `isTemplTestEnv`, `readTemplEnv`.
- Ensures the backend, frontend, and tests agree on how debug flags behave.

### linkSanitizer.js

- Provides `sanitizeLink(value, opts)` for validating templ home links across the stack.
- Accepts only whitelisted URI schemes (`https`, `http`, `tg` by default) and strips control characters before rendering.
- Used by the backend notifier and frontend chat drawer to prevent unsafe links from reaching Telegram or the UI.

### xmtp.js

- Shared XMTP helpers (`syncXMTP`, `waitForConversation`) used by the backend join service, the frontend chat client, Playwright flows, and Node demos.
- Applies debug-aware retry limits so local, dev, and production environments behave uniformly while allowing shorter loops in `VITE_E2E_DEBUG` mode.

### xmtp-wait.js

- Implements a generic `waitFor({ tries, delayMs, check })` utility with retry/backoff semantics.
- Imported by `xmtp.js` and the backend XMTP bootstrap code to linearise long-running readiness probes.

## Testing

`shared/signing.test.js` validates typed-data outputs. The backend test command (`npm --prefix backend test`) imports it automatically so regressions fail CI. Other helpers are covered indirectly through backend integration tests and the frontend’s XMTP harness.

## Usage tips

- Always call the shared typed-data builders before hitting backend endpoints. The backend uses the exact same helpers to verify payloads, so skewing field names or defaults will immediately surface as signature errors.
- Prefer `readTemplEnv` for cross-env configuration instead of hand-rolled `process.env` reads in new modules.
