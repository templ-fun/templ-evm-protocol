# Persistence

Use this doc to see where templ persists data: what lives on-chain, what the backend stores in Cloudflare D1, and what the frontend keeps ephemeral.

## Contracts

On-chain storage lives inside each templ and the factory. See `contracts/` for specifics.

## Backend

The backend persists two tables in Cloudflare D1 (exposed locally through an in-memory adapter for tests):

| Table | Columns | Purpose |
| --- | --- | --- |
| `templ_bindings` | `contract TEXT PRIMARY KEY`, `telegramChatId TEXT UNIQUE`, `priest TEXT`, `bindingCode TEXT` | Durable mapping between templ contracts and optional Telegram chats so the notifier survives restarts. `telegramChatId` remains `NULL` until a binding completes; `bindingCode` stores pending binding snippets and survives restarts; the last-seen priest address is stored to speed up watcher restores. |
| `used_signatures` | `signature TEXT PRIMARY KEY`, `expiresAt INTEGER` | Replay protection for typed requests (`/templs`, `/templs/rebind`, `/join`). Entries expire after ~6 hours and fall back to the in-memory store only when D1 is unavailable. |

Bindings, priests, home links, and proposal caches are refreshed from the contract whenever needed. Event cursors are not stored; after a restart the backend reattaches its watchers and streams newly emitted events. Cloudflare D1 automatically provides durability in production. Local development can rely on the provided in-memory adapter, but production deployments should provision a D1 database to keep bindings and signature history across restarts.

## Frontend

The SPA relies on factory reads (via ethers.js) and backend APIs for state. `localStorage` usage is limited to E2E/testing helpers that remember recently deployed templ addresses; production flows do not persist app data locally. Wallet connections and provider instances come from the injected `window.ethereum` context (or the optional `VITE_RPC_URL`).
