# Test Locally (Fast Path)

Use this doc to spin up the full templ stack—Hardhat chain, Express backend, and React frontend—so you can deploy a templ, verify membership, and run proposals without relying on external services.

## Prerequisites

- Node.js ≥ 22.18.0
- `npm ci` already executed at the repo root
- One terminal per process (or a multiplexer such as tmux)

## 1) Start a local Hardhat chain

Terminal A:

```bash
npm run node
```

Hardhat exposes JSON-RPC on `http://127.0.0.1:8545` and pre-funds 20 deterministic accounts.

## 2) Configure & start the backend

Create `backend/.env`:

```env
RPC_URL=http://127.0.0.1:8545
ALLOWED_ORIGINS=http://localhost:5173
BACKEND_SERVER_ID=templ-dev
APP_BASE_URL=http://localhost:5173
# Optional: wire up Telegram notifications by providing a bot token.
# TELEGRAM_BOT_TOKEN=123456:bot-token-from-botfather
# Optional: persist data locally between restarts.
# SQLITE_DB_PATH=./templ.local.db
```

Terminal B:

```bash
npm --prefix backend start
```

The server listens on `http://localhost:3001`, verifies signatures, persists templ registrations in the in-memory adapter (matching the Cloudflare D1/SQLite schema), and—if a `TELEGRAM_BOT_TOKEN` is supplied—posts contract events to chat ids registered for each templ. You only need a persistent store (SQLite or D1) in production; local development stays dependency-free.

## 3) Start the frontend

Terminal C:

```bash
npm --prefix frontend run dev
```

Open `http://localhost:5173`. The SPA provides dedicated routes for every core flow:

- `/templs/create` – deploy + register a templ (optionally include a Telegram chat id).
- `/templs/join` – purchase access and verify membership with the backend.
- `/templs/:address` – overview page with quick navigation to proposals.
- `/templs/:address/proposals/new` – create governance actions.
- `/templs/:address/proposals/:id/vote` – cast a YES/NO vote.

## 4) Load Hardhat wallets in your browser

Add the Hardhat network in MetaMask (or another injected wallet):

- RPC URL: `http://127.0.0.1:8545`
- Chain ID: `1337`
- Currency: ETH (test)

Commonly used accounts (private keys are from Hardhat defaults—never use them on mainnet):

| Role | Address | Private key |
| --- | --- | --- |
| Priest candidate | `0x90F79bf6EB2c4f870365E785982E1f101E93b906` | `0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6` |
| Member | `0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65` | `0x47e179ec197488593b187f80a00eb0da91f1b9f6191b7644aab4f9f0d0c5d938` |

(Refer to `hardhat.config.cjs` for the full list if you need additional wallets.)

## 5) Deploy and register a templ

1. Connect the priest wallet in the UI and navigate to `/templs/create`.
2. Fill in the form:
   - Factory address: the `TemplFactory` you deployed or the value from `VITE_TEMPL_FACTORY_ADDRESS`.
   - Access token address: any ERC-20 you control on the local chain (deploy `TestToken` via `npx hardhat console` if needed).
   - Entry fee / fee split / limits: pick values that satisfy on-chain validations (entry fee ≥ 10 wei and divisible by 10, fee split sums to 100).
   - Telegram chat id: optional numeric id; omit it if you don’t want Telegram alerts yet.
3. Submit—the frontend deploys the contract via the factory and immediately calls the backend `/templs` endpoint to persist the registry entry.
4. After success you land on `/templs/:address` where the overview reflects the registered priest, home link, and chat id. If you left the chat id blank, the confirmation card shows a one-time `templ <bindingCode>` snippet—post it in your Telegram group after inviting `@templfunbot` to finish the binding.

## 6) Join and verify membership

1. Switch to the member wallet and open `/templs/join?address=<templAddress>`.
2. Use “Purchase Access” to approve + call `purchaseAccess` if you haven’t joined before.
3. Click “Verify Membership” to sign the EIP-712 payload and call the backend `/join` endpoint.
4. The response includes the templ metadata plus deep links (join, overview, proposals) derived from `APP_BASE_URL`.

## 7) Create proposals and vote

- `/templs/:address/proposals/new` lets any member raise actions such as pausing, changing the priest, updating fees, etc. Titles and descriptions are now stored on-chain and emitted in `ProposalCreated` events.
- `/templs/:address/proposals/:id/vote` submits `vote(proposalId, support)` transactions.
- If the templ was registered with a Telegram chat id, the backend will post:
  - Member joins (`AccessPurchased`) with live treasury/member-pool balances.
  - Proposal creations (including on-chain title/description).
  - Votes (enriched with cached proposal titles) and quorum milestones.
  - Voting window closures with an execute/not-executable summary.
  - Priest changes and templ home-link updates.
  - Daily treasury/member-pool digests (every 24h) when the server remains online.
  Each message links back to the relevant frontend route so members can take action quickly and is formatted with Telegram Markdown V2 for consistent bold headers, code spans, and deep links. Posting the one-time binding code also yields an immediate “Telegram bridge active” acknowledgement.
- `/templs/:address/claim` lets connected wallets see the raw member pool balance and call `claimMemberPool()`.

## Troubleshooting

- **CORS / origin errors** – ensure `ALLOWED_ORIGINS` in `backend/.env` matches the frontend origin.
- **Telegram messages not appearing** – confirm the bot is added to the group, the chat id is correct, and the backend logs show `notify*` calls. Missing `APP_BASE_URL` will omit deep links but shouldn’t block delivery.
- **Signature rejected** – signatures are cached in-memory for 6 hours. Restart the backend (or wait for the retention window) if you reused an old payload with the same nonce.
- **Contract reverts** – hardhat console logs will show revert reasons. Common issues are fee splits not summing to 100 or attempting to vote after the deadline.

You now have a full local environment for iterating on templ governance and Telegram notifications.
