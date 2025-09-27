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

   > Deploying to Base (or any remote network) requires a funded deployer key. Export `PRIVATE_KEY` so Hardhat can sign transactions, and add `BASESCAN_API_KEY` if you plan to verify immediately:
   > ```bash
   > export PRIVATE_KEY=0xyourdeployerkey
   > export BASESCAN_API_KEY=your-basescan-key
   > ```
2. In one terminal start Hardhat for local testing:
   ```bash
   npm run node
   ```
3. Export the deployment parameters required by `scripts/deploy.js`:
  ```bash
  export TOKEN_ADDRESS=0x...       # required: ERC-20 token gating access
  export ENTRY_FEE=1000000000000   # required: must be >= 10 and divisible by 10
  export PROTOCOL_FEE_RECIPIENT=0x...  # required: protocol treasury address
   export PROTOCOL_PERCENT=10            # only used when deploying a brand new factory (defaults to 10)
  export PRIEST_ADDRESS=0x...           # optional (defaults to deployer)
  export FACTORY_ADDRESS=0x...          # optional: reuse an existing factory; leave unset to deploy a new one
  ```

   > For remote deployments, confirm `PRIVATE_KEY` is still exported in your shell so Hardhat can access the deployer signer.

   Optional configuration knobs:
   ```bash
   export QUORUM_PERCENT=40            # override default 33% quorum
   export EXECUTION_DELAY_SECONDS=86400  # override governance delay (seconds)
   export BURN_ADDRESS=0x...           # use a custom burn sink
   export MAX_MEMBERS=1000             # 0 keeps membership uncapped
   export TEMPL_HOME_LINK="https://example.com"  # stored on-chain, shown in the app/alerts
   export BACKEND_URL=http://localhost:3001  # auto-register with backend (requires priest PRIVATE_KEY)
   export TELEGRAM_CHAT_ID=-1001234567890   # optional: seed the backend with an existing chat id
   ```
4. Deploy a templ with custom parameters:
  ```bash
  npx hardhat run scripts/deploy.js --network localhost   # use --network base when targeting Base mainnet
  ```
   The script deploys `TemplFactory` automatically when `FACTORY_ADDRESS` is unset and then mints the templ. Copy the logged factory address and export it as `FACTORY_ADDRESS` before subsequent deployments on the same network so every templ originates from the same factory. When you reuse an existing factory the script automatically reads its on-chain protocol share and ignores any `PROTOCOL_PERCENT` override. The script prints both the `TemplFactory` and `TEMPL` addresses.

5. Record the trusted factory address for downstream services:
  ```bash
  export TRUSTED_FACTORY_ADDRESS=<factory address from step 4>
  export TRUSTED_FACTORY_DEPLOYMENT_BLOCK=<block number the factory was deployed>
  ```
   Use this value in your backend configuration so the Telegram bot only services templs created by that factory. Additional templ deployments should continue to use the same factory to remain eligible for alerts. Providing `TRUSTED_FACTORY_DEPLOYMENT_BLOCK` lets the backend verify older templs without hitting RPC log-range limits.

6. Register the templ with the backend so the UI and Telegram bridge can discover it:
   - If you exported `BACKEND_URL` before running the deploy script and the deployer signer matches the priest, the script already POSTed to `${BACKEND_URL}/templs`. Check the console output for a binding code or stored chat id.
   - Otherwise run the helper script with the priest key:
     ```bash
     export BACKEND_URL=http://localhost:3001
     export TEMPL_ADDRESS=<templ address printed above>
     export PRIVATE_KEY=0xyourpriestkey
     npx hardhat run scripts/register-templ.js --network base
     ```
     The backend responds with either a binding code (invite @templfunbot and send `templ <code>`) or the stored chat id if you pre-populated one. Registration is required before the frontend can list the templ or membership verification will succeed.

7. (Optional) Verify the factory once you deploy to a public network:
   ```bash
   npx hardhat verify --network <network> $FACTORY_ADDRESS $PROTOCOL_FEE_RECIPIENT $PROTOCOL_PERCENT
   ```
   Verification is required only the first time you deploy the factory; the `deployments/` JSON captures the address and configuration for later reference.

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

1. Create `backend/.env` (you can start by copying `backend/.env.test` if you want the local defaults) and fill in:
   ```ini
   RPC_URL=http://127.0.0.1:8545
   BACKEND_SERVER_ID=templ-dev
   APP_BASE_URL=http://localhost:5173
   TELEGRAM_BOT_TOKEN=123456:bot-token-from-botfather
   TRUSTED_FACTORY_ADDRESS=0x...   ; same factory used during deployment
   TRUSTED_FACTORY_DEPLOYMENT_BLOCK=0 ; optional: earliest block to scan for factory logs
   ```
2. Start the backend:
   ```bash
   npm --prefix backend start
   ```
   The server persists Telegram bindings in `backend/groups.db` and begins watching contract events.
   > The backend only recognises templs that call the `/templs` registration endpoint and (when `TRUSTED_FACTORY_ADDRESS` is set) were emitted by the trusted factory. The CLI deploy script can auto-register (see step 6 above) or run `scripts/register-templ.js`. Until registration completes, the frontend will not list the templ and membership verification requests will return 404.

### Telegram binding flow

Every templ can expose notifications in a Telegram group. When you register a templ without a chat id, the backend returns a one-time **binding code**. Complete the binding once for each templ:

1. Invite `@templfunbot` to your Telegram group and give it permission to post.
   > Bots must be able to read messages in order to detect the binding code. After inviting the bot, open the group info → **Administrators**, promote `@templfunbot`, and enable “Read Messages” / “Manage Chat” (Telegram renames this toggle periodically). If the bot remains a regular member it will only receive mentions and cannot see the `templ <code>` message.
2. In that group, send the binding message shown in the UI, e.g.:
   ```
   templ ca83cfbc0f47a9d1
   ```
   The backend polls the bot API, detects the binding code, and links the templ to the chat automatically.
   Binding codes persist in the backend database, so a server restart will not invalidate them—request a new code only when you intentionally rotate chats.
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
