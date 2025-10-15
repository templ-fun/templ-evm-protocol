# Farcaster Mini App Integration Plan

This playbook covers every refactor and operational step required to ship the Templ frontend as a Farcaster Mini App. Work through each section in order; the mini app is ready for discovery only after the validation checklist is green.

## 1. Goal & Scope
- **Objective:** Serve the mini app at the root of the production domain (`https://app.templ.fun/`) with full Warpcast/Base wallet interoperability.
- **In scope:** Frontend bootstrap, wallet abstraction, manifest delivery, metadata assets, optional Quick Auth, notification webhooks, deployment updates, and QA in Farcaster hosts (Warpcast mobile + web).
- **Out of scope:** Legacy marketing landing page (migrate to a separate path or subdomain), non-mini desktop admin flows, unrelated backend features.

## 2. Architecture Decisions
1. **Domain strategy:** Confirm production domain for the mini app (`app.templ.fun`) and where public marketing lives (e.g. `https://templ.fun/landing` or `https://www.templ.fun/`).
2. **Manifest hosting:**
   - *Option A (self-hosted):* Serve `frontend/public/.well-known/farcaster.json`.
   - *Option B (hosted manifest):* Configure a 307 redirect from `/.well-known/farcaster.json` to `https://api.farcaster.xyz/miniapps/hosted-manifest/{id}`.
   - Decide early so deployment scripts and CDN caches can be adjusted once.
3. **Wallet tooling:** Pick the final approach:
   - Native `sdk.wallet.getEthereumProvider()` + `ethers`.
   - Optional: add `@farcaster/miniapp-wagmi-connector` if migrating to Wagmi for hooks.
4. **Authentication:** Decide if Quick Auth is required now or deferred. If adopting, plan the backend token verification middleware and client preconnect hints.

## 3. Manifest & Metadata
1. **File template:** Create `/frontend/public/.well-known/farcaster.json` (or hosted equivalent) containing:
   ```json
   {
     "accountAssociation": {
       "header": "...",
       "payload": "...",
       "signature": "..."
     },
     "miniapp": {
       "version": "1",
       "name": "Templ",
       "iconUrl": "https://app.templ.fun/icon.png",
       "homeUrl": "https://app.templ.fun/",
       "buttonTitle": "Open",
       "splashImageUrl": "...",
       "splashBackgroundColor": "#000000",
       "imageUrl": "...",
       "requiredChains": ["eip155:8453"],
       "requiredCapabilities": [
         "actions.signIn",
         "wallet.getEthereumProvider",
         "actions.addMiniApp"
       ],
       "subtitle": "...",
       "description": "...",
       "tagline": "...",
       "heroImageUrl": "...",
       "screenshotUrls": ["..."],
       "ogTitle": "...",
       "ogDescription": "...",
       "ogImageUrl": "...",
       "castShareUrl": "https://app.templ.fun/share",
       "webhookUrl": "https://api.templ.fun/miniapp/webhooks"
     }
   }
   ```
   Fill every URL with production assets stored under `frontend/public`.
2. **Asset preparation:** Export icon (512×512 PNG), splash (recommend 2048×2048 PNG), hero/OG images (1200×630), and three portrait screenshots demonstrating core flows. Place files at predictable paths (e.g. `public/miniapp/icon.png`).
3. **Metadata copy:** Draft evergreen descriptions (no “now/before” language per repo docs). Ensure tagline, subtitle, and OG fields align with marketing copy.
4. **Account verification:** In Warpcast Developer Tools (`https://farcaster.xyz/~/developers/mini-apps/manifest`):
   - Enter the target domain and app details.
   - Generate the `accountAssociation` object and paste into the manifest.
5. **Schema validation:** Add a local check to CI:
   ```bash
   node - <<'JS'
   import { readFileSync } from 'node:fs'
   import { domainManifestSchema } from '@farcaster/miniapp-sdk'
   const manifest = JSON.parse(readFileSync('frontend/public/.well-known/farcaster.json', 'utf8'))
   domainManifestSchema.parse(manifest)
   JS
   ```
   Fail the build if validation throws.

## 4. Frontend Refactors
1. **Entry routing:**
   - Update `frontend/src/main.jsx` so the root path mounts the mini-app shell by default.
   - Relocate the marketing landing component to a different path or domain; ensure mini-app routes never redirect away or block inside Warpcast.
2. **Environment detection helper:**
   - Add a shared `isMiniApp()` utility that checks `sdk.env.host`, `sdk.env.isMiniApp`, or a query flag (e.g., `window.location.search.includes('miniApp=true')`).
   - Use it to toggle heavy debug logging and features unsupported inside the mini host.
3. **SDK bootstrap:**
   - Install `@farcaster/miniapp-sdk`.
   - On initial mount (only when `isMiniApp()` is true), dynamically import the SDK, call `sdk.actions.ready()`, and set up cleanup if required.
4. **Wallet abstraction:**
   - Create a factory (e.g., `src/services/createProvider.js`) that first calls `sdk.wallet.getEthereumProvider()`; if unavailable, fall back to `window.ethereum`.
   - Replace direct `window.ethereum` references in `App.jsx` and helper modules with the new abstraction.
   - If using Wagmi, swap the connector to `farcasterMiniApp()` and wire `createConfig()` accordingly.
5. **Capability guards:**
   - On load, call `sdk.getCapabilities()` and store the list.
   - Wrap optional features (notifications, haptics, camera) with capability checks.
6. **UX polish:**
   - Audit layout for mobile portrait and small-screen safe areas.
   - Replace native `alert`/`confirm` where unsupported; rely on in-app modals.
   - Ensure forms are keyboard-friendly on mobile (input focus, no hidden fields).
7. **Telemetry adjustments:** Disable noisy analytics or auto-refresh loops when `isMiniApp()` returns true, or confirm the hosting client tolerates them.

## 5. Backend & Notifications
1. **Quick Auth (optional but recommended):**
   - Client: add `<link rel="preconnect" href="https://auth.farcaster.xyz" />` in `index.html` or React preload.
   - Create a helper to call `sdk.quickAuth.getToken()` and attach bearer tokens to backend requests.
   - Backend: add middleware validating tokens via `@farcaster/quick-auth` (or the documented verify call), and guard protected routes.
2. **Notification webhooks:**
   - Expose `POST /miniapp/webhooks` endpoint to receive `miniapp_added`, `miniapp_removed`, `notifications_enabled`, `notifications_disabled` events. Verify Farcaster signatures using shared helpers.
   - Persist notification tokens keyed by `(fid, host)` for later sends.
3. **Notification sender (optional):**
   - Build a client that POSTs to the provided `notificationUrl` with the stored `token`, honoring rate limits (1/30s per token, 100/day).
   - Implement idempotency on `(fid, notificationId)` when sending.

## 6. Build & Deployment
1. **Scripts:** Add `build:miniapp` alias if helpful; ensure Vite `base` remains `/` for root hosting.
2. **Caching:** Update CDN/CDN rules so `/.well-known/farcaster.json` bypasses aggressive caching or can be purged quickly after updates.
3. **Redirects:** If using hosted manifests, add permanent or 307 redirect in the deployment platform (Fastly/Vercel/Cloudflare) pointing `/.well-known/farcaster.json` to the hosted URL.
4. **CI updates:** Extend existing pipelines to run manifest validation, `npm run test:all`, and optionally Playwright smoke tests launched under a mini-app flag.

## 7. Validation Checklist
1. `npm run test:all` at repository root.
2. Manual QA inside Warpcast mobile (iOS + Android if possible):
   - Launch mini app via Developer Tools preview.
   - Connect wallet, execute core flows (deploy templ, join, send message, claim).
3. Manual QA inside Warpcast web client:
   - Verify layout responsiveness, wallet actions, and deep links.
4. Confirm `/.well-known/farcaster.json` loads publicly and passes the SDK schema validator (`domainManifestSchema.parse`).
5. Validate `accountAssociation` by re-running the Warpcast Developer Tools audit.
6. Run capability checks in dev tools (`sdk.getCapabilities()`) to confirm required features appear.
7. If Quick Auth enabled, verify backend endpoints accept tokens and reject malformed ones.
8. Trigger `actions.addMiniApp` to test notification webhooks (ensure events arrive and are stored).

## 8. Risks & Follow-Ups
- **Assumptions:** Base chain (CAIP-2 `eip155:8453`) is mandatory; the target host supports required capabilities (confirm before launch).
- **Potential issues:** Manifest caching when iterating quickly; wallet provider discrepancies between Warpcast versions; XMTP storage limits across accounts.
- **Future enhancements:** Share extension UX (`castShareUrl`), Solana wallet support (`wallet.getSolanaProvider`), localized copy, analytics instrumentation tailored for mini apps.

## 9. References
- Farcaster Mini Apps docs: <https://miniapps.farcaster.xyz/docs/guides/publishing>
- Wallet integration guide: <https://miniapps.farcaster.xyz/docs/guides/wallets>
- Hosted manifest tooling: <https://farcaster.xyz/~/developers/mini-apps/manifest>
- Quick Auth: <https://miniapps.farcaster.xyz/docs/sdk/quick-auth>
- Capabilities schema: <https://github.com/farcasterxyz/miniapps/blob/main/packages/miniapp-core/src/types.ts>

Follow this document end-to-end before submitting the app for discovery or Warpcast Developer Rewards consideration.
