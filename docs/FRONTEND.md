# Frontend SPA

Use this doc to navigate the Vite + React app in `frontend/` and understand how the console maps to runtime behaviour.

| Route | Purpose |
| --- | --- |
| `/` | Static landing panel (`Landing.jsx`). |
| `/templs` | Wallet-aware templ directory populated from the backend with optional local fallbacks. |
| `/create` | Deploy a templ via the configured factory, register it with the backend, and jump straight to the chat surface. |
| `/join` | Join or gift membership; accepts `?address=<templ>` for prefill. |
| `/chat` | Templ console (requires `?address=<templ>`). Drives XMTP chat, proposals, votes, execution, reward claims, moderation, and Telegram binding prompts. |

After a deploy completes the app redirects to `/chat?address=<templAddress>`. Telegram binding helpers live inside the chat drawer—they post unsigned payloads to `/templs/${address}/auto` and `/templs/${address}/rebind`, while the backend expects typed requests on `/templs/auto` and `/templs/rebind`. Use the CLI helper or manual API calls for reliable binding rotations.

Because the build output is static, production runs deploy cleanly to [Cloudflare Pages](https://pages.cloudflare.com/) (edge-cached, zero-idle hosting). Pair Pages with your Node-hosted backend (Render, Fly, Railway, etc.) so the entire stack stays inexpensive while keeping the UI globally cached.

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
| `VITE_TEMPL_FACTORY_ADDRESS` / `TEMPL_FACTORY_ADDRESS` | Factory address surfaced on the deploy form. | unset |
| `VITE_TEMPL_FACTORY_PROTOCOL_RECIPIENT` / `TEMPL_FACTORY_PROTOCOL_RECIPIENT` | Protocol fee recipient hint for the deploy form. | unset |
| `VITE_TEMPL_FACTORY_PROTOCOL_PERCENT` / `TEMPL_FACTORY_PROTOCOL_BP` | Protocol fee share hint shown as a percentage (bps when using the `*_BP` variant). | unset |
| `VITE_TEMPL_FACTORY_DEPLOYMENT_BLOCK` | Optional block height that seeds the factory log scan when listing templs. | unset |
| `VITE_RPC_URL` | Optional read provider for templ discovery when no wallet is connected. | unset |
| `VITE_ENABLE_BACKEND_FALLBACK` / `TEMPL_ENABLE_LOCAL_FALLBACK` | Enable local fallback templ lists when the backend directory is unavailable. | `0` |
| `VITE_XMTP_ENV` | XMTP environment (`local`, `dev`, `production`) used for chat connections. | `dev` |
| `VITE_E2E_DEBUG` | Enables additional UI affordances when set to `1` (used by Playwright). | `0` |
| `VITE_E2E_NO_PURCHASE` | Skip ERC-20 purchase/approval in E2E mode. | `0` |

### Wallet connection

The app uses `ethers.BrowserProvider` and the injected `window.ethereum`. Connecting in development automatically picks up Hardhat accounts when you run `npx hardhat node`.

### Deployment flow

1. User connects a wallet and navigates to `/create`.
2. The UI validates fee splits and calls `factory.createTemplWithConfig`. When the form detects a deployed factory address it automatically locks the protocol percent input to the factory’s on-chain share so deployments stay in sync with backend enforcement.
3. After the transaction confirms, the app signs the EIP-712 registration payload and POSTs it to the backend (including the templ home link when provided).
4. The new templ address is cached in `localStorage` (`templ:lastAddress`) and the UI redirects to `/chat?address=<templ>`.

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

1. User enters a templ address on `/join` (or lands with `?address=` populated).
2. If necessary, the `joinTempl` helper approves the entry fee and calls `join()` (or `joinFor(recipient)` when gifting) on the contract.
3. The app signs a `join` typed message and asks the backend to verify membership via `/join`.
4. Success updates the templ cache, stores the address in `localStorage`, and offers a link to `/chat?address=<templ>` to continue governance flows.

### Governance tools

Inside `/chat` the drawer drives proposal creation, voting, and execution. It collects on-chain titles/descriptions and offers curated actions: pause/unpause, change priest, set max members, adjust entry fees and fee splits, disband treasury, withdraw treasury to the connected wallet, and toggle dictatorship mode. `voteOnProposal` and `executeProposal` (in `services/governance.js`) back the chat UI and remain available for scripts.

Claim buttons in the info panel call `claimMemberPool` and `claimExternalToken`. XMTP chat history, proposal metadata, and recent templ addresses are cached in `localStorage` under keys such as `templ:messages:<groupId>` and `templ:proposals:<contract>`.

The Telegram section in the info drawer fetches binding info and offers “Generate binding code” / “Refresh binding” buttons. These POST unsigned payloads to `/templs/${address}/auto` and `/templs/${address}/rebind`, while the backend expects typed payloads on `/templs/auto` and `/templs/rebind`, so use the CLI helper or manual API calls when rotating bindings.

The home-link input is present but only shows a success toast; it does not broadcast an on-chain update.

## Testing

- `npm --prefix frontend run test` – vitest + jsdom. Use `frontend/vitest.setup.js` to tweak global behavior.
- `npm --prefix frontend run coverage` – coverage for React components and services.
- `npm --prefix frontend run test:e2e` – Playwright smoke tests. The harness boots Hardhat, the backend, and a preview build. Telegram delivery is effectively disabled because the env omits `TELEGRAM_BOT_TOKEN`; you can point to a real bot by populating the env in `playwright.config.js`. Install the Chromium bundle once per machine with `npm --prefix frontend exec playwright install --with-deps chromium` (the root `npm run test:all` script handles this automatically unless `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`).

## Structure overview

```
frontend/
├── src/
│   ├── App.jsx            # console + mini router for /templs, /create, /join, /chat
│   ├── Landing.jsx        # static landing screen rendered on /
│   ├── config.js          # VITE_*/TEMPL_* env readers
│   ├── flows.js           # aggregated exports for service helpers
│   ├── hooks/
│   ├── services/          # deployment, membership, governance helpers
│   ├── assets/
│   └── main.jsx, styles, tests, etc.
├── e2e/                   # Playwright specs
├── vite.config.js
└── package.json
```

Component styling is intentionally minimal (see `App.css`) to keep focus on flows. Local state is persisted sparingly in `localStorage` for joined templs, cached chats, and XMTP profiles.
