# Frontend SPA

The Vite + React app in `frontend/` revolves around a single chat-centric experience. Every route either lists templs, walks a member through joining, or lands them in the XMTP conversation itself.

| Route | Purpose |
| --- | --- |
| `/` | Lists discovered templs (factory scan + backend registry) with their token symbol, entry fee, and a Join button. |
| `/templs/join` | Handles allowance + membership flows. Accepts an `address` query param to prefill the target templ, and automatically redirects to chat after a successful join. |
| `/templs/:address/chat` | Wallet-authenticated XMTP chat where members send messages, compose proposals, vote via poll cards, execute decisions, and claim rewards without leaving the conversation. |

Telegram notifications remain optional; inviting `@templfunbot` with the binding code returned by the backend continues to work, but day-to-day governance happens inside the chat.

Because the build output is static, you can still deploy it to [Cloudflare Pages](https://pages.cloudflare.com/) or any other static host. Pair it with the Node backend (Fly, Render, Railway, etc.) for the API/XMTP orchestration.

## Local development

```bash
npm --prefix frontend ci
npm --prefix frontend run dev
```

The dev server talks to `http://localhost:3001` by default. Override `VITE_BACKEND_URL` if your backend runs elsewhere.

### Environment variables

| Variable | Description | Default |
| --- | --- | --- |
| `VITE_BACKEND_URL` | Base URL for API requests. | `http://localhost:3001` |
| `VITE_BACKEND_SERVER_ID` | Must match the backend’s `BACKEND_SERVER_ID` so EIP-712 signatures verify. | unset |
| `VITE_TEMPL_FACTORY_ADDRESS` | Optional factory override; helps the home page seed templ discovery from on-chain events. | unset |
| `VITE_TEMPL_FACTORY_DEPLOYMENT_BLOCK` | Optional starting block for the factory log scan. | unset |
| `VITE_RPC_URL` | Optional read provider for templ stats when no wallet is connected. | unset |
| `VITE_XMTP_ENV` | XMTP environment (`local`, `dev`, or `production`) used by the browser client. | inherits backend/defaults |
| `VITE_E2E_DEBUG` | Enables additional UI affordances for Playwright. | `0` |

### Wallet connection

The SPA relies on `ethers.BrowserProvider` and the injected `window.ethereum`. When developing against Hardhat, running `npx hardhat node` exposes deterministic private keys that the Playwright harness also consumes.

### Deployment & registration

UI-driven deployment has been retired. Deploy templs via scripts or the backend API (`POST /templs` or `/templs/auto`), then refresh the home page to see them alongside their entry fee. Once registered, everything else happens in the chat.

### Join flow

1. Open `/` and click **Join** (or hit `/templs/join?address=<templ>` directly).
2. Approve the entry fee when prompted, then submit the join transaction (supports gifting via `joinFor(recipient)`).
3. After the transaction settles, the app signs the typed `/join` payload so the backend can confirm membership and hand back the XMTP `groupId`.
4. The UI immediately navigates to `/templs/:address/chat`, streams history, and surfaces governance tools right inside the conversation.

### Governance in chat

The chat composer collects a title + optional description and offers the curated governance actions (pause joins, change priest, adjust fee splits, update home link, etc.). Submitted proposals appear as poll cards with YES/NO tallies, an Execute button (enabled after the voting window ends), and contextual metadata. Claiming member rewards happens from the same screen via the **Claim rewards** modal.

## Testing

- `npm --prefix frontend run test` – Vitest + jsdom.
- `npm --prefix frontend run coverage` – Coverage for components/services.
- `npm --prefix frontend run test:e2e` – Playwright smoke test that deploys a templ, joins it, proposes/votes/executes from chat, and asserts the on-chain side effects.

## Structure overview

```
frontend/
├── src/
│   ├── App.jsx            # minimal router (Home → Join → Chat)
│   ├── pages/             # HomePage, JoinTemplPage, ChatPage
│   ├── services/          # membership + governance helpers shared with chat
│   └── ui/, hooks/, etc.
├── e2e/                   # Playwright chat flow (`basic-flows.pw.spec.js`)
├── vite.config.js
└── package.json
```

Styling stays intentionally lightweight (see `App.css`) so teams can layer on design systems later.
