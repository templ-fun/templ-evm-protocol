# Deployment Guide

Use this guide for the first end-to-end deployment of the templ stack: smart contracts, backend, frontend, and the Telegram bot binding required for notifications.

## 1. Prerequisites

- Node.js 22.18.0 or newer (matches the `engines` fields in every package)
- npm 10+
- Access to an Ethereum-compatible RPC endpoint (Base, Base Sepolia, or Hardhat localhost)
- A Telegram bot token created via [@BotFather](https://t.me/botfather)
- A Telegram group or supergroup where you can invite bots

Clone the repository and install dependencies once at the root:

```bash
git clone https://github.com/MarcoWorms/templ.git
cd templ
npm ci
npm --prefix backend ci
npm --prefix frontend ci
```

> **Tip:** If you already ran `npm ci` before pulling new dependencies, refresh the package locks with `npm install --package-lock-only` inside `frontend/`.

## 2. Deploy the Templ contract

You can deploy from the CLI or via the frontend. The CLI is convenient for scripted environments; the UI is friendlier when exploring.

### CLI deployment (Hardhat)

1. Start a local chain or export your target RPC URL:
   ```bash
   export RPC_URL=http://127.0.0.1:8545
   ```
2. In one terminal start Hardhat for local testing:
   ```bash
   npm run node
   ```
3. Export the deployment parameters required by `scripts/deploy.js`:
   ```bash
   export TOKEN_ADDRESS=0x...       # required: ERC-20 token gating access
   export ENTRY_FEE=1000000000000   # required: must be >= 10 and divisible by 10
   export PROTOCOL_FEE_RECIPIENT=0x...  # required: protocol treasury address
   export PROTOCOL_PERCENT=10            # optional override (defaults to 10)
   export PRIEST_ADDRESS=0x...           # optional (defaults to deployer)
   ```
4. Deploy a templ with custom parameters:
   ```bash
   npx hardhat run scripts/deploy.js --network localhost
   ```
   The script prints the new `TemplFactory` and `TEMPL` addresses.

### UI deployment (recommended for first run)

1. Run the backend (see the next section) so the UI can register the templ immediately.
2. Start the frontend dev server:
   ```bash
   npm --prefix frontend run dev
   ```
3. Open `http://localhost:5173`, connect your wallet, and navigate to **Create**.
4. Provide:
   - **Factory address** – deployed `TemplFactory` (local factory appears in Hardhat console logs).
   - **Access token address** – ERC-20 gating access.
   - **Entry fee / fee split** – must total 100%.
   - **Templ home link** – public URL for the templ (e.g. your Telegram invite link). This value is stored on-chain and can be updated via governance later.
   - **Telegram chat id** – optional. Leave blank to rely on the binding flow described below.
5. Submit. The UI deploys the contract, registers it with the backend, and shows the Telegram binding instructions.

## 3. Run and configure the backend

1. Copy `backend/.env.example` to `backend/.env` and fill in:
   ```ini
   RPC_URL=http://127.0.0.1:8545
   BACKEND_SERVER_ID=templ-dev
   APP_BASE_URL=http://localhost:5173
   TELEGRAM_BOT_TOKEN=123456:bot-token-from-botfather
   ```
2. Start the backend:
   ```bash
   npm --prefix backend start
   ```
   The server persists templ registrations in `backend/groups.db` and begins watching contract events.

### Telegram binding flow

Every templ can expose notifications in a Telegram group. When you register a templ without a chat id, the backend returns a one-time **binding code**. Complete the binding once for each templ:

1. Invite `@templfunbot` to your Telegram group and give it permission to post.
2. In that group, send the binding message shown in the UI, e.g.:
   ```
   templ ca83cfbc0f47a9d1
   ```
   The backend polls the bot API, detects the binding code, and links the templ to the chat automatically.
3. The bot replies with “Telegram bridge active” to confirm it will relay events.

When governance appoints a new priest or the community moves to another Telegram group, open the templ overview, click **Request binding code**, and approve the EIP-712 signature. The backend verifies the priest wallet against the contract before issuing a fresh code so only the current priest can rebind notifications.

You can still provide a numeric chat id during registration if you have one; no binding code is generated in that case.

## 4. Run the frontend

With the backend running:

```bash
npm --prefix frontend run dev
```

Open the dashboard (`http://localhost:5173`) to:

- Deploy additional templs
- Join a templ and verify membership
- Create proposals (including the new “Update templ home link” action)
- Claim member rewards

## 5. Smoke test the stack

Run the Playwright smoke suite (launches Hardhat node, backend, and a preview build):

```bash
npm --prefix frontend run test:e2e
```

If the suite reports a binding code, follow the Telegram steps above before re-running the tests.

## 6. Production checklist

- Deploy `TemplFactory` and `TEMPL` to your target network with finalized parameters.
- Set `NODE_ENV=production` and `REQUIRE_CONTRACT_VERIFY=1` for the backend so contract ownership is checked on registration.
- Set `APP_BASE_URL` to the deployed frontend URL (used to build deep links in Telegram messages).
- Provision `TELEGRAM_BOT_TOKEN` in a secure secret manager.
- Use a persistent database path (set `DB_PATH`) for backend registrations.
- Run `npm --prefix backend run lint` and `npm --prefix frontend run lint` before shipping.

Once everything is live, members joining the templ will see:

- Telegram alerts for new members, proposals, votes, quorum, and vote closures
- Daily digests with treasury/member-pool balances
- A direct link back to the templ home (your `templHomeLink` value)

Welcome to the Telegram-first templ stack!
