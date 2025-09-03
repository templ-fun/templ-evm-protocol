# TEMPL

<p align="center">
<img width="300" alt="templ logo" src="https://github.com/user-attachments/assets/fa3513b4-75e4-4dbf-a1fb-73e9e27d766f" />
</p>
<p align="center">
<a href="https://templ.fun">templ.fun</a> 
</p>

## Architecture

A TEMPL is composed of three parts that work together:

- **Smart contracts** on Base gate access by requiring a paid `purchaseAccess` call.
- **Backend bot** owns the XMTP group and only invites wallets that purchased.
- **React frontend** deploys contracts, verifies purchases and lets members chat.

The frontend calls the contract to purchase membership, then asks the backend to invite
the wallet into the group. The backend can also watch contract events and forward
proposal or vote updates to the chat.

## Documentation
Use the docs below to dive into each component:

- [CONTRACTS.md](./CONTRACTS.md) – smart‑contract specification
- [BACKEND.md](./BACKEND.md) – XMTP bot and API
- [FRONTEND.md](./FRONTEND.md) – React client
- [CORE_FLOW_DOCS.MD](./CORE_FLOW_DOCS.MD) – core flow service diagrams
  
In addition, all core workflows are covered by automated tests:
- Contract unit tests (Hardhat + Chai)
- Backend API tests (Node test runner + supertest)
- Frontend unit + integration tests (Vitest)
- End‑to‑end tests (Playwright) hitting: local Hardhat, XMTP dev network, backend + SQLite, and the React app

XMTP discovery note
- After a member is added to a group, the browser explicitly calls `conversations.sync()` to fetch new welcomes, then proceeds with `preferences.sync()` and `conversations.syncAll([...])`, polling `getConversationById` and briefly streaming conversations/messages until the group is found.
- On production XMTP, this discovery can lag; the app renders the chat as soon as `groupId` is known. For CI/e2e only, it can temporarily use the backend `/send` endpoint so messages still post to the group while the browser syncs. This is gated by `VITE_ENABLE_BACKEND_FALLBACK` and is off in production builds.

## Quick start
1. **Clone & install**
   ```bash
   git clone <repo>
   cd templ
   npm install # install contract tests and deployment dependencies
   npm --prefix backend install
   npm --prefix frontend install
   npm run prepare # enable Husky pre‑commit
   pipx install slither-analyzer solc-select # install Slither and solc-select
   ```
2. **Run tests**
   ```bash
   npm run test:all # full sweep: contracts, slither, types, lint, unit, integration, e2e
   npm test # run contract tests
   npm run slither
   npm --prefix backend test
   npm --prefix frontend test # unit tests
   npm --prefix frontend test -- src/core-flows.integration.test.js # integration tests
   npm --prefix frontend run test:e2e # end‑to‑end tests
   npm --prefix backend run typecheck && npm --prefix frontend run typecheck
   npm --prefix backend run lint && npm --prefix frontend run lint
   ```
   To run e2e against a local XMTP node:
   ```bash
   git clone https://github.com/xmtp/xmtp-local-node.git
   # requires Docker; this brings up ports 5555 (API) and 5558 (history)
   npm run xmtp:local:up
   E2E_XMTP_LOCAL=1 npm --prefix frontend run test:e2e -- --project=tech-demo
   # tear down when done
   npm run xmtp:local:down
   ```
   Check node logs with:
   ```bash
   (cd xmtp-local-node && docker compose logs -f)
   ```
   End‑to‑end details: Playwright spins up Hardhat (8545), the backend bot (3001), and serves the built frontend (5179). The e2e uses XMTP production to mirror real‑world behavior and tests both a Node↔Browser discovery PoC and the full core flows. See also `XMTP-E2E-BROWSER-DISCOVERY-ISSUE.md` for deeper context on discovery.
3. **Deploy contracts**
   ```bash
   npx hardhat run scripts/deploy.js --network base
   ```
4. **Configure environment files**
   - **Root `.env`** – used by deployment scripts. Populate values like RPC URL and deployer keys (see *Deploying to production* below).
  - **`backend/.env`** – used only by the XMTP bot. Copy any shared values from the root `.env` or provide separate ones as needed.
    Include `ALLOWED_ORIGINS` with the frontend URLs allowed to call the API.
  ```env
  # backend/.env
  RPC_URL=https://mainnet.base.org
  BOT_PRIVATE_KEY=0x...
  ALLOWED_ORIGINS=http://localhost:5173
  ```
5. **Launch backend bot**
   ```bash
   npm --prefix backend start
   ```
6. **Start frontend**
   ```bash
   npm --prefix frontend run dev
   ```

## Deploying to production
1. Create a `.env` file in the project root for the deployment scripts. This file is distinct from `backend/.env` used by the bot; copy any overlapping variables (e.g., `RPC_URL`, keys) into `backend/.env` if the bot requires them. The bot's key (`BOT_PRIVATE_KEY`) belongs only in `backend/.env`. The deploying wallet becomes the priest automatically, so `PRIEST_ADDRESS` is only needed when overriding in tests.
    ```env
    PROTOCOL_FEE_RECIPIENT=0x...
    TOKEN_ADDRESS=0x...
    ENTRY_FEE=100000000000000000 # wei
    RPC_URL=https://mainnet.base.org
    PRIVATE_KEY=0x...
    PRIEST_VOTE_WEIGHT=10
    PRIEST_WEIGHT_THRESHOLD=10
    BASESCAN_API_KEY=...
    ```
   See [`CONTRACTS.md`](./CONTRACTS.md) for the full list of supported variables.
2. Run the full test suite and Slither analysis.
3. Deploy with `scripts/deploy.js` and record the contract address and XMTP group ID.
4. Host the backend bot (e.g., on a VM) using the contract address and bot key. Ensure
   `backend/.env` sets `ALLOWED_ORIGINS` to the frontend URL(s) permitted to call the API.
5. Build the frontend (`npm --prefix frontend run build`) and serve the static files.

## Core flows
1. **Templ creation** – deploy contract and create a private XMTP group with the priest added at creation time.
2. **Pay‑to‑join** – wallet calls `purchaseAccess` and backend invites it into the group.
3. **Messaging** – members send and receive XMTP messages in the group chat.
4. **Priest muting** – priest can silence members or delegate that power to
   other moderators via the backend. Each mute is recorded in SQLite with
   escalating durations of 1 hour, 1 day, 1 week, 1 month and finally
   permanent after the fifth strike. Frontends query the backend for active
   mutes and hide messages from muted addresses.
5. **Proposal creation** – any member drafts a call‑data proposal from the chat UI (or direct on‑chain). The backend rebroadcasts ProposalCreated as JSON to the group.
6. **Voting** – members cast yes/no votes and see live tallies as events arrive.
7. **Proposal execution** – proposals that pass execute the calldata.

For auditing guides, continue with the docs linked above.

## Security considerations
- Proposals invoking `executeDAO` can call any external contract with ETH.
  Members should carefully audit these proposals because malicious or misconfigured calls can drain funds or interact with unsafe contracts.
 - The backend owns the XMTP group. The priest does not control membership directly; actions are mediated via the backend’s bot, which verifies on‑chain purchase. See BACKEND.md for API auth and rate‑limit details.
 - XMTP dev network has a 10‑installation limit per inbox. Tests rotate wallets or reuse local XMTP databases to avoid hitting this limit.
 - For auditors: CONTRACTS.md documents all custom errors, events, invariants, fee splits, and DAO constraints. The Hardhat test suite covers these invariants; Slither reports are part of CI.
