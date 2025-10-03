# Test Locally (Fast Path)

Use this doc to spin up the full templ stack—Hardhat chain, Express backend, and React frontend—so you can deploy a templ, verify membership, and run proposals without relying on external services. Treat it as your first-day checklist: install once, copy the provided `.env` templates, and you’ll have everything running in a few minutes.

## Before you start

1. **Check your toolchain.**

   ```bash
   node --version  # should be >= 22.18.0
   npm --version   # should be >= 10
   ```

2. **Install dependencies once.** Run these from the repository root so Hardhat, the backend, and the frontend all share a consistent lockfile:

   ```bash
   npm ci
   npm --prefix backend ci
   npm --prefix frontend ci
   ```

3. **Copy the example env files (optional but handy).**

   ```bash
   cp backend/.env.test backend/.env          # then tweak values in the next step
   cp frontend/.env.example frontend/.env.local 2>/dev/null || true
   ```

   The backend sample already sets `BACKEND_SERVER_ID=templ-dev` and `APP_BASE_URL=http://localhost:5173` so the next section's values
   line up without edits. The frontend ships sensible defaults, so creating `frontend/.env.local` is optional unless you want to
   override URLs later.

## 1) Start a local Hardhat chain

Terminal A:

```bash
npm run node
```

Hardhat exposes JSON-RPC on `http://127.0.0.1:8545` and pre-funds 20 deterministic accounts.

## 2) Configure & start the backend

Create or update `backend/.env`:

```env
RPC_URL=http://127.0.0.1:8545
ALLOWED_ORIGINS=http://localhost:5173
BACKEND_SERVER_ID=templ-dev
APP_BASE_URL=http://localhost:5173
# Optional: wire up Telegram notifications by providing a bot token.
# TELEGRAM_BOT_TOKEN=123456:bot-token-from-botfather
# Optional: persist data locally between restarts.
# SQLITE_DB_PATH=./templ.local.db
```

Terminal B:

```bash
npm --prefix backend start
```

The server listens on `http://localhost:3001`, verifies signatures, persists templ registrations in the in-memory adapter (matching the SQLite schema), and—if a `TELEGRAM_BOT_TOKEN` is supplied—posts contract events to chat ids registered for each templ. You only need a persistent store (SQLite) in production; local development stays dependency-free.

## 3) Start the frontend

Terminal C:

```bash
npm --prefix frontend run dev
```

Open `http://localhost:5173`. The SPA provides dedicated routes for every core flow:

- `/templs/create` – deploy + register a templ (optionally include a Telegram chat id).
- `/templs/join` – join (or gift a join) and verify membership with the backend.
- `/templs/:address` – overview page with quick navigation to proposals.
- `/templs/:address/proposals/new` – create governance actions.
- `/templs/:address/proposals/:id/vote` – cast a YES/NO vote.

## 4) Load Hardhat wallets in your browser

Add the Hardhat network in MetaMask (or another injected wallet):

- RPC URL: `http://127.0.0.1:8545`
- Chain ID: `1337`
- Currency: ETH (test)

Commonly used accounts (private keys are from Hardhat defaults—never use them on mainnet):

| Role | Address | Private key |
| --- | --- | --- |
| Priest candidate | `0x90F79bf6EB2c4f870365E785982E1f101E93b906` | `0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6` |
| Member | `0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65` | `0x47e179ec197488593b187f80a00eb0da91f1b9f6191b7644aab4f9f0d0c5d938` |

(Refer to `hardhat.config.cjs` for the full list if you need additional wallets.)

## 5) Deploy and register a templ

1. Connect the priest wallet in the UI and navigate to `/templs/create`.
2. Fill in the form:
   - Factory address: the `TemplFactory` you deployed or the value from `VITE_TEMPL_FACTORY_ADDRESS`.
   - Access token address: any ERC-20 you control on the local chain (deploy `TestToken` via `npx hardhat console` if needed).
   - Entry fee / fee split / limits: pick values that satisfy on-chain validations (entry fee ≥ 10 wei and divisible by 10, fee split sums to 100).
   - Telegram chat id: optional numeric id; omit it if you don’t want Telegram alerts yet.
3. Submit—the frontend deploys the contract via the factory. When `TRUSTED_FACTORY_ADDRESS` and `RPC_URL` are set the backend observes every `TemplCreated` signature emitted by the factory and registers the templ automatically, so there is no extra signature prompt during creation. The CLI deploy script mirrors this behaviour; set `CURVE_PRIMARY_STYLE` (`static`, `linear`, or `exponential`) and `CURVE_PRIMARY_RATE_BPS` before running `scripts/deploy.js` if you need a custom curve, otherwise the factory default exponential curve is applied.
4. After success you land on `/templs/:address` where the overview reflects the on-chain priest and home link once the backend syncs. Use the “Generate binding code” action (it triggers the priest signature) if you want Telegram alerts; the response yields a `/templ <bindingCode>` command together with the `https://t.me/templfunbot?startgroup=<bindingCode>` deep link. Invite `@templfunbot` and trigger either option in the group to finish the binding.

## 6) Join and verify membership

1. Switch to the member wallet and open `/templs/join?address=<templAddress>`.
2. Use “Join templ” to approve + call `join` if you haven’t joined before.
3. Click “Verify Membership” to sign the EIP-712 payload and call the backend `/join` endpoint.
4. The response includes the templ metadata plus deep links (join, overview, proposals) derived from `APP_BASE_URL`.

## 7) Create proposals and vote

- `/templs/:address/proposals/new` lets any member raise actions such as pausing, changing the priest, updating fees, etc. Titles and descriptions live on-chain and emit in `ProposalCreated` events.
- `/templs/:address/proposals/:id/vote` submits `vote(proposalId, support)` transactions.
- If the templ was registered with a Telegram chat id, the backend will post:
  - Member joins (`MemberJoined`) with live treasury/member-pool balances.
  - Proposal creations (including on-chain title/description).
  - Votes (enriched with cached proposal titles) and quorum milestones.
  - Voting window closures with an execute/not-executable summary.
  - Priest changes and templ home-link updates.
  - Daily treasury/member-pool digests (every 24h) when the server remains online.
  Each message links back to the relevant frontend route so members can take action quickly and is formatted with Telegram Markdown V2 for consistent bold headers, code spans, and deep links. Posting the one-time binding code also yields an immediate “Telegram bridge active” acknowledgement.
- `/templs/:address/claim` lets connected wallets see the raw member pool balance and call `claimMemberRewards()`.

## 8) Run the automated checks

Once you can click through the flows, run the full validation pass before opening a PR:

```bash
npm run test:all
```

The helper script clears Vite caches, runs unit/integration coverage, and installs the
Playwright Chromium binary automatically (unless `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` is set)
via `npm --prefix frontend exec playwright install --with-deps chromium`. If you trigger the
frontend E2E tests manually (`npm --prefix frontend run test:e2e`), run the same Playwright
install command once per machine so the browser executable is present.

## 9) Point your local stack at a deployed factory

Once you deploy a factory to a persistent network (Base, Base Sepolia, etc.), you can continue iterating locally against those contracts instead of Hardhat:

1. Update `backend/.env`:

   ```env
   RPC_URL=https://base-mainnet.infura.io/v3/<key>
   TRUSTED_FACTORY_ADDRESS=0x...        # factory you deployed in production
   TRUSTED_FACTORY_DEPLOYMENT_BLOCK=12345678
   ```

   Leave `BACKEND_SERVER_ID`, `APP_BASE_URL`, and other values as they were for local development. Restart the backend so it reconnects to the live RPC.
2. Update your frontend overrides (either via `frontend/.env.local` or the shell):

   ```bash
   export VITE_BACKEND_URL=http://localhost:3001
   export VITE_BACKEND_SERVER_ID=templ-dev
   export VITE_TEMPL_FACTORY_ADDRESS=0x...            # same as TRUSTED_FACTORY_ADDRESS
   export VITE_TEMPL_FACTORY_DEPLOYMENT_BLOCK=12345678
   npm --prefix frontend run dev
   ```

   If you prefer file-based overrides, set the same keys in `frontend/.env.local`. The landing page reads templs from your live factory while your local backend keeps handling membership checks and Telegram bindings.
3. Keep the Hardhat node around when you need throwaway contracts for testing; switch wallets/networks in MetaMask when you want to interact with the live deployment.

### Register templs minted outside your factory

If you need to monitor or debug a templ that was deployed from a different `TemplFactory` (for example, a partner project that
already has contracts on Base), you can bring it into your local backend.

1. Temporarily relax the factory guard so the backend accepts templs from other sources. Edit `backend/.env` and either clear
   `TRUSTED_FACTORY_ADDRESS` or set it to the factory that produced the templ you want to inspect. Restart the backend so the new
   value takes effect.
2. Export the values required by the registration helper and run it with the priest wallet for the templ you want to adopt:

   ```bash
   export BACKEND_URL=http://localhost:3001
   export TEMPL_ADDRESS=0xExistingTempl
   export PRIVATE_KEY=0xPriestPrivateKey
   # Optional: seed metadata that is already live
   export TELEGRAM_CHAT_ID=-1001234567890
   export TEMPL_HOME_LINK="https://example.com"
   npx hardhat run scripts/register-templ.js --network base
   ```

   The script signs the standard registration payload and POSTs it to the backend. You’ll either receive the existing Telegram
   chat id or a fresh binding code.
3. Reinstate your usual `TRUSTED_FACTORY_ADDRESS` once the templ shows up in `/templs` responses so future registrations continue
   to come from your factory.

## Where to go next

- Follow [docs/DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) to promote the stack to a real environment (deploy the factory, publish the frontend, and run the backend with durable storage + Telegram binding).
- After the first production deploy, repeat the “Point your local stack” steps above with the production addresses so you can debug locally against live data without redeploying contracts.
- Re-run `npm run test:all` before pushing changes—CI mirrors the same workflow.

## Troubleshooting

- **CORS / origin errors** – ensure `ALLOWED_ORIGINS` in `backend/.env` matches the frontend origin.
- **Telegram messages not appearing** – confirm the bot is added to the group, the chat id is correct, and the backend logs show `notify*` calls. Missing `APP_BASE_URL` will omit deep links but shouldn’t block delivery.
- **Signature rejected** – signatures are cached in-memory for 6 hours. Restart the backend (or wait for the retention window) if you reused an old payload with the same nonce.
- **Contract reverts** – hardhat console logs will show revert reasons. Common issues are fee splits not summing to 100 or attempting to vote after the deadline.

This walkthrough leaves you with a full local environment for iterating on templ governance and Telegram notifications.
