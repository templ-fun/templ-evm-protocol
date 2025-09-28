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
   When `MAX_MEMBERS` is non-zero the templ auto-pauses new joins once the cap is met. Additional purchases revert with the on-chain `MemberLimitReached` error until governance raises or clears the limit.
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

### Local development

1. Create `backend/.env` (you can start by copying `backend/.env.test` if you want the local defaults) and fill in:
   ```ini
   RPC_URL=http://127.0.0.1:8545
   BACKEND_SERVER_ID=templ-dev
   APP_BASE_URL=http://localhost:5173
   TELEGRAM_BOT_TOKEN=123456:bot-token-from-botfather
   TRUSTED_FACTORY_ADDRESS=0x...   ; same factory used during deployment
   TRUSTED_FACTORY_DEPLOYMENT_BLOCK=0 ; optional: earliest block to scan for factory logs
   SQLITE_DB_PATH=./templ.local.db  ; optional: persist data to a local SQLite file
   ```
2. Start the backend:
   ```bash
   npm --prefix backend start
   ```
  By default the backend uses the in-memory persistence adapter so you can iterate quickly without provisioning infrastructure. Set `SQLITE_DB_PATH` if you want the data to survive restarts, or (optionally) wire up a Cloudflare D1 database via Wrangler for parity with production. When a D1 binding is present the server bootstraps the schema automatically, so no manual migrations are required.
   > The backend only recognises templs that call the `/templs` registration endpoint and (when `TRUSTED_FACTORY_ADDRESS` is set) were emitted by the trusted factory. The CLI deploy script can auto-register (see step 6 above) or run `scripts/register-templ.js`. Until registration completes, the frontend will not list the templ and membership verification requests will return 404.

### Deploying the backend to production

Run the Express server like any other long-lived Node application. A typical production rollout looks like this:

1. **Provision a host.** Any Node 22+ environment works: Fly.io, Render, Railway, AWS ECS/Fargate, bare metal, etc. Attach a persistent volume if you plan to use SQLite for storage.
2. **Install dependencies:**
   ```bash
   npm ci --omit=dev
   npm --prefix backend ci --omit=dev
   ```
3. **Configure the environment:** copy `backend/.env` (or inject the variables through your hosting provider) and set:
   - `RPC_URL` pointing at a reliable Base/mainnet RPC.
   - `SQLITE_DB_PATH=/var/lib/templ/templ.db` (or another path on your persistent volume). If you prefer to bring your own database, wire up a D1-compatible adapter and point all replicas at it.
   - `TELEGRAM_BOT_TOKEN`, `APP_BASE_URL`, `BACKEND_SERVER_ID`, `TRUSTED_FACTORY_ADDRESS`, etc.
4. **First boot initialises the schema.** The SQLite adapter creates the `templ_bindings`, `used_signatures`, and `leader_election` tables automatically. (If you export your own schema, use `backend/src/persistence/schema.sql` as a reference.)
5. **Start the service:**
   ```bash
   node backend/src/server.js
   ```
   Wrap this command in your favourite process manager (`pm2`, `systemd`, Docker, etc.). Expose port `3001` (or override with `PORT`).

When you add more replicas, ensure they all point to the same persistent store (shared SQLite file or another SQL database). The built-in leader election guarantees that only one instance emits Telegram notifications at a time; followers continue serving HTTP traffic but skip background jobs.

### Deploying the frontend to Cloudflare Pages

Cloudflare Pages is an edge-cached static host with an extremely generous free tier (500 builds/month, 20k requests/day). The templ frontend is a static Vite build, so deploying is as simple as uploading the `frontend/dist/` directory:

1. Create a Pages project (once per environment):
   ```bash
   wrangler pages project create templ-frontend --production-branch main
   ```
   Replace `templ-frontend` with your preferred project name; the script below will reuse it.
2. Build the SPA with production env vars:
   ```bash
   VITE_BACKEND_URL=https://api.templ.example \
   VITE_BACKEND_SERVER_ID=templ-prod \
   VITE_TEMPL_FACTORY_ADDRESS=0x... \
   npm --prefix frontend run build
   ```
3. Deploy to Pages:
   ```bash
   wrangler pages deploy frontend/dist --project-name templ-frontend --branch production
   ```
   The default Pages domain follows `https://<project>.pages.dev`. Point `APP_BASE_URL` (backend + Telegram deep links) to this hostname or your custom domain.

### Automating the Cloudflare deploy (backend + frontend)

To avoid juggling multiple commands, use the bundled `scripts/deploy-cloudflare.js` wrapper. It reads a single env file, applies the D1 schema (so your SQLite/D1 store has the required tables), builds the SPA with the correct `VITE_*` overrides, and publishes to Cloudflare Pages. The backend must be deployed separately on your Node host; the script now enforces `--skip-worker`.

1. Copy the template and fill it out with your production details (database ids, secrets, Pages project, etc.). Worker fields remain for backwards compatibility—leave them as placeholders when running with `--skip-worker`:
   ```bash
   cp scripts/cloudflare.deploy.example.env .cloudflare.env
   $EDITOR .cloudflare.env
   ```
2. Run the deploy:
   ```bash
   npm run deploy:cloudflare
   ```
   - `--skip-worker` is required; backend deployment now happens outside of Cloudflare Workers.
   - `--skip-pages` skips the Pages deploy when you’re adjusting backend configuration only.

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
- Provision `TELEGRAM_BOT_TOKEN`, `RPC_URL`, and other secrets via `wrangler secret put` so they are not stored in git.
- Bind the Cloudflare D1 database (see the Wrangler steps above) and confirm the tables exist before your first deploy.
- Run `npm --prefix backend run lint` and `npm --prefix frontend run lint` before shipping.

Once everything is live, members joining the templ will see:

- Telegram alerts for new members, proposals, votes, quorum, and vote closures
- Daily digests with treasury/member-pool balances
- A direct link back to the templ home (your `templHomeLink` value)

Welcome to the Telegram-first templ stack!
