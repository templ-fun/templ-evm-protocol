# Shared Utilities

> Shared JavaScript helpers that keep the backend, frontend, and contract tests aligned on signing formats and XMTP orchestration.

## Why this toolkit matters

- Understand which utilities are safe to reuse across packages without bundler tweaks.
- See how EIP-712 builders and XMTP polling helpers stay in sync with backend validation.
- Learn the minimal testing surface that guards the shared layer.

The `shared/` directory centralises logic that would otherwise be duplicated across packages. Modules are authored as ESM-compatible plain JS so they can be imported from Node, bundled for the browser, or exercised in tests without transpilation.

## At a glance

- EIP-712 builders keep typed signatures uniform for `/templs`, `/join`, `/delegateMute`, and `/mute`.
- XMTP polling helpers abstract readiness checks and consent-state updates across environments.
- Tests run under either Vitest or Node’s built-in runner to ensure the helpers stay deterministic.

## Modules

Below are the core utilities shared across the stack:

### signing.js

- Builds typed-data payloads via a single `buildTemplTypedData` helper. Action-specific wrappers (`buildCreateTypedData`, `buildJoinTypedData`, etc.) call into it so schema changes stay centralised.
- Normalises the `server` field so signatures bind to `BACKEND_SERVER_ID`/`VITE_BACKEND_SERVER_ID`, falling back to `templ-dev` when unset.
- Exposes legacy string builders (`buildDelegateMessage`, `buildMuteMessage`) for compatibility with older mocks.
- Covered by `shared/signing.test.js`, which now exercises both typed payloads and legacy strings under Vitest or Node’s test runner.

#### Usage tips

- Always pass the actual `chainId`; the backend rejects mismatched domains.
- Reuse these builders in UI flows so future schema changes are automatically adopted.

### xmtp.js

- Provides `syncXMTP` to keep conversations and preferences current between retries.
- Offers `waitForConversation` to poll until an XMTP group appears, normalising IDs with or without the `0x` prefix.
- Respects debug shortcuts (`VITE_E2E_DEBUG=1`, `DEBUG_TEMPL=1`) to shorten retries and emit verbose logs in test runs.

### debug.js

- Centralises environment detection helpers used across packages (`isTemplDebugEnabled`, `isTemplE2EDebug`, `readTemplEnv`).
- Keeps backend, frontend, and tests aligned on how debug flags and fallbacks behave.

### xmtp-wait.js

- Lightweight polling helper (`waitFor`) used by both services to cap retry attempts and surface per-attempt errors when desired.

## Tests

- `shared/signing.test.js` exercises the typed-data builders and legacy string helpers. It runs exclusively under Node’s built-in test runner or Vitest; Hardhat/Mocha is not supported.
- Run with `node --test shared/signing.test.js` for the built-in runner, or `npm --prefix frontend test -- shared/signing.test.js` to execute it through Vitest.

---

## Next

Explore [PERSISTENCE.md](./PERSISTENCE.md) for a full map of where data lives across SQLite and XMTP stores.
