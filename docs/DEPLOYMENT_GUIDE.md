# Deployment Guide

This guide walks through the production deployment of templ on Cloudflare. The backend ships as a Cloudflare Worker backed by a D1 database, while the frontend is published to Cloudflare Pages. Follow every section in order to promote a fresh release.

## 1. Prerequisites

- Node.js 22.18.0 or newer and npm 10+ (matches the `engines` fields across the monorepo).
- A funded deployer wallet for your target chain (Base mainnet recommended) and an RPC provider URL with reliable archive access.
- Cloudflare account with access to Workers, Pages, and D1, plus an API token that includes:
  - **Account** → **Cloudflare Pages**: Edit
  - **Account** → **Workers Scripts**: Edit
  - **Account** → **D1**: Edit
- `wrangler` CLI v3.83.0+ accessible via `npx` (run `npx wrangler --version` to confirm).
- Authenticated Cloudflare session (`npx wrangler login`) for the account that owns the target resources.
- Telegram bot token generated with [@BotFather](https://t.me/botfather) and the production Telegram group that will receive notifications.
- Local checkout of this repository with dependencies installed:

  ```bash
  npm ci
  npm --prefix backend ci
  npm --prefix frontend ci
  ```

## 2. Deploy the TemplFactory contract

1. Export the RPC endpoint, deployer key, and protocol split. The deployer wallet must hold enough ETH to cover the factory deployment fees.

   ```bash
   export RPC_URL=https://base-mainnet.g.alchemy.com/v2/your-key
   export PRIVATE_KEY=0xyourdeployerkey
   export PROTOCOL_FEE_RECIPIENT=0xProtocolTreasury
   export PROTOCOL_PERCENT=10   # optional; 10% protocol share (auto-converted to 1_000 bps)
   # or
   export PROTOCOL_BP=1000      # same value expressed directly in basis points
   ```

   The contracts use basis points internally (10_000 equals 100%). Provide either `PROTOCOL_PERCENT` (0–100) or `PROTOCOL_BP` (0–10_000) and the helper normalises the value before broadcasting.
2. Deploy (or reuse) the factory:

   ```bash
   npx hardhat run scripts/deploy-factory.js --network base
   ```

   The helper prints the factory address, transaction hash, and confirmed block number, then saves a JSON artifact under `deployments/`.
3. Export the trusted factory metadata for downstream steps:

   ```bash
   export TRUSTED_FACTORY_ADDRESS=<factory address>
   export TRUSTED_FACTORY_DEPLOYMENT_BLOCK=<factory deploy block>
   ```

4. (Recommended) Verify the factory on BaseScan:

   ```bash
   npx hardhat verify --network base $TRUSTED_FACTORY_ADDRESS $PROTOCOL_FEE_RECIPIENT <protocolPercentBps from script output>
   ```

   The deployment helper prints the protocol share in basis points—reuse that exact value when calling `hardhat verify`.
5. By default the factory only accepts templ creations from the deployer. When you are ready to open deployments to any wallet, call `setPermissionless(true)` from the deployer account; the transaction emits `PermissionlessModeUpdated(true)` and flips the flag permanently until you send another transaction to disable it. Every templ minted through the factory inherits the deploy-time protocol recipient and fee percent—those values are immutable for the lifetime of the factory and all templs it spawns, so creators cannot override them when calling `createTemplFor`/`createTempl`/`createTemplWithConfig`. Use `createTemplFor(priest, token, entryFee)` when the deployer is minting a templ on behalf of another wallet; the convenience wrapper `createTempl(token, entryFee)` simply forwards the caller as the priest.
6. All future templ instances should be minted through the app (section 6). The frontend prompts the connected wallet for token, entry-fee, and split details, then routes the deployment through the trusted factory so every templ inherits the verified bytecode.

## 3. Provision Cloudflare resources

1. **Create the D1 database** and record its name and id:

   ```bash
   npx wrangler d1 create templ-backend
   npx wrangler d1 info templ-backend
   ```

   The info command prints `database_id`, which the deployment script references.
2. **Choose a Worker name** (e.g. `templ-backend`) and confirm the name is available within your account. The Worker runs the Express backend bundle.
3. **Create a Cloudflare Pages project** (e.g. `templ-frontend`) with production branch `production`. No build command is required; the deployment script ships the prebuilt `frontend/dist/` directory.
4. **Set up DNS** so your custom domain points to the Pages project and Worker routes:
   - Create a CNAME (or AAAA) for `app.templ.example` to the Pages hostname once the first deploy finishes.
   - Reserve an HTTPS origin (e.g. `api.templ.example`) for the Worker using Cloudflare’s “Workers Routes” configuration.

## 4. Create the Cloudflare deployment env file

1. Start from the annotated template and fill in every required value gathered in the previous steps:

   ```bash
   cp scripts/cloudflare.deploy.example.env .cloudflare.env
   ```

2. Update `.cloudflare.env` with:
   - `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` (scoped token described in section 1).
   - `CF_D1_DATABASE_NAME` and `CF_D1_DATABASE_ID` from `npx wrangler d1 info`.
   - `CF_WORKER_NAME`, `APP_BASE_URL`, `TRUSTED_FACTORY_ADDRESS`, `TELEGRAM_BOT_TOKEN`, `RPC_URL`, and any additional backend vars (`CLOUDFLARE_BACKEND_VAR_*`).
   - Frontend build overrides (`VITE_*`) that match the production configuration, including the trusted factory address, deployment block, and backend URL.
   - Pages project name and branch.
3. Store secrets (e.g. Redis URL) with the `CLOUDFLARE_BACKEND_SECRET_*` prefix so the deployment script can hand them to Wrangler without writing plaintext into git.

## 5. Run the Cloudflare deployment script

1. Execute the bundled helper so the Worker, D1 database, and Pages project are updated in one pass:

   ```bash
   npm run deploy:cloudflare
   ```

   Use `npm run deploy:cloudflare -- --env-file path/to/env` when the env file lives outside the repo root.
2. The script performs the following actions:
   - Loads `.cloudflare.env` and validates required variables.
   - Applies the SQL schema to the D1 database via `npx wrangler d1 execute`.
   - Generates `backend/wrangler.deployment.toml` with the configured bindings and variables.
   - Syncs Worker secrets (`TELEGRAM_BOT_TOKEN`, `RPC_URL`, and any `CLOUDFLARE_BACKEND_SECRET_*` values).
   - Deploys the Worker (`npx wrangler deploy`) so the API is globally available.
   - Builds the Vite frontend with the supplied `VITE_*` overrides and uploads the static assets to Cloudflare Pages.
3. On success, copy the Worker and Pages URLs printed at the end of the run. Update DNS aliases to point to these origins if you have not already.

## 6. Create and register templs

1. Confirm the Worker responds by listing templs:

   ```bash
   curl https://api.templ.example/templs
   ```

   A healthy deployment returns `{"templs": []}` (or your registered templs) with a `200 OK` response.
2. Visit the production frontend, connect the priest wallet, and run the “Create templ” flow. The UI calls `TemplFactory.createTemplWithConfig`, then signs the backend registration payload so the Worker starts tracking the new templ immediately.
3. If the UI cannot reach the backend (for example, while DNS propagates), register the templ manually:

   ```bash
   export BACKEND_URL=https://api.templ.example
   export TEMPL_ADDRESS=<templ address>
   export PRIVATE_KEY=0xPriestKey
   npx hardhat run scripts/register-templ.js --network base
   ```

   The backend returns a binding code unless you provide a Telegram chat id upfront.

## 7. Bind Telegram notifications

1. Invite `@templfunbot` to the production chat (no admin privileges required). Ensure members can mention bots or send commands.
2. Inside the chat, either tap the generated `https://t.me/templfunbot?startgroup=<code>` link or send the binding command:

   ```
   /templ <code>
   ```

3. The Worker links the templ to the chat and replies “Telegram bridge active”. Repeat for every templ you control. Regenerate a code from the frontend whenever governance appoints a new priest or the community migrates to another chat.

## 8. Production smoke checks

- Visit the Cloudflare Pages URL (`https://templ-frontend.pages.dev` or your custom domain) and confirm it loads the templ list using the production factory.
- Join a templ, cast a vote, and verify that the Telegram bot forwards notifications.
- Run the Playwright smoke suite against production endpoints once secrets are scoped appropriately:

  ```bash
  VITE_BACKEND_URL=https://api.templ.example \
  VITE_BACKEND_SERVER_ID=templ-prod \
  VITE_TEMPL_FACTORY_ADDRESS=$TRUSTED_FACTORY_ADDRESS \
  VITE_TEMPL_FACTORY_DEPLOYMENT_BLOCK=$TRUSTED_FACTORY_DEPLOYMENT_BLOCK \
  npm --prefix frontend run test:e2e
  ```

## 9. Final checklist

- Contracts deployed and (optionally) verified on the target network.
- `TRUSTED_FACTORY_ADDRESS` and `TRUSTED_FACTORY_DEPLOYMENT_BLOCK` exported in both the Worker and frontend configuration.
- Worker live at `https://api.templ.example` with D1 binding and required secrets (`RPC_URL`, `TELEGRAM_BOT_TOKEN`, etc.).
- Cloudflare Pages serving the built SPA; `APP_BASE_URL` points to this domain for deep links.
- Telegram binding confirmed for every templ.
- `npm run test:all` completed locally with a clean run.

Once every item above is complete, templ is live on Cloudflare with production-ready monitoring and notifications.
