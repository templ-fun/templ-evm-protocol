# Persistence

Use this doc to see where templ persists data: what lives on-chain, what the backend stores in SQLite, and what the frontend keeps ephemeral.

## Contracts

On-chain storage lives inside each templ and the factory. See `contracts/` for specifics.

## Backend

The backend persists lightweight metadata in SQLite (via `better-sqlite3`). Tables of interest:

| Table | Columns | Purpose |
| --- | --- | --- |
| `groups` | `contract TEXT PRIMARY KEY`, `groupId TEXT`, `priest TEXT`, `homeLink TEXT` | Stores registered templs. `groupId` holds the Telegram chat id and `homeLink` mirrors the on-chain templ home link. |
| `signatures` | `sig TEXT PRIMARY KEY`, `usedAt INTEGER` | Tracks signatures used for `/templs` and `/join` to prevent replay. |

Beyond SQLite (or the `BACKEND_USE_MEMORY_DB=1` in-memory fallback), the backend keeps an in-memory cache per templ (proposal metadata, quorum/voting flags, home link, last digest timestamp) so Telegram notifications remain deterministic without widening the persisted schema.

All routes read/write through the same DAO helpers so in-memory caches and the database stay in sync. Deleting the SQLite file is safe in development; production deployments should back it up alongside other app state.

## Frontend

The SPA relies on factory reads (via ethers.js) and backend APIs for state. `localStorage` usage is limited to E2E/testing helpers that remember recently deployed templ addresses; production flows do not persist app data locally. Wallet connections and provider instances come from the injected `window.ethereum` context (or the optional `VITE_RPC_URL`).
