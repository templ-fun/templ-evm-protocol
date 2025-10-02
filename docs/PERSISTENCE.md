# Persistence

Use this doc to see where templ persists data: what lives on-chain, what the backend stores in SQLite, and what the frontend keeps ephemeral.

## Contracts

On-chain storage lives inside each templ and the factory. See `contracts/` for specifics.

## Backend

The backend persists three tables in SQLite:

| Table | Columns | Purpose |
| --- | --- | --- |
| `templ_bindings` | `contract TEXT PRIMARY KEY`, `telegramChatId TEXT UNIQUE`, `priest TEXT`, `bindingCode TEXT` | Durable mapping between templ contracts and optional Telegram chats so the notifier survives restarts. `telegramChatId` remains `NULL` until a binding completes; `bindingCode` stores pending binding snippets and survives restarts; the last-seen priest address is stored to speed up watcher restores. |
| `used_signatures` | `signature TEXT PRIMARY KEY`, `expiresAt INTEGER` | Replay protection for typed requests (`/templs`, `/templs/rebind`, `/join`). Entries expire after ~6 hours and fall back to the in-memory store only when the persistent database is unavailable. |
| `leader_election` | `id TEXT PRIMARY KEY`, `owner TEXT NOT NULL`, `expiresAt INTEGER NOT NULL` (plus `idx_leader_election_expires`)| Coordinates which backend instance acts as the leader when multiple replicas share the same persistence binding. Each process competes to write a `primary` row with a configurable TTL (`LEADER_TTL_MS`); the active leader keeps contract watchers and scheduled background tasks running while followers stay idle. |

No member wallet addresses, signature payloads, or join histories are persisted beyond replay protection metadata; membership checks always query the contract directly so the registry stays templ-scoped.

Bindings, priests, home links, and proposal caches are refreshed from the contract whenever needed. Event cursors are not stored; after a restart the backend reattaches its watchers and streams newly emitted events. Production deployments should mount SQLite on durable storage (for example a Fly volume) so the binding tables and replay history survive restarts.

Leader election only comes into play when more than one backend instance points at the same persistence layer. Single-instance deployments (including the default in-memory adapter) effectively assume leadership immediately, while multi-instance deployments rely on the shared table to ensure only one node runs watchers and background jobs at a time.

## Frontend

The SPA relies on factory reads (via ethers.js) and backend APIs for state. `localStorage` usage is limited to E2E/testing helpers that remember recently deployed templ addresses; production flows do not persist app data locally. Wallet connections and provider instances come from the injected `window.ethereum` context (or the optional `VITE_RPC_URL`).
