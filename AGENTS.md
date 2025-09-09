# Repository Guidelines

## Project Structure & Module Organization
- `contracts/`: Solidity sources (0.8.23) with Hardhat; tests in `test/`; deployment utilities in `scripts/`.
- `backend/`: Node (ESM) service. Entry `backend/src/server.js`; tests in `backend/test/*.test.js`; runtime config in `backend/.env`.
- `frontend/`: Vite + React app. Source in `frontend/src/`; unit tests in `frontend/src/*.test.js`; e2e in `frontend/e2e/` (Playwright configs provided).
- CI: `.circleci/`; Docs: `README.md`, `BACKEND.md`, `FRONTEND.md`, `CONTRACTS.md`, `CORE_FLOW_DOCS.MD`, `PERSISTENCE.md`, `WEB3_AUDIT_REPORT.MD`.

## Build, Test, and Development Commands
- Contracts: `npm run compile`, `npm test`, `npm run node`, `npm run deploy:local`, `npm run slither`.
- Backend: `npm --prefix backend start`, `npm --prefix backend test`, `npm --prefix backend lint[:fix]`.
- Frontend: `npm --prefix frontend run dev`, `test`, `test:e2e`, `build`, `preview`.
- Integration: `npm --prefix frontend run test -- src/core-flows.integration.test.js` (hits Hardhat, backend, XMTP dev).
- Prereqs: Node `22.18.0`. Enable hooks with `npm run prepare` (Husky).

## Coding Style & Naming Conventions
- JavaScript/JSX: ESLint (flat config, recommended). Use 2‑space indent; lowerCamelCase for variables/functions; PascalCase for React components; constants `UPPER_SNAKE_CASE`. Test files end with `.test.js`.
- Solidity: Solidity 0.8.23; files PascalCase (e.g., `TEMPL.sol`); functions lowerCamelCase; events PascalCase. Keep code consistent with OpenZeppelin patterns.

## Testing Guidelines
- Contracts: Hardhat + Chai via `npm test`. Include edge cases (reentrancy, access control, fee flows).
- Backend: Node test runner (`node --test`) via `npm --prefix backend test`. Place tests under `backend/test/`; use `supertest` for HTTP.
- Frontend: Vitest unit tests in `frontend/src/`; Playwright e2e in `frontend/e2e/`. Run `npm --prefix frontend test` and `npm --prefix frontend run test:e2e`.

## Commit & Pull Request Guidelines
- Commits: short, imperative subject; include scope and references (e.g., `feat(contracts): voting auto-YES + changeable`).
- PRs: clear description, linked issues, steps to test. Add screenshots/GIFs for UI; for contract changes, include deployed address, network, and migration notes; call out any `.env` updates.

## Security & Configuration Tips
- Never commit keys. Use root `.env` for deployment and `backend/.env` for the bot:
  ```env
  RPC_URL=...
  PRIVATE_KEY=0x...
  ALLOWED_ORIGINS=http://localhost:5173
  ```
- Verify target networks in `hardhat.config.js` before deploying.

## E2E & XMTP Notes
- Integration scope: `frontend/src/core-flows.integration.test.js` compiles + spawns Hardhat (`:8545`), launches backend in-process on `:3001`, connects to XMTP `env=dev`, deploys contracts locally, and exercises join/mute/vote flows end-to-end.
- Network: allow outbound network to XMTP dev and localhost ports `8545` and `3001` for integration. Playwright e2e uses XMTP production by default (set `E2E_XMTP_LOCAL=1` to use local XMTP).
- XMTP installations: dev network enforces 10 installations per inbox. Avoid reusing the same private key across many runs. Tests rotate wallets or reuse local XMTP DBs as needed.
- Vitest caching: use `frontend/vitest.config.js` (cacheDir `test-results/.vite`) to prevent writes to `node_modules`. Timeouts are increased for long setup.
- Backend CORS: set `ALLOWED_ORIGINS` (comma-separated) to your frontend origin(s) when running the standalone backend. The integration test injects the backend app directly and does not require `.env`.
- Consent warnings: benign `updateConsentState` errors from the XMTP SDK can occur; they do not affect functionality in dev.

## Playwright E2E
- Command: `npm --prefix frontend run test:e2e -- --project=tech-demo`.
- Servers: Playwright starts Hardhat (`:8545`), the backend (`:3001`), and serves the frontend via `vite build && vite preview` on `:5179`.
- Real ERC‑20: e2e deploys the actual `TestToken` artifact and calls ERC‑20 `approve` + `TEMPL#purchaseAccess` on Hardhat.
- Group discovery: the app renders chat as soon as `groupId` is known and keeps syncing to find the XMTP group; the backend also sends a welcome message to “warm” the conversation.
- Accounts: backend bot uses a random bot key; e2e wallets rotate to avoid nonce/installation collisions.

## Best Pratices

- Use `npm run test:all` to make sure the entire project works after doing code changes
- Don't leave comments about previous implementations that were removed