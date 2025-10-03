# Deployment Guide

This guide promotes templ to production with a Fly-hosted backend and a Cloudflare Pages frontend. Follow each section in order to ship contracts, services, and interfaces with consistent configuration.

## 1. Prerequisites

- Node.js 22.18.0 or newer and npm 10+ (matches the repo `engines`).
- Fly account with the [Fly CLI](https://fly.io/docs/hands-on/install-flyctl/) authenticated (`fly auth login`).
- Cloudflare account with access to Pages and an API token that can deploy static sites (Pages → Edit permission).
- Telegram bot token for production alerts (generated via [@BotFather](https://t.me/botfather)).
- Local checkout with dependencies installed:

  ```bash
  npm ci
  npm --prefix backend ci
  npm --prefix frontend ci
  ```

- Optional but recommended: dedicated DNS entries for the production API (`api.templ.example`) and frontend (`app.templ.example`).

## 2. Deploy the TemplFactory contract

1. Export chain credentials and protocol split information:

   ```bash
   export RPC_URL=https://base-mainnet.g.alchemy.com/v2/your-key
   export PRIVATE_KEY=0xyourdeployerkey
   export PROTOCOL_FEE_RECIPIENT=0xProtocolTreasury
   export PROTOCOL_PERCENT=10   # optional: converts to 1_000 bps
   # or
   export PROTOCOL_BP=1000      # provide basis points directly
   ```

2. Deploy the factory:

   ```bash
   npx hardhat run scripts/deploy-factory.js --network base
   ```

   The script prints the factory address, transaction hash, and confirmed block number. Copy those values.

3. Export trusted factory metadata so later steps can reuse it:

   ```bash
   export TRUSTED_FACTORY_ADDRESS=<factory address>
   export TRUSTED_FACTORY_DEPLOYMENT_BLOCK=<factory deploy block>
   ```

4. (Recommended) Verify the factory on BaseScan:

   ```bash
   npx hardhat verify --network base $TRUSTED_FACTORY_ADDRESS $PROTOCOL_FEE_RECIPIENT <protocolPercentBps from script output>
   ```

   The deployment helper prints the exact protocol share in basis points—reuse that value when verifying.

5. When the community is ready for public templ creation, call `setPermissionless(true)` from the deployer wallet. Every templ inherits the immutable protocol recipient and percent baked into the factory.

## 3. Prepare the Fly backend

1. Copy the provided Fly template and adjust placeholders:

   ```bash
   cp backend/fly.example.toml backend/fly.toml
   ```

   Update `app`, `primary_region`, and any sizing preferences to match your Fly account. The template references `backend/Dockerfile`, exposes port `3001`, and mounts `/var/lib/templ` for SQLite.

2. Create a persistent volume so the SQLite database survives deploys and restarts:

   ```bash
   fly volumes create templ_data --size 1 --region <region> --app <app-name>
   ```

3. Configure runtime secrets. At minimum provide:

   ```bash
   fly secrets set \
     RPC_URL=$RPC_URL \
     APP_BASE_URL=https://app.templ.example \
     BACKEND_SERVER_ID=templ-prod \
     TRUSTED_FACTORY_ADDRESS=$TRUSTED_FACTORY_ADDRESS \
     TRUSTED_FACTORY_DEPLOYMENT_BLOCK=$TRUSTED_FACTORY_DEPLOYMENT_BLOCK \
     REQUIRE_CONTRACT_VERIFY=1 \
     ALLOWED_ORIGINS=https://app.templ.example \
     TELEGRAM_BOT_TOKEN=<bot token or omit for no Telegram>
   ```

   Add `REDIS_URL` and `RATE_LIMIT_STORE=redis` if you plan to attach a managed Redis instance for distributed rate limiting. All other environment variables listed in `docs/BACKEND.md` may also be supplied through Fly secrets.

4. Deploy the backend:

   ```bash
   fly deploy --config backend/fly.toml
   ```

   The Docker build uses `backend/Dockerfile`, installs production dependencies, and starts `npm --prefix backend start` on port `3001`. The `SQLITE_DB_PATH` environment variable in `fly.toml` points at the mounted volume.

5. Verify the service after the deploy finishes:

   ```bash
   fly logs --app <app-name>
   fly open --app <app-name>
   ```

   Successful boot logs include `TEMPL backend listening`. Configure DNS (or a reverse proxy) so your public API domain points to `<app-name>.fly.dev`.

## 4. Deploy the frontend to Cloudflare Pages

1. Start from the sample env file and populate it with production values:

   ```bash
   cp scripts/cloudflare.deploy.example.env .cloudflare.env
   ```

   Set:
   - `CF_PAGES_PROJECT` and optional `CF_PAGES_BRANCH`.
   - `VITE_BACKEND_URL` (Fly API URL), `VITE_BACKEND_SERVER_ID`, `VITE_TEMPL_FACTORY_ADDRESS`, `VITE_TEMPL_FACTORY_DEPLOYMENT_BLOCK`.
   - Any optional overrides (`VITE_TEMPL_FACTORY_PROTOCOL_RECIPIENT`, `VITE_TEMPL_FACTORY_PROTOCOL_PERCENT`, `VITE_RPC_URL`).

2. Deploy with the bundled helper:

   ```bash
   npm run deploy:cloudflare -- --env-file .cloudflare.env
   ```

   The script builds the Vite app with the supplied environment variables and publishes `frontend/dist/` to the configured Cloudflare Pages project.

3. Point your frontend domain (for example `app.templ.example`) at the Pages project using Cloudflare DNS.

## 5. Register templs and bind Telegram

1. Confirm the backend responds:

   ```bash
   curl https://api.templ.example/templs
   # -> {"templs": []}
   ```

2. Visit the production frontend, connect the priest wallet, and create a templ. When `TRUSTED_FACTORY_ADDRESS` and `RPC_URL` are configured the backend consumes the factory event and registers the templ automatically, so the deployer only signs again if they choose to bind Telegram.

3. If necessary (for example when backfilling historical templs or running without the factory indexer), register templs manually:

   ```bash
   export BACKEND_URL=https://api.templ.example
   export TEMPL_ADDRESS=<templ address>
   export PRIVATE_KEY=0xPriestKey
   npx hardhat run scripts/register-templ.js --network base
   ```

4. Bind Telegram notifications by inviting `@templfunbot` to the target group and either tapping `https://t.me/templfunbot?startgroup=<bindingCode>` or sending `/templ <bindingCode>` in the chat. The backend persists the chat id in SQLite and acknowledges the binding.

## 6. Production smoke checks

- Load the Cloudflare Pages URL and confirm templ discovery works with the production factory.
- Join a templ, cast a proposal, execute it, and watch Telegram notifications roll through.
- Run Playwright smoke tests against production endpoints (requires the same Vite environment variables used for the build):

  ```bash
  VITE_BACKEND_URL=https://api.templ.example \
  VITE_BACKEND_SERVER_ID=templ-prod \
  VITE_TEMPL_FACTORY_ADDRESS=$TRUSTED_FACTORY_ADDRESS \
  VITE_TEMPL_FACTORY_DEPLOYMENT_BLOCK=$TRUSTED_FACTORY_DEPLOYMENT_BLOCK \
  npm --prefix frontend run test:e2e
  ```

## 7. Quick redeploy commands

Keep these snippets handy for routine updates:

- **Run database migrations** (prior to rolling out backend changes):

  ```bash
  fly ssh console -C "npm --prefix backend run migrate -- --db /var/lib/templ/templ.db"
  ```

  The migration runner executes every SQL file under `backend/migrations/` (for example `001_drop_telegram_unique.sql`) that has not been recorded in `schema_migrations`.

- **Deploy the backend container** (after migrations succeed):

  ```bash
  fly deploy --config backend/fly.toml
  ```

- **Publish the frontend** (Cloudflare Pages):

  ```bash
  npm run deploy:cloudflare -- --env-file .cloudflare.env --skip-worker
  ```

Run the trio in that order whenever a release touches the schema, API, or UI.

## 8. Final checklist

- Contracts deployed (and optionally verified) on the target network.
- Fly backend healthy with SQLite volume attached and required secrets set (`RPC_URL`, `APP_BASE_URL`, `BACKEND_SERVER_ID`, `TRUSTED_FACTORY_ADDRESS`, etc.).
- Cloudflare Pages serving the built SPA that targets the Fly API.
- Telegram bindings confirmed for each templ that needs alerts.
- `npm run test:all` completed successfully on the code that you shipped.
- DNS updated so `api.templ.example` points to the Fly app and `app.templ.example` points to the Pages project.

Once every item is complete, templ is live with a persistent backend, globally cached frontend, and full Telegram supervision.
