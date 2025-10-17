# Deploying the Templ Farcaster Mini App

This guide explains how to ship the Templ mini app to production. Follow each section in order: the mini app should only be promoted once every checklist item reports green.

## 1. Prerequisites
- Production frontend deployed at `https://app.templ.fun/` (or the domain you registered with Warpcast).
- Backend deployment reachable at `https://api.templ.fun/`.
- Access to the Warpcast Developer Tools: <https://farcaster.xyz/~/developers/mini-apps>.
- Farcaster hub read access (either Neynar or your own hub) and API credentials when required.

## 2. Prepare Assets & Manifest
1. Replace the placeholder PNGs under `frontend/public/miniapp/` with production assets:
   - `icon.png` – 512×512 PNG.
   - `splash.png` – 2048×2048 PNG.
   - `hero.png`, `og.png` – 1200×630 PNG.
   - `screenshot-1.png`, `screenshot-2.png`, `screenshot-3.png` – portrait screenshots (1080×1920 recommended).
2. Update `frontend/public/.well-known/farcaster.json`:
   - Fill `accountAssociation.header`, `.payload`, and `.signature` with the object downloaded from the Warpcast Developer Tools.
   - Verify each URL points to the production CDN path (`https://app.templ.fun/miniapp/...`).
3. Run the manifest validator locally:
   ```bash
   npm --prefix frontend run validate:miniapp
   ```
   Fix any reported schema errors before continuing.

## 3. Configure Environment Variables
Set the following variables for both preview and production releases:

| Variable | Purpose |
| --- | --- |
| `MINIAPP_ORIGIN` | Canonical origin for invite links (example: `https://app.templ.fun`). |
| `MINIAPP_DOMAIN` | Optional convenience alias for `MINIAPP_ORIGIN` (registered domain only, no scheme). |
| `MINIAPP_CANONICAL_BASE` | Optional canonical host used for Farcaster share URLs if different from runtime origin. |
| `FARCASTER_HUB_URL` | Hub endpoint used for webhook signature verification (default Neynar Hub API). |
| `FARCASTER_HUB_API_KEY` | API key if the hub requires authentication. |

The backend also inherits existing requirements (`BACKEND_URL`, `SQLITE_DB_PATH`, `TELEGRAM_BOT_TOKEN`, etc.).

## 4. Deploy Frontend
1. Commit the manifest and assets (done in this branch).
2. Build and deploy the frontend via the existing CI/CD pipeline.
3. After deploy, confirm the manifest is live:
   ```bash
   curl https://app.templ.fun/.well-known/farcaster.json | jq
   ```
4. In a browser, open `https://app.templ.fun/create`. Verify the mini app renders and that invitation links reflect the production domain.

## 5. Deploy Backend
1. Apply database migrations to add the `miniapp_notifications` table:
   ```bash
   npm --prefix backend run migrate -- --db path/to/prod.sqlite
   ```
   (Adjust the database path to match your environment.)
2. Deploy the backend with the new environment variables. Confirm the service logs show `miniapp webhook received` after the first webhook is delivered.

## 6. Register the Mini App with Warpcast
1. Visit <https://farcaster.xyz/~/developers/mini-apps>.
2. Choose the registered Farcaster account that will own the mini app.
3. Enter the domain (`app.templ.fun`) and upload the same metadata you embedded in the manifest (name, description, screenshots, etc.).
4. Download the `accountAssociation` JSON and paste it into `frontend/public/.well-known/farcaster.json`.
5. Run the Warpcast validation tool; it must report success before moving forward.

## 7. Verify Webhook Handling
1. In Warpcast, add the mini app to your account. When prompted, enable notifications.
2. Check the backend logs; you should see `notifications_enabled` alongside the stored token.
3. Remove the app (or disable notifications) and confirm the backend deletes the token.

## 8. Manual QA Checklist
- Launch the mini app from Warpcast mobile (iOS/Android) and web.
- Ensure wallet connection, templ creation, joining, and chat flows behave as expected.
- Share an invite from inside the mini app and confirm the share card opens the `/join` route.
- Verify the canonical invite link opens inside Warpcast and directs to the mini app join flow.
- Check that leaving the mini app and returning resumes state correctly.

## 9. Submit for Discovery
Once manual QA passes:
1. Re-run `npm run test:all` locally.
2. Deploy the latest artifacts to production.
3. Re-run the Warpcast manifest validator.
4. Submit the mini app for discovery through the Developer Tools.

Keep this document current—any change to the deployment flow should be reflected here before the next release.
