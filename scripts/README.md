# Scripts

> Entry points for recurring developer tasks: deploy a templ, spin up wallets, or mirror CI locally.

Run each script from the repo root unless noted. All commands assume dependencies are installed (`npm ci`, package-specific installs) and any required environment variables are present.

## Why this document matters
- Deploy templs consistently across environments with `deploy.js`.
- Generate deterministic wallets and ERC-20 balances for local testing.
- Reproduce the full CI pipeline locally before opening a PR.

## At a glance
- `deploy.js` - stand up a factory/templ pair with environment-driven configuration and save deployment metadata.
- `gen-wallets.js` - mint fresh Hardhat wallets (and optional ERC-20 balances) for local integration or e2e runs.
- `test-all.sh` - replicate CI locally in four phases so regressions surface before pushing.

## deploy.js
- Deploys `TemplFactory` (when `FACTORY_ADDRESS` is unset) and creates a new templ via `createTemplWithConfig`.
- Reads configuration from `.env` (fee splits, quorum, delay, burn address) and persists outputs under `deployments/`.
- Validates invariants locally (percent totals, entry-fee divisibility, quorum/delay bounds) before broadcasting.
- Recognizes `PRIEST_IS_DICTATOR=1`/`true` to bypass proposal governance and grant the priest instant control of all DAO actions.

**Run:** `npx hardhat run scripts/deploy.js --network <network>`

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
