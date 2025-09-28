# Frontend SPA

Use this doc to navigate the Vite + React app in `frontend/` and understand the routes that power templ lifecycle management:

| Route | Purpose |
| --- | --- |
| `/` | Dashboard, wallet connection, and a templ directory sourced from the configured factory (enriched with backend Telegram metadata). |
| `/templs/create` | Deploy a templ contract and register it with the backend (optional Telegram chat id). |
| `/templs/join` | Purchase access and request backend verification. |
| `/templs/:address` | Overview page with priest info, Telegram chat id, and quick actions. |
| `/templs/:address/proposals/new` | Guided form to create proposals (collects on-chain title + description). |
| `/templs/:address/proposals/:id/vote` | YES/NO voting form. |
| `/templs/:address/claim` | Claim member pool rewards and inspect raw balances. |

After deploying, the UI surfaces a one-time Telegram binding code. Invite `@templfunbot` to your group and post `templ <bindingCode>` so the backend can link the templ to that chat automatically.

The app focuses on templ lifecycle flows while Telegram handles coordination through backend-triggered notifications.

Because the build output is static, production runs deploy cleanly to [Cloudflare Pages](https://pages.cloudflare.com/) (edge-cached, zero-idle hosting). Pair Pages with your Node-hosted backend (Render/Fly/Railway/etc.) so the entire stack stays inexpensive while keeping the UI globally cached.

## Local development

```bash
npm --prefix frontend ci
npm --prefix frontend run dev
```

By default the SPA expects the backend at `http://localhost:3001`. Override with `VITE_BACKEND_URL` when necessary.

### Environment variables

| Variable | Description | Default |
| --- | --- | --- |
| `VITE_BACKEND_URL` | Base URL for API requests. | `http://localhost:3001` |
| `VITE_BACKEND_SERVER_ID` | Must match the backend’s `BACKEND_SERVER_ID` so EIP-712 signatures verify. | unset |
| `VITE_TEMPL_FACTORY_ADDRESS` | Optional override for the templ factory used during deploy. | unset |
| `VITE_TEMPL_FACTORY_PROTOCOL_RECIPIENT` | Optional override for the protocol fee recipient shown in the UI. | unset |
| `VITE_TEMPL_FACTORY_PROTOCOL_PERCENT` | Optional override for the protocol fee percent shown in the UI. | unset |
| `VITE_TEMPL_FACTORY_DEPLOYMENT_BLOCK` | Optional block height that seeds the factory log scan when listing templs on the landing page. | unset |
| `VITE_RPC_URL` | Optional read provider used to enumerate templs on the landing page (falls back to the active wallet provider). | unset |
| `VITE_E2E_DEBUG` | Enables additional UI affordances when set to `1` (used by Playwright). | `0` |

### Wallet connection

The app uses `ethers.BrowserProvider` and the injected `window.ethereum`. Connecting in development automatically picks up Hardhat accounts when you run `npx hardhat node`.

### Deployment flow

1. User connects a wallet and navigates to `/templs/create`.
2. The UI validates fee splits and calls `factory.createTemplWithConfig`. When the form detects a deployed factory address it automatically locks the protocol percent input to the factory’s on-chain share so deployments stay in sync with backend enforcement.
3. After the transaction confirms, the app signs the EIP-712 registration payload and POSTs it to the backend (including an optional Telegram chat id).

### Production build & Pages deploy

- Build with the production API URL and factory settings:
  ```bash
  VITE_BACKEND_URL=https://templ-backend.example.workers.dev \
  VITE_BACKEND_SERVER_ID=templ-prod \
  VITE_TEMPL_FACTORY_ADDRESS=0x... \
  npm --prefix frontend run build
  ```
- Deploy `frontend/dist/` to Cloudflare Pages:
  ```bash
  wrangler pages deploy frontend/dist --project-name templ-frontend --branch production
  ```
- Or reuse the top-level `npm run deploy:cloudflare` helper to apply the database schema and publish the Pages site in one command (see `scripts/cloudflare.deploy.example.env`).

### Join flow

1. User enters a templ address on `/templs/join`.
2. If necessary, `purchaseAccess` approves + calls `purchaseAccess()` on the contract.
3. The app signs a `join` typed message and asks the backend to verify membership.
4. The UI surfaces templ metadata, including Telegram chat id and quick links.

### Governance tools

The proposal form collects a title and description (persisted on-chain) and offers a curated set of actions:

- Pause / unpause templ
- Change priest
- Update max members
- Toggle dictatorship mode
- Update templ home link (mirrors the on-chain `templHomeLink` string used by the backend and notifications)

`voteOnProposal` casts votes; `executeProposal` remains available in `services/governance.js` for scripts.

The rewards page (`/templs/:address/claim`) lets connected members see the current member pool balance and trigger `claimMemberPool()` directly.

The templ overview shows the current Telegram chat id (if any) and lets the connected priest request a signed rebind code that immediately invalidates the previous binding.

## Testing

- `npm --prefix frontend run test` – vitest + jsdom. Use `frontend/vitest.setup.js` to tweak global behavior.
- `npm --prefix frontend run coverage` – coverage for React components and services.
- `npm --prefix frontend run test:e2e` – Playwright smoke tests. The harness now boots Hardhat, the backend, and a preview build. Telegram delivery is effectively disabled because the env omits `TELEGRAM_BOT_TOKEN`; you can point to a real bot by populating the env in `playwright.config.js`. Run `npx playwright install --with-deps` once per machine to download the browser binaries before executing the suite.

## Structure overview

```
frontend/
├── src/
│   ├── App.jsx            # entry point, mini router
│   ├── config.js          # VITE_* constants
│   ├── hooks/
│   ├── pages/             # route-level components
│   ├── services/          # deployment, membership, governance helpers
│   └── assets/, main.jsx, styles, etc.
├── e2e/                   # Playwright specs
├── vite.config.js
└── package.json
```

Component styling is intentionally minimal (see `App.css`) to keep focus on flows until a refreshed design lands.
