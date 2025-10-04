# Repository Guidelines

## Quick orientation

- Stack summary: Hardhat contracts in `contracts/`, Node/Express backend in `backend/`, Vite + React frontend in `frontend/`, and shared signing/XMTP helpers in `shared/`.
- XMTP is first-class. The backend orchestrates group creation/joining; the frontend talks directly to XMTP and the backend. Tests depend on a local XMTP node for fast feedback and the hosted XMTP network for production parity.

## Project structure & modules

- `contracts/` – Solidity sources; Hardhat tasks in `scripts/` emit artifacts to `deployments/`.
- `backend/src/` – Express API, Telegram notifier, persistence, and XMTP orchestration.
- `frontend/src/` – Vite + React SPA; shared utilities/tests live beside code (`test/`, `e2e/`).
- `shared/` – Typed-data builders and XMTP helpers consumed by backend and frontend.

## Local setup & runtime commands

- Install dependencies via `npm ci`, `npm --prefix backend ci`, and `npm --prefix frontend ci`.
- Compile contracts with `npm run compile`; start Hardhat with `npx hardhat node`.
- Launch services via `npm --prefix backend start` and `npm --prefix frontend run dev` (make sure `.env` files align with `docs/TEST_LOCALLY.md`).
- To exercise XMTP locally, initialize the submodule and bring the node up: `git submodule update --init xmtp-local-node` then `npm run xmtp:local:up`. Tear it down with `npm run xmtp:local:down` when finished. Docker Desktop (or another daemon) must be running.
- Run targeted checks using `npm test`, `npm --prefix backend test`, `npm --prefix frontend run test`, and Playwright via `npm run test:e2e:local` (fast path) or `npm run test:e2e:prod` (hosted XMTP). `npm run test:e2e:matrix` runs both and skips the local leg automatically when Docker is unavailable.

## Coding Style & Naming Conventions

- Use 2-space indentation, trailing semicolons, and ESM imports enforced by each package’s `eslint.config.js`.
- React components stay in PascalCase files; hooks and utilities use camelCase and sit with their feature.
- Solidity contracts follow Hardhat defaults (`PascalCase` types, `camelCase` functions`) and document external/public entry points with NatSpec.

## Testing & CI Discipline

- Always run `npm run test:all` ahead of handoff; it drives the full suite (contracts, lint, type checks, Playwright matrix) and cleans XMTP artifacts.
- CI executes `npm run test:e2e:matrix`, which runs the local XMTP flow when Docker is available and always runs the production XMTP flow; plan your changes so both legs pass in advance of opening a PR.
- When fixing a bug, first add a failing test that proves the issue, then ship the patch and validate the full suite.
- Track coverage with `npm --prefix backend run coverage` and `npm --prefix frontend run coverage`; keep specs under each package `test/` directory.

## Documentation Expectations

- Update docs alongside code so the repo remains the canonical protocol reference—write as though the current codebase is the only version that ever existed.
- When writing docs, avoid historical framing or temporal phrases such as “no longer”; describe behavior as timeless facts of the current system without referencing earlier versions.
- Refresh `README.md`, `docs/*.md`, and in-app copy whenever behavior, configuration, or APIs shift; verify every example still runs.

## Commit & Pull Request Guidelines

- Follow Conventional Commits (`fix(frontend): harden loadFactoryTempls block lookup`) with focused scopes and linked issues as needed.
- List the automated/manual checks you ran, attach UI evidence for visual changes, and call out migrations or deployment steps in the PR body.

## Security & Configuration Tips

- Load secrets from `.env` files (`RPC_URL`, `ALLOWED_ORIGINS`, `TELEGRAM_BOT_TOKEN`, `SQLITE_DB_PATH`, etc.) and never commit them.
- Reuse signature validation and rate-limit middleware from `backend/src/middleware/`; align schema changes with `createPersistence` helpers.
- Dry-run releases with `npm run deploy:local`, confirm Telegram binding flows, and rotate codes through priest controls when handing off access.
