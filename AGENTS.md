# Repository Guidelines

## Project Structure & Module Organization
- `contracts/` — Solidity 0.8.23 sources (core `TEMPL.sol`), test-only `contracts/mocks/`. Root `test/` contains Hardhat tests.
- `backend/` — Express (ESM) API: `src/`, `test/`, `coverage/`. Uses Node ≥ 22.18.
- `frontend/` — Vite + React app: `src/`, `e2e/`, `dist/`.
- `shared/` — JS utils shared by frontend/backend/tests (e.g., `signing.js`, `xmtp.js`).
- `scripts/` — helper scripts (e.g., `deploy.js`, `test-all.sh`). `deployments/` stores network artifacts.

## Build, Test, and Development Commands
- Install deps: `npm ci`
- Contracts: `npm run compile` (Hardhat), `npm test` (unit), `npm run coverage`, `npm run slither` (requires `slither` + `solc-select`).
- Backend: `npm --prefix backend start` (requires `.env`), `npm --prefix backend test`, `npm --prefix backend run coverage`, `npm --prefix backend run lint`.
- Frontend: `npm --prefix frontend run dev`, `build`, `test`, `run coverage`, `test:e2e`.
- Local chain + deploy: `npm run node` (Hardhat node), `npm run deploy:local`.
- Full stack tests: `npm run test:all` (contracts, types, lint, unit, e2e).

## Coding Style & Naming Conventions
- JS/TS: ESM modules, 2-space indent, semicolons, camelCase for identifiers. Lint with `eslint` in each package (`eslint.config.js`).
- React: Co-locate component tests as `*.test.js` under `frontend/src/`.
- Solidity: PascalCase filenames (`TEMPL.sol`), 4-space indent; keep errors in `TemplErrors.sol`. Set `SKIP_MOCKS=true` to exclude `contracts/mocks/` from builds.

## Testing Guidelines
- Frameworks: Hardhat (Mocha/Chai) for contracts; Node’s `node --test` + `c8` for backend; Vitest for frontend; Playwright for e2e.
- Naming: `*.test.js` in `test/` (contracts) and `backend/test/`; e2e in `frontend/e2e/`.
- Coverage: Codecov enforces 100% for contracts; run `npm run coverage:all` or per-package coverage before PRs.

### Agent Notes
- If XMTP conversations are not discovered during deploy/join flows, **do not** extend timeouts or retries. Investigate conversation creation: ensure the priest inbox ID is deterministically included in `newGroup` and that backend watchers hydrate the group. Increasing wait loops only masks real regressions and makes `test:all` flaky.

## Commit & Pull Request Guidelines
- Use Conventional Commits: `feat(contracts): ...`, `fix(backend): ...`, `docs: ...`, `chore: ...`, `ci: ...`.
- PRs: clear description, linked issues, test plan, screenshots for UI changes, CI green, no snapshot updates without justification.

## Security & Configuration Tips
- Do not commit secrets. Use `.env`; production requires `BACKEND_DB_ENC_KEY`. Deploys need `RPC_URL` and `PRIVATE_KEY`.
- Backend/Frontend must share server id: `BACKEND_SERVER_ID` = `VITE_BACKEND_SERVER_ID`.
- Rate limiting auto-uses Redis when `REDIS_URL` is set; otherwise falls back to memory.
