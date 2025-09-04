# TEMPL

DAO‑governed token‑gated private groups with onchain treasury management and XMTP messaging

<p align="center">
<img width="300" alt="TEMPL logo" src="https://github.com/user-attachments/assets/fa3513b4-75e4-4dbf-a1fb-73e9e27d766f" />
</p>
<p align="center">
<a href="https://templ.fun">TEMPL.fun</a>
</p>

## Architecture

A TEMPL is composed of three parts that work together:

- **Smart contracts** on Base gate access by requiring a paid `purchaseAccess` call.
- **Backend bot** owns the XMTP group and only invites wallets that purchased.
- **React frontend** deploys contracts, verifies purchases and lets members chat.

The frontend calls the contract to purchase membership, then asks the backend to invite
the wallet into the group. The backend can also watch contract events and forward
proposal or vote updates to the chat.

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
   ```bash
   npm --prefix contracts install
   npm --prefix backend install
   npm --prefix frontend install
   ```

2. **Test**  
   Run the full suite:
   ```bash
   npm run test:all
   ```
   Component-specific test commands are documented in [CONTRACTS.md](./CONTRACTS.md), [BACKEND.md](./BACKEND.md), and [FRONTEND.md](./FRONTEND.md).

3. **Run**  
   Start the backend and frontend services. Deployment and runtime details are available in [CONTRACTS.md](./CONTRACTS.md), [BACKEND.md](./BACKEND.md), and [FRONTEND.md](./FRONTEND.md).

## Environment Variables

Minimal local setup requires only a handful of variables:

| Variable | Description | Location |
| --- | --- | --- |
| `RPC_URL` | RPC endpoint for Base network | `.env`, `backend/.env` |
| `PRIVATE_KEY` | Deployer wallet key for contract deployments | `.env` |
| `BOT_PRIVATE_KEY` | XMTP bot wallet key | `backend/.env` |
| `ALLOWED_ORIGINS` | Comma-separated frontend origins allowed to call the backend | `backend/.env` |

See [BACKEND.md#environment-variables](./BACKEND.md#environment-variables) and [CONTRACTS.md#configuration](./CONTRACTS.md#configuration) for complete lists.

## Deploying to production
See [BACKEND.md#environment-variables](./BACKEND.md#environment-variables) and [CONTRACTS.md#configuration](./CONTRACTS.md#configuration) for descriptions of required configuration.
1. Create a `.env` file in the project root for the deployment scripts. This file is distinct from `backend/.env` used by the bot; copy any overlapping variables (e.g., `RPC_URL`, keys) into `backend/.env` if the bot requires them. The bot's key (`BOT_PRIVATE_KEY`) belongs only in `backend/.env`. The deploying wallet becomes the priest automatically, so `PRIEST_ADDRESS` is only needed when overriding in tests.
    ```env
    PROTOCOL_FEE_RECIPIENT=0x...
    TOKEN_ADDRESS=0x...
    ENTRY_FEE=100000000000000000 # wei
    RPC_URL=https://mainnet.base.org
    PRIVATE_KEY=0x...
    PRIEST_VOTE_WEIGHT=10
    PRIEST_WEIGHT_THRESHOLD=10
    BASESCAN_API_KEY=...
    ```
   See [`CONTRACTS.md`](./CONTRACTS.md) for the full list of supported variables.
2. Run the full test suite and Slither analysis.
3. Deploy with `scripts/deploy.js` and record the contract address and XMTP group ID.
4. Host the backend bot (e.g., on a VM) using the contract address and bot key. Ensure
   `backend/.env` sets `ALLOWED_ORIGINS` to the frontend URL(s) permitted to call the API.
5. Build the frontend (`npm --prefix frontend run build`) and serve the static files.

## Core flows

High‑level sequence for deploying, joining, and messaging:

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

Core flows cover **TEMPL creation** with contract deployment and a private XMTP group, pay‑to‑join onboarding where `purchaseAccess` triggers an invitation, ongoing group messaging, priest‑controlled muting with escalating durations, proposal drafting for allowlisted actions with backend rebroadcasts, live yes/no voting, and atomic execution of passing proposals.

Full diagrams are in [CORE_FLOW_DOCS.MD](./CORE_FLOW_DOCS.MD).

## Security considerations

- Proposal execution is restricted to an allowlist of safe DAO actions; arbitrary external calls are disabled.
 - The backend owns the XMTP group. The priest does not control membership directly; actions are mediated via the backend’s bot, which verifies on‑chain purchase. See BACKEND.md for API auth and rate‑limit details.
 - XMTP dev network has a 10‑installation limit per inbox and 256 total actions limit per inbox (install and revoke each count as 1 action). Tests rotate wallets or reuse local XMTP databases to avoid hitting this limit.
 - For auditors: CONTRACTS.md documents all custom errors, events, invariants, fee splits, and DAO constraints. The Hardhat test suite covers these invariants; Slither reports are part of CI.


## E2E Environments
- Default: XMTP production
  - Playwright sets `XMTP_ENV=production` for backend, `VITE_XMTP_ENV=production` for frontend
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
