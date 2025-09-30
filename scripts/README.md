# Scripts

> Entry points for recurring developer tasks: deploy a templ, spin up wallets, or mirror CI locally.

Run each script from the repo root unless noted. All commands assume dependencies are installed (`npm ci`, package-specific installs) and any required environment variables are present.

## Why this document matters
- Deploy templs consistently across environments with `deploy.js`.
- Generate deterministic wallets and ERC-20 balances for local testing.
- Reproduce the full CI pipeline locally before opening a PR.

## At a glance
- `deploy.js` - stand up a factory/templ pair with environment-driven configuration and save deployment metadata (accepts percentages that the script converts to the 10_000 basis-point scale used on-chain).
- `deploy-cloudflare.js` - apply the D1 schema (optional), build the SPA with production env vars, and push the site to Cloudflare Pages from a single env file. The backend must be deployed separately now that Workers hosting has been retired, so pass `--skip-worker` when you only need database prep + Pages.
- `register-templ.js` - register an already-deployed templ with the backend API so the UI/alerts can discover it.
- `gen-wallets.js` - mint fresh Hardhat wallets (and optional ERC-20 balances) for local integration or e2e runs.
- `test-all.sh` - replicate CI locally in four phases so regressions surface before pushing.

## deploy.js
- Deploys `TemplFactory` (when `FACTORY_ADDRESS` is unset) and creates a new templ via `createTemplWithConfig`.
- Accepts either `PROTOCOL_PERCENT` (0–100) or `PROTOCOL_BP` (0–10_000) and normalises them to the 10_000 basis-point scale before broadcasting.
- Reads configuration from `.env` (fee splits, quorum, delay, burn address) and persists outputs under `deployments/`.
- Validates invariants locally (percent totals, entry-fee divisibility, quorum/delay bounds) before broadcasting and automatically reuses the factory’s on-chain protocol share when `FACTORY_ADDRESS` is supplied (any `PROTOCOL_PERCENT` override is ignored in that case).
- Recognizes `PRIEST_IS_DICTATOR=1`/`true` to bypass proposal governance and grant the priest instant control of all DAO actions; the toggle can be flipped later through the on-chain `setDictatorship` governance proposal.
- When `BACKEND_URL` is exported, automatically signs the registration payload with the priest wallet and POSTs it to `${BACKEND_URL}/templs`, printing the binding code returned by the backend.

**Run:** `npx hardhat run scripts/deploy.js --network <network>`

## deploy-cloudflare.js
- Consumes a `.env` (see `cloudflare.deploy.example.env`) to fill database vars/secrets, point the frontend build at your backend URL, and name the Cloudflare Pages project.
- Generates `backend/wrangler.deployment.toml`, applies the D1 schema, and deploys the static frontend to Pages. Pass `--skip-worker` when the backend runs outside Cloudflare Workers (Worker-only env vars become optional in that mode).
- Supports `--skip-pages` when you only need to prepare the database schema.

**Run:**
```bash
cp scripts/cloudflare.deploy.example.env .cloudflare.env
# edit .cloudflare.env, then
npm run deploy:cloudflare
```

## register-templ.js
- Registers an existing templ contract with the backend REST API using the priest wallet (requires the priest key in `PRIVATE_KEY`).
- Supports optional `TELEGRAM_CHAT_ID`/`TEMPL_HOME_LINK` env vars so the initial metadata lands on the backend immediately.

**Run:**
```bash
export BACKEND_URL=http://localhost:3001
export TEMPL_ADDRESS=0x...
export PRIVATE_KEY=0x...   # priest wallet
npx hardhat run scripts/register-templ.js --network <network>
```

## gen-wallets.js
- Generates funded Hardhat wallets for local testing and writes them to `wallets.local.json`.
- Optionally mints ERC-20 test tokens when invoked with `--token <address>` using the Hardhat default funder.

**Run:** `node scripts/gen-wallets.js [count] [--token <address>]`

## test-all.sh
- Orchestrates the monorepo CI flow locally: contracts + Slither + type checks (phase 1), backend tests/lint (phase 2), frontend unit/lint (phase 3), and frontend Playwright e2e (phase 4).
- Stops on the first failing phase while reporting which command failed, making it easy to rerun the culprit.
- Requires Slither tooling to be available in `$PATH` (`npm run slither:ci`).

**Run:** `./scripts/test-all.sh`

---

If you need to zoom back out, revisit the [root README](../README.md) or jump to the relevant package docs for deeper context.
