# templ.fun

Templ turns any ERC-20 into a gated club with on-chain economics. Holders deploy their own templ, charge newcomers an entry fee, run proposals, and split every tribute between burn, treasury, member rewards, and protocol upkeep. Telegram alerts sourced from on-chain events keep members synced without embedding chat in the app.

## TL;DR

- Deploy a templ from a factory, set the fee split, and start admitting members who pay the entry fee in the access token.
- One-member/one-vote governance drives pause/config/withdraw/disband/priest/cap/dictatorship/home-link actions.
- Optional Telegram notifications mirror joins/proposals/votes/quorum and daily digests; no chat secrets touch the chain.
- Frontend is static (Vite + React); backend is a long-lived Express service; contracts are Solidity 0.8.23.

## Architecture

```mermaid
sequenceDiagram
    autonumber
    participant M as Member
    participant F as Frontend (React)
    participant C as TEMPL Contract
    participant B as Backend (Express)
    participant T as Telegram Bot
    M->>F: Deploy templ / initiate join flow
    F->>C: Factory + templ transactions
    C-->>F: Contract address / receipts
    F->>B: Signed POST /templs or /join payloads
    B->>C: Read priest() / hasAccess()
    C-->>B: On-chain state + events
    B->>T: Text alerts (joins, proposals, quorum, votes, digests)
    T-->>M: Telegram notifications with deep links
```

Reference diagrams live in [`docs/CORE_FLOW_DOCS.MD`](docs/CORE_FLOW_DOCS.MD).

## Components

- **Contracts** – Solidity 0.8.23 factory + templ modules (see `contracts/`). Features: configurable entry-fee splits (burn/treasury/member/protocol), auto-enrolment of the deploying priest (so the first paid member pool accrues to them), an on-chain home link for off-chain surfaces, and a typed governance router (pause/config/withdraw/disband/priest/cap/dictatorship/home-link). Disband proposals never pause membership—only explicit governance pauses or member caps stop new joins. External reward enumeration is capped at 256 tokens, and anyone can call `cleanupExternalRewardToken(token)` once balances are settled to free a slot. Fee accounting assumes standard ERC-20 transfers; taxed tokens are unsupported.
- **Backend API + Telegram bot** – Node 22/Express service that expects a long-lived runtime (Render, Fly, Railway, bare metal, etc.). It persists templ metadata in Cloudflare D1 (or the in-memory fallback), verifies signatures, confirms membership, and streams contract events to a Telegram group via a bot token. Leader election (backed by D1 when available) ensures exactly one instance emits notifications at a time.
- **Frontend** – Vite + React single-page app for deploying templs, joining with proof-of-purchase, raising proposals (with on-chain title/description), and casting votes. The landing page pulls templ deployments directly from the configured factory (and merges Telegram metadata from the backend) so every community is one click away. The bundle is static; production builds ship via Cloudflare Pages (edge-cached, zero-idle hosting).

Routes served by the SPA:

| Route | Purpose |
| --- | --- |
| `/` | Dashboard, wallet connection, and templ directory sourced from the configured factory (enriched with backend Telegram metadata). |
| `/templs/create` | Deploy a templ and register it (optional Telegram chat id). |
| `/templs/join` | Purchase access and request backend verification. |
| `/templs/:address` | Overview with priest info, Telegram chat id, and quick actions. |
| `/templs/:address/proposals/new` | Create governance actions; stores title/description on-chain. |
| `/templs/:address/proposals/:id/vote` | YES/NO voting. |
| `/templs/:address/claim` | Claim member-pool rewards and inspect balances. |

Telegram notifications are optional but encouraged. When a templ is registered, the backend issues a one-time binding code. Invite `@templfunbot` to your group and post the code (e.g. `templ abcd1234`)—the bot confirms the chat and begins posting newline-delimited text messages with deep links back to the frontend (join screen, proposal details, claim page, etc.). Priests can later rotate the chat from the templ overview: request a replacement code, sign the EIP-712 proof, and share the snippet in the new group. Alerts cover new members (with live treasury/member-pool totals), proposal creation, quorum, voting closure, priest changes, templ home-link updates, daily "gm" digests, and a binding acknowledgement when a chat connects. No Telegram secrets are stored on-chain; linking happens entirely through the bot token, binding handshake, and signed priest rebind requests.

## Quick Start

```bash
npm ci                         # install root + subpackage deps
npm --prefix backend ci        # install backend deps
npm --prefix frontend ci       # install frontend deps
npm run compile                # compile contracts
npm --prefix backend test      # backend tests (includes shared signing tests)
npm --prefix frontend run dev  # run the SPA against your local backend
```

Detailed deployment steps (contracts, backend, frontend, and Telegram binding) live in [docs/DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md).

In separate terminals you’ll typically run:

1. `npx hardhat node` – local chain with default accounts.
2. `npm --prefix backend start` – Express API and Telegram notifier (expects `RPC_URL`).
3. `npm --prefix frontend run dev` – Vite dev server on http://localhost:5173.

For a step-by-step local walkthrough, see [docs/TEST_LOCALLY.md](docs/TEST_LOCALLY.md).

## Documentation

Start here for a guided path:

- [`docs/README.md`](docs/README.md) – docs index + learning path.
- [`docs/TEMPL_TECH_SPEC.MD`](docs/TEMPL_TECH_SPEC.MD) – canonical architecture across contracts, backend, frontend, and Telegram alerts.
- [`docs/CORE_FLOW_DOCS.MD`](docs/CORE_FLOW_DOCS.MD) – sequence/flow charts for creation, join, governance, and notifications.
- [`docs/CONTRACTS.md`](docs/CONTRACTS.md) – smart contracts surface, fee economics, governance.
- [`docs/BACKEND.md`](docs/BACKEND.md) – API, persistence, Telegram notifier, environment.
- [`docs/FRONTEND.md`](docs/FRONTEND.md) – routes, env, and local dev notes.
- [`docs/PERSISTENCE.md`](docs/PERSISTENCE.md) – what’s on-chain vs. D1 vs. ephemeral.
- [`docs/DEPLOYMENT_GUIDE.md`](docs/DEPLOYMENT_GUIDE.md) – production deploys and Telegram binding.
- [`docs/TEST_LOCALLY.md`](docs/TEST_LOCALLY.md) – local development recipe for the full stack.

## Environment & configuration

### Backend (`backend/.env`)

| Variable | Purpose |
| --- | --- |
| `RPC_URL` | **Required.** JSON-RPC endpoint used to read chain state, verify contracts, and watch events. |
| `PORT` | Port for the HTTP server (defaults to `3001`). |
| `ALLOWED_ORIGINS` | Comma-separated origins for CORS (defaults to `http://localhost:5173`). |
| `BACKEND_SERVER_ID` | String embedded in EIP-712 messages; must match the frontend. |
| `TELEGRAM_BOT_TOKEN` | Optional bot token. If set, governance events post to Telegram chats registered per templ. |
| `APP_BASE_URL` | Optional base URL used when building deep links in Telegram messages. |
| `LOG_LEVEL` | Pino log level (`info` by default). |
| `RATE_LIMIT_STORE` | `memory` or `redis`; auto-selects Redis when `REDIS_URL` is set. |
| `REDIS_URL` | Redis endpoint used for distributed rate limiting (required when `RATE_LIMIT_STORE=redis`). |
| `TRUSTED_FACTORY_ADDRESS` | Optional factory address; when set, only templs emitted by this factory may register or rebind, and cached records from other factories are skipped on restart. |
| `TRUSTED_FACTORY_DEPLOYMENT_BLOCK` | Optional block height used when verifying templ origin from the trusted factory. Provide the factory’s deployment block to avoid wide RPC log scans. |
| `REQUIRE_CONTRACT_VERIFY` | Set to `1` in production to enforce on-chain contract + priest validation. |
| `SQLITE_DB_PATH` | Optional path to a SQLite database file when running outside Cloudflare D1 (e.g. `/var/lib/templ/templ.db`). |
| `LEADER_TTL_MS` | Optional override (milliseconds) for the leadership lease duration backed by D1/SQLite. Default: `60000`. |

The backend persists templ registrations in Cloudflare D1 (`templ_bindings`) whenever a D1 binding is configured, or in a local SQLite file when `SQLITE_DB_PATH` is set. Local development (or environments without either store) automatically falls back to the in-memory adapter so you can iterate without provisioning infrastructure. Bindings store the templ contract, optional Telegram chat id, last-seen priest, and any outstanding binding code so notifications resume instantly after a restart. When D1/SQLite is available, it also powers leader election so only one replica emits Telegram notifications at a time.

### Frontend (`frontend/.env`)

| Variable | Purpose |
| --- | --- |
| `VITE_BACKEND_URL` | API base URL; defaults to `http://localhost:3001`. |
| `VITE_BACKEND_SERVER_ID` | Must equal the backend’s `BACKEND_SERVER_ID` so signatures align. |
| `VITE_TEMPL_FACTORY_*` | Optional overrides for the default factory address (`address`), protocol recipient (`protocolRecipient`), and protocol percent (`protocolPercent`). |
| `VITE_TEMPL_FACTORY_DEPLOYMENT_BLOCK` | Optional block height hint so the landing page can enumerate templs without scanning the entire chain. |
| `VITE_RPC_URL` | Optional read-only RPC endpoint used to list templs from the factory on the landing page (falls back to the connected wallet provider). |

The frontend connects to the user’s browser wallet (MetaMask or any `window.ethereum` provider) and reuses Hardhat accounts during local development.

### Telegram wiring

1. Create a bot with [@BotFather](https://t.me/botfather) and grab the token.
2. Invite <a href="https://t.me/templfunbot" target="_blank" rel="noreferrer">@templfunbot</a> to your Telegram group and allow it to post.
3. Register or deploy your templ from the UI (or API). If you already know the numeric chat id (e.g. by using [@getidsbot](https://t.me/getidsbot)) you can provide it in the form — the backend links the templ immediately.
4. Otherwise, copy the one-time binding snippet shown after registration and post it into the Telegram group, for example:
   ```
   templ ca83cfbc0f47a9d1
   ```
   The backend polls the bot API, detects the code, and acknowledges the binding in the same chat. Once confirmed, all templ events (joins, proposals, quorum, vote closure, priest changes, daily digests, home-link updates) stream into the channel as plaintext notifications with deep links back to the frontend.

Leaving the chat id empty is perfectly fine — the templ remains usable, and you can complete the binding later from the templ overview page. When governance appoints a new priest or the community moves chats, request a new binding code from the overview, sign the EIP-712 rebind payload, and post the snippet in the destination group to re-link the bot.

### Deployment profile

The backend expects a traditional Node runtime. Run it on your favourite host (Fly, Railway, Render, bare metal, Kubernetes, etc.) and keep a single **active** process connected to your RPC provider. When Cloudflare D1 (or another SQL database) is available, the server uses it for durable bindings and leader election: one replica advertises itself as the leader and emits Telegram notifications, while additional replicas remain on standby.

- **Persistent Node host.** The Express server keeps WebSocket/JSON-RPC connections alive to stream on-chain events. Background jobs (proposal deadline checks, Telegram binding polls, daily digests) run inside the same process, so you should treat the service like any other long-lived API.
- **Cloudflare D1 (optional but recommended).** D1 stores templ bindings, signature replay protection, and the `leader_election` row that coordinates active replicas. If you skip D1, the backend falls back to the in-memory adapter (suitable for local dev or single-instance deployments).
- **Cloudflare Pages frontend.** The React SPA builds to static assets that Pages serves from every POP with generous free tiers. Publishing the frontend separately keeps hosting costs near-zero while leaving you free to deploy the backend wherever you prefer.
- **Redis rate limiting (optional).** Point `RATE_LIMIT_STORE` at Redis when you need shared rate limiting across multiple nodes; otherwise, the in-memory store is sufficient for single-instance deployments.

## Cloudflare Deploys (One Command)

Use `npm run deploy:cloudflare` to orchestrate a full-stack deploy once you populate `.cloudflare.env` (see `scripts/cloudflare.deploy.example.env`). The script:

- Applies the D1 schema so your production database contains the required tables (`templ_bindings`, `used_signatures`, `leader_election`).
- Deploys the Worker unless you opt into `--skip-worker` (recommended when you host the backend elsewhere).
- Builds the SPA with your `VITE_*` overrides and pushes the static bundle to Cloudflare Pages (skip with `--skip-pages`).

- Required/important backend variables for production:
  - `BACKEND_SERVER_ID` – must match the frontend’s `VITE_BACKEND_SERVER_ID`.
  - `REQUIRE_CONTRACT_VERIFY=1` – enforce on‑chain contract/priest checks for `/templs`.
  - `TRUSTED_FACTORY_ADDRESS` – restrict registrations to your factory.
  - `TRUSTED_FACTORY_DEPLOYMENT_BLOCK` – start block for factory log scans.
  - `APP_BASE_URL` – used for deep links in Telegram notifications.
  - `RPC_URL` – JSON‑RPC endpoint for reads/subscriptions.
  - `TELEGRAM_BOT_TOKEN` – enables Telegram delivery (optional; omit to disable).
  - Optional: `ALLOWED_ORIGINS`, `LEADER_TTL_MS`, `RATE_LIMIT_STORE=redis` and `REDIS_URL` for distributed rate‑limit.

- When deploying the Worker, these are injected into `backend/wrangler.deployment.toml`. To pass additional vars/secrets to the Worker, use:
  - `CLOUDFLARE_BACKEND_VAR_*` → becomes `[vars]` in Wrangler (e.g. `CLOUDFLARE_BACKEND_VAR_ALLOWED_ORIGINS`).
  - `CLOUDFLARE_BACKEND_SECRET_*` → stored via `wrangler secret put` (e.g. `CLOUDFLARE_BACKEND_SECRET_REDIS_URL`).

To focus on the database + Pages while skipping the Worker, run:

```bash
npm run deploy:cloudflare -- --skip-worker
```

In this mode you only need the Cloudflare API credentials, `CF_D1_DATABASE_NAME`, `CF_D1_DATABASE_ID`, `BACKEND_SERVER_ID`, and the frontend build variables. When you are ready to ship the Worker, add `CF_WORKER_NAME`, `APP_BASE_URL`, `TRUSTED_FACTORY_ADDRESS`, `TRUSTED_FACTORY_DEPLOYMENT_BLOCK`, `REQUIRE_CONTRACT_VERIFY`, `TELEGRAM_BOT_TOKEN`, and `RPC_URL` to the environment (the example file groups these by requirement). For a standalone Node backend (outside Workers), set `NODE_ENV=production`, `REQUIRE_CONTRACT_VERIFY=1`, `TRUSTED_FACTORY_ADDRESS`, and `TRUSTED_FACTORY_DEPLOYMENT_BLOCK` in your host environment.

After the script completes, take the generated `backend/wrangler.deployment.toml` (for reference) and deploy the backend separately. Populate the same environment variables on your host, ensure one instance is running, and let the D1-backed leader election prevent duplicate Telegram notifications.

You can run a smoke test for the skip-worker path locally via:

```bash
npm run test:deploy:skip-worker
```

The test swaps in a mocked Wrangler binary and ensures `deploy-cloudflare.js --skip-worker --skip-pages` exits cleanly with the minimal variable set.

## Repository Layout

- `contracts/` – Solidity sources (`TEMPL.sol`, `TemplFactory.sol`) plus Hardhat tests in `test/`.
- `backend/` – Express API, Telegram notifier (`src/`), and Node tests in `test/`.
- `frontend/` – Vite + React app, Vitest setup, and Playwright specs in `e2e/`.
- `shared/` – Common JS helpers (EIP-712 signing, debug utilities).
- `scripts/` – Deployment/test scripts, wallet generators, CI hooks.
- `deployments/` – Network artifacts emitted by Hardhat deployments.

## Testing & CI

- `npm test` (root) – Hardhat contract tests.
- `npm --prefix backend test` – backend + shared unit tests.
- `npm --prefix frontend run test` – Vitest suite for the SPA.
- `npm --prefix frontend run test:e2e` – Playwright smoke tests (starts Hardhat, backend, and a preview build). The harness focuses on deployment/join/vote flows; Telegram messaging is stubbed by leaving `TELEGRAM_BOT_TOKEN` unset.

Run `npm run test:all` to mirror the full CI matrix locally before pushing. Code coverage targets are enforced by Codecov for contracts and JS packages; generate reports with `npm run coverage:all`.

## Production Notes

- Configure `REQUIRE_CONTRACT_VERIFY=1` and `NODE_ENV=production` on the backend to enforce on-chain ownership checks at registration time.
- Set `APP_BASE_URL` so Telegram deep links resolve to your deployed frontend.
- Prefer standard ERC-20 access tokens (no transfer taxes) to keep splits exact.
