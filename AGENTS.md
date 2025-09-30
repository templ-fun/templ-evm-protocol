# Repository Guidelines

## Project Structure & Module Organization
- `contracts/` holds Solidity sources; Hardhat scripts in `scripts/` emit artifacts to `deployments/`.
- `backend/src/` runs the Express API, Telegram notifier, and persistence layers.
- `frontend/src/` is the Vite + React control center; shared utilities live in `shared/` with tests beside code (`test/`, `e2e/`).

## Build, Test, and Development Commands
- Install dependencies via `npm ci`, `npm --prefix backend ci`, and `npm --prefix frontend ci`.
- Compile with `npm run compile`, start `npx hardhat node`, and launch services through `npm --prefix backend start` plus `npm --prefix frontend run dev`.
- Run targeted checks using `npm test`, `npm --prefix backend test`, `npm --prefix frontend run test`, and Playwright via `npm --prefix frontend run test:e2e`.

## Coding Style & Naming Conventions
- Use 2-space indentation, trailing semicolons, and ESM imports enforced by each package’s `eslint.config.js`.
- React components stay in PascalCase files; hooks and utilities use camelCase and sit with their feature.
- Solidity contracts follow Hardhat defaults (`PascalCase` types, `camelCase` functions`) and document external/public entry points with NatSpec.

## Testing & CI Discipline
- Always run `npm run test:all` before handoff; CI reruns the same matrix after merge, so local results must stay green.
- When fixing a bug, first add a failing test that proves the issue, then ship the patch and validate the full suite.
- Track coverage with `npm --prefix backend run coverage` and `npm --prefix frontend run coverage`; keep specs under each package `test/` directory.

## Documentation Expectations
- Update docs alongside code so the repo remains the canonical protocol reference—write as though the current codebase is the only version that ever existed.
- When writing docs, avoid historical framing or phrases such as “no longer”, “now”, or “before”; describe behavior as timeless facts of the current system.
- Refresh `README.md`, `docs/*.md`, and in-app copy whenever behavior, configuration, or APIs shift; verify every example still runs.

## Commit & Pull Request Guidelines
- Follow Conventional Commits (`fix(frontend): harden loadFactoryTempls block lookup`) with focused scopes and linked issues as needed.
- List the automated/manual checks you ran, attach UI evidence for visual changes, and call out migrations or deployment steps in the PR body.

## Security & Configuration Tips
- Load secrets from `.env` files (`RPC_URL`, `ALLOWED_ORIGINS`, `TELEGRAM_BOT_TOKEN`, D1 credentials`) and never commit them.
- Reuse signature validation and rate-limit middleware from `backend/src/middleware/`; align schema changes with `createPersistence` helpers.
- Dry-run releases with `npm run deploy:local`, confirm Telegram binding flows, and rotate codes through priest controls when handing off access.
