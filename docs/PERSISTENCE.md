# Persistence

Use this doc to see where templ persists data: what lives on-chain, what the backend stores in SQLite, and what the frontend keeps ephemeral.

## Contracts

On-chain storage lives inside each templ and the factory. See `contracts/` for specifics.

## Backend

The backend persists a single table in SQLite (via `better-sqlite3`):

| Table | Columns | Purpose |
| --- | --- | --- |
| `templ_bindings` | `contract TEXT PRIMARY KEY`, `telegramChatId TEXT UNIQUE` | Durable mapping between templ contracts and optional Telegram chats so the notifier survives restarts. `telegramChatId` remains `NULL` until a binding completes. |

Signature replay protection and other runtime metadata live purely in memory—bindings, priests, home links, and proposal caches are refreshed from the contract whenever needed. Event cursors are not stored; after a restart the backend simply reattaches its watchers and streams newly emitted events. Deleting the SQLite file is safe in development; production deployments should back up the bindings alongside other app state.

## Frontend

The SPA relies on factory reads (via ethers.js) and backend APIs for state. `localStorage` usage is limited to E2E/testing helpers that remember recently deployed templ addresses; production flows do not persist app data locally. Wallet connections and provider instances come from the injected `window.ethereum` context (or the optional `VITE_RPC_URL`).
