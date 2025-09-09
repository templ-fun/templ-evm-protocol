# TEMPL

[![CircleCI](https://dl.circleci.com/status-badge/img/gh/MarcoWorms/templ/tree/main.svg?style=svg&circle-token=CCIPRJ_MhZ5NbNKhpfEAwFSEGDkUH_61036d1e9e936102be414dfd8d86a9318181746a)](https://dl.circleci.com/status-badge/redirect/gh/MarcoWorms/templ/tree/main)
[![coverage](https://codecov.io/github/MarcoWorms/templ/graph/badge.svg?token=M8SPKQX6UD)](https://codecov.io/github/MarcoWorms/templ)


DAO‑governed token‑gated private groups with onchain treasury management and XMTP messaging

<p align="center">
<img width="300" alt="TEMPL logo" src="https://github.com/user-attachments/assets/fa3513b4-75e4-4dbf-a1fb-73e9e27d766f" />
</p>
<p align="center">
<a href="https://templ.fun">TEMPL.fun</a>
</p>

## Architecture

A TEMPL combines three pieces:
- **Smart contracts** on Base gate membership with `purchaseAccess`.
- **Backend bot** owns the XMTP group and invites paid wallets.
- **React frontend** deploys contracts, verifies purchases and hosts chat.
The frontend buys access and requests an invite; the backend can mirror contract events in chat.

```mermaid
sequenceDiagram
    participant Frontend
    participant Backend
    participant Contracts

    Frontend->>Contracts: purchaseAccess()
    Frontend->>Backend: requestInvite()
    Contracts-->>Backend: Purchase event
    Backend-->>Frontend: Invite & updates
```

## Documentation
Use the docs below to dive into each component:

- [CORE_FLOW_DOCS.MD](./CORE_FLOW_DOCS.MD) – core flow service diagrams
- [CONTRACTS.md](./CONTRACTS.md) – smart‑contract specification
- [BACKEND.md](./BACKEND.md) – XMTP bot and API
- [FRONTEND.md](./FRONTEND.md) – React client
- [PERSISTENCE.md](./PERSISTENCE.md) – data storage and XMTP DBs
- [WEB3_AUDIT_REPORT.MD](./WEB3_AUDIT_REPORT.MD) – web3 audit summary
 - [TEST_LOCALLY.md](./TEST_LOCALLY.md) – fast local end‑to‑end setup
  
## Monorepo Structure
- `contracts/` – Hardhat + Solidity 0.8.23
- `backend/` – Node service with XMTP bot and HTTP API
- `frontend/` – Vite + React demo app with Playwright e2e
- `shared/` – JS utilities shared by backend and frontend
- `deployments/` – network-specific contract records
- `scripts/` – Hardhat deployment and utility scripts
- `test/` – Hardhat contract tests
- `artifacts/` – compiled contract artifacts
- `cache/` – Hardhat compilation cache

## Quick Start
1. **Install**
   Install all dependencies; running `npm install` in the repo root pulls in contract packages:
   ```bash
   npm install
   npm --prefix backend install
   npm --prefix frontend install
   ```

2. **Test**
   Run the full suite locally:
   ```bash
   npm run test:all
   ```

   See component docs for individual commands.

3. **Run**
   Start the backend and frontend services:
   ```bash
   npm --prefix backend start
   npm --prefix frontend run dev
   ```
   The backend expects environment variables like `BOT_PRIVATE_KEY`, `RPC_URL`, and `ALLOWED_ORIGINS` in `backend/.env`. See [BACKEND.md](./BACKEND.md) and [FRONTEND.md](./FRONTEND.md) for details.

## Environment Variables

Minimal local setup requires only a handful of variables:

| Variable | Description | Location |
| --- | --- | --- |
| `RPC_URL` | RPC endpoint for Base network | `.env`, `backend/.env` |
| `PRIVATE_KEY` | Deployer wallet key for contract deployments | `.env` |
| `BOT_PRIVATE_KEY` | XMTP invite-bot wallet key (auto-generated if omitted) | `backend/.env` |
| `ALLOWED_ORIGINS` | Comma-separated frontend origins allowed to call the backend | `backend/.env` |
| `BACKEND_DB_ENC_KEY` | 32-byte hex key to encrypt XMTP Node DB (overrides derived key) | `backend/.env` |
| `EPHEMERAL_CREATOR` | Use a fresh, throwaway key to create groups (default) | `backend/.env` |
| `XMTP_BOOT_MAX_TRIES` | Max boot retries for XMTP client initialization | `backend/.env` |
| `REQUIRE_CONTRACT_VERIFY` | When `1` or in production, backend verifies contract code and on‑chain priest | `backend/.env` |
| `XMTP_METADATA_UPDATES` | Set to `0` to skip name/description updates on XMTP groups | `backend/.env` |
| `BACKEND_SERVER_ID` | String identifier bound into EIP‑712 signatures (must match frontend’s `VITE_BACKEND_SERVER_ID`) | `backend/.env` |

See [BACKEND.md#environment-variables](./BACKEND.md#environment-variables) and [CONTRACTS.md#configuration](./CONTRACTS.md#configuration) for complete lists.

## Deploying to production
1. Create a `.env` file in the project root for deployment scripts and a `backend/.env` for the bot. Required variables are documented in [CONTRACTS.md#configuration](./CONTRACTS.md#configuration) and [BACKEND.md#environment-variables](./BACKEND.md#environment-variables).
2. Run the full test suite and Slither analysis.
3. Deploy with `scripts/deploy.js` and record the contract address and XMTP group ID.
4. Host the backend bot and set `ALLOWED_ORIGINS` to the permitted frontend URL(s). In production, contract address is verified on‑chain and the `priest` address must match the deployed contract.
5. Build the frontend (`npm --prefix frontend run build`) and serve the static files.

### Production Configuration
- Set `NODE_ENV=production` for the backend. In this mode, signature bypass headers are disabled and `/templs` chain/priest checks are enforced when `REQUIRE_CONTRACT_VERIFY=1` (recommended).
- Provide `BACKEND_DB_ENC_KEY` (32‑byte hex). The backend will refuse to boot without it in production.
- If `BOT_PRIVATE_KEY` is omitted, the backend generates one and stores it in the SQLite DB (table `kv`, key `bot_private_key`) so the invite-bot identity remains stable.
- Bind signatures to your deployment by setting a shared server id:
  - Backend: `BACKEND_SERVER_ID="templ-prod-<region>"`
  - Frontend: `VITE_BACKEND_SERVER_ID="templ-prod-<region>"`
  These values are included in the EIP‑712 messages and must match; this prevents signatures from being replayed against a different server.
-
Do not use test‑only flags in production (`x-insecure-sig` header, `DISABLE_XMTP_WAIT`).

## Core flows

High‑level sequence for deploying, joining, and messaging (see [CORE_FLOW_DOCS.MD](./CORE_FLOW_DOCS.MD) for full diagrams):

```mermaid
sequenceDiagram
    participant F as Frontend
    participant C as Contract
    participant B as Backend
    participant X as XMTP

    Note over F: deployTempl
    F->>C: deployTempl()
    C-->>F: contract address
    F->>B: POST /templs {contract}
    B->>X: newGroup
    B-->>F: {groupId}

    Note over F: purchaseAndJoin
    F->>C: purchaseAccess()
    C-->>F: membership granted
    F->>B: POST /join
    B->>X: addMembers
    B-->>F: {groupId}

    Note over F: messaging
    F->>X: send message
    X-->>F: receive message
```

Core flows include TEMPL creation, paid onboarding, chat, moderation, proposal drafting, voting, and execution.

## Security & Hardening

- Contracts
  - Proposal execution is restricted to an allowlist of safe DAO actions; arbitrary external calls are disabled.
  - Governance is simplified to only three actions: move treasury (withdraw treasury token), pause/unpause joining, and reprice the entry fee. Token changes are disabled.
  - Voting is one member‑one vote; proposer auto‑YES, votes are changeable until deadline; anti‑flash rule enforces join before proposal.
  - Footgun mitigated: sweeping the member pool and arbitrary token/ETH withdrawals are no longer supported by governance. The DAO can only move the TEMPL treasury (the access token accounted in `treasuryBalance`).
- Backend API
  - EIP‑712 typed signatures must include `{ action, contract, nonce, issuedAt, expiry, chainId, server }`.
  - Bind signatures to your deployment by setting a shared server id: `BACKEND_SERVER_ID` and `VITE_BACKEND_SERVER_ID` must match.
  - Server enforces replay protection (SQLite `signatures` table). In production (or when `REQUIRE_CONTRACT_VERIFY=1`), the server verifies contract code, chainId, and that on‑chain `priest()` equals the signing address on `/templs`.
  - Debug endpoints are disabled by default; when enabled, they are restricted to localhost.
  - CORS must be set via `ALLOWED_ORIGINS` for standalone deployments.
  - Rate‑limit store defaults to in‑memory; optionally use Redis via `RATE_LIMIT_STORE=redis`.
- Identity resolution
  - The backend resolves XMTP inboxIds server‑side and waits for visibility before inviting. Client‑supplied inboxIds are ignored in normal environments. In local/test fallback modes (e.g., E2E), if network resolution is unavailable the server may deterministically accept a provided inboxId or generate one to keep tests moving.
- Data at rest
  - XMTP Node DB is SQLCipher‑encrypted; provide `BACKEND_DB_ENC_KEY` (32‑byte hex). The server refuses to boot without it in production.
  - Browser DB lives in OPFS (not encrypted); avoid multiple clients per page to prevent access‑handle contention.
- Operational notes
  - Do not use test‑only shortcuts in production (e.g., `x-insecure-sig` header, `DISABLE_XMTP_WAIT`).
  - XMTP dev network caps installs at 10 per inbox and ~256 total actions; tests rotate wallets or reuse local DBs to avoid the cap.
  - RPC responses are assumed honest; use a trusted provider.
  - For auditors: see CONTRACTS.md for custom errors, events, invariants, fee splits, and DAO constraints. CI runs tests and Slither.


## E2E Environments
- Default: XMTP dev
  - Playwright sets `XMTP_ENV=dev` for backend and `VITE_XMTP_ENV=dev` for frontend by default. Override with `E2E_XMTP_ENV=production` if you want to target production.
- Local XMTP: set `E2E_XMTP_LOCAL=1`
  - Playwright starts `xmtp-local-node`, sets `XMTP_ENV=local` and `VITE_XMTP_ENV=local`
  - Local-only repro tests are enabled

## Debug Endpoints (backend)
- Requires `ENABLE_DEBUG_ENDPOINTS=1` on the backend.
- `GET /debug/group?contractAddress=<addr>&refresh=1`
- `GET /debug/conversations`
- `GET /debug/membership?contractAddress=<addr>&inboxId=<id>`
- `GET /debug/last-join`
- `GET /debug/inbox-state?inboxId=<id>&env=production`

## Troubleshooting test:all
- If backend tests appear to “hang”, ensure network gating isn’t blocking. The backend skips XMTP readiness checks in test mode by default. You can also set `DISABLE_XMTP_WAIT=1` for the backend during tests.
- For e2e, ensure ports 8545/3001/5179 are free.
