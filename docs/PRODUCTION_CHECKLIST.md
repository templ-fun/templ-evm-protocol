# Production Readiness Checklist

Use this checklist before every release to confirm the contracts, backend, frontend, and deployment scripts still match the documentation and behave as expected. Every item maps to real code paths or scripts in the repo so you can verify them quickly.

## 1. Run the full automated test suite

| Area | Command | Notes |
| --- | --- | --- |
| Solidity contracts | `npm test` | Hardhat compiles with Solidity 0.8.23 and runs the full `contracts/` suite (250 tests). |
| Backend API + shared helpers | `npm --prefix backend test` | Executes the Node test runner across `backend/test/**/*.test.js` and `shared/**/*.test.js`. |
| Backend lint + types | `npm --prefix backend run lint`<br>`npm --prefix backend run typecheck` | Lint relies on `eslint.config.js`; the typecheck uses `tsconfig.json` to validate JSDoc/TypeScript hints. |
| Frontend unit tests | `npm --prefix frontend test` | Vitest exercises React hooks, services, and page behaviours. |
| Frontend lint + types | `npm --prefix frontend run lint`<br>`npm --prefix frontend run typecheck` | Ensures the SPA follows our ESLint rules and passes the TypeScript config. |
| Smoke everything | `npm run test:all` | Runs the scripted phases in [`scripts/test-all.sh`](../scripts/test-all.sh) including Cloudflare deploy smoke, contract tests, backend/frontend lint + tests, and Playwright E2E. |

All commands assume dependencies were installed with `npm ci`, `npm --prefix backend ci`, and `npm --prefix frontend ci` per the root `README.md`.

## 2. Configuration hardening

Make sure production environments align with the backend configuration logic in [`backend/src/server.js`](../backend/src/server.js) and [`backend/src/config.js`](../backend/src/config.js):

- Set `NODE_ENV=production`, `REQUIRE_CONTRACT_VERIFY=1`, and point `RPC_URL` at a reliable provider so `/templs` registration enforces on-chain priest verification.
- Lock the deployment down to your factory with `TRUSTED_FACTORY_ADDRESS` and `TRUSTED_FACTORY_DEPLOYMENT_BLOCK`.
- Provide `APP_BASE_URL` so Telegram deep links match the public frontend, and `BACKEND_SERVER_ID` that matches the SPA’s `VITE_BACKEND_SERVER_ID`.
- Supply `TELEGRAM_BOT_TOKEN` before enabling notifications; the notifier in [`backend/src/telegram.js`](../backend/src/telegram.js) skips delivery when the token is absent.
- Decide on rate limiting: leave the default in-memory `express-rate-limit` store for single-instance runs or set `RATE_LIMIT_STORE=redis`/`REDIS_URL` to trigger the Redis store created by [`createRateLimitStore`](../backend/src/config.js#L14-L48).
- Configure persistence. Backends with Cloudflare D1 or SQLite use [`backend/src/persistence/schema.sql`](../backend/src/persistence/schema.sql) to provision `templ_bindings`, `used_signatures`, and `leader_election` tables; provide `SQLITE_DB_PATH` when running outside Workers.
- Review `LEADER_TTL_MS` (default 60s, minimum 15s) so leader election matches your deployment cadence.

## 3. Frontend + backend env alignment

- Confirm `frontend/src/config.js` reads your overrides (`VITE_TEMPL_FACTORY_ADDRESS`, `VITE_TEMPL_FACTORY_PROTOCOL_RECIPIENT`, `VITE_TEMPL_FACTORY_PROTOCOL_PERCENT`, `VITE_TEMPL_FACTORY_DEPLOYMENT_BLOCK`, `VITE_RPC_URL`). Every production build should set these so the SPA can discover templs without scanning the entire chain.
- Keep `VITE_BACKEND_URL` and `VITE_BACKEND_SERVER_ID` aligned with the backend values to avoid signature mismatches.
- When generating production builds through `scripts/deploy-cloudflare.js`, feed extra overrides with the `FRONTEND_BUILD_VAR_*` prefix (for example `FRONTEND_BUILD_VAR_VITE_RPC_URL`) so the helper passes them to `npm --prefix frontend run build` without editing the base env file.

## 4. Deployment script expectations

[`scripts/deploy-cloudflare.js`](../scripts/deploy-cloudflare.js) orchestrates the Cloudflare deployment:

1. Loads `.cloudflare.env` (or a custom file) and applies the D1 schema from [`backend/src/persistence/schema.sql`](../backend/src/persistence/schema.sql).
2. Generates `backend/wrangler.deployment.toml` with your Worker name, D1 binding, and backend variables. Set `WRANGLER_BIN` when you need a specific Wrangler executable (the mocks in `scripts/__mocks__` cover CI smoke tests).
3. Syncs secrets via Wrangler when not using `--skip-worker` and deploys the Worker.
4. Builds the frontend with the resolved `VITE_*` env (plus any `FRONTEND_BUILD_VAR_*` overrides) and publishes it to Cloudflare Pages unless `--skip-pages` is supplied.

You still need to deploy the long-lived backend service (Render, Fly, Railway, etc.) separately; the script only ensures your D1 schema and Pages bundle are in sync.

## 5. Operational smoke checks

After deploying:

- Hit `GET /templs` and `POST /join` manually or via the UI to confirm the backend still enforces address validation and signature replay protection (see [`backend/src/middleware/validate.js`](../backend/src/middleware/validate.js)).
- Watch logs for the `createPersistence` adapter (D1/SQLite fallback) to make sure bindings and leader election entries are created.
- Invite `@templfunbot` to a test group, post the binding code, and verify Telegram alerts for `AccessPurchased`, `ProposalCreated`, and `ProposalExecuted` events are emitted (listeners defined in [`backend/src/server.js`](../backend/src/server.js)).
- Exercise `/templs/rebind` once to confirm the priest signature guard works before relying on it in production rotations.

Work through every step whenever contracts or infrastructure change—keeping this checklist updated prevents the docs from drifting away from the behaviour encoded in the repo.
