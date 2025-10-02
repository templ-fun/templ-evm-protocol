# Backend Service

This guide covers the Node 22 + Express app in `backend/`. Run it as a long-lived process locally or on a host such as Fly, Render, Railway, or bare metal.

**Core duties**

- Verify EIP-712 signatures for templ registration, rebind requests, and membership checks.
- Persist templ ↔ Telegram bindings so alerts survive restarts (no wallet-to-chat mapping is stored).
- Confirm membership directly against the chain instead of keeping local member lists.
- Stream templ events into Telegram with MarkdownV2 notifications.
- Index templ deployments emitted by the trusted factory so deployers are registered automatically.

Start the service in development with `npm --prefix backend start`.

## API Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/templs` | List known templs. Optional `?include=homelink` adds `templHomeLink` to each row. Chat ids are never returned. |
| `POST` | `/templs` | Manually register a templ. Requires typed signature from the priest. Usually unnecessary when `TRUSTED_FACTORY_ADDRESS` is configured because factory events register templs automatically. |
| `POST` | `/templs/rebind` | Request a new binding code to rotate Telegram chats. Requires typed signature from the current priest. Returns `{ contract, bindingCode, telegramChatId?, priest }`. |
| `POST` | `/join` | Verify membership. Requires typed signature from the member. Body fields: `contractAddress`, `memberAddress`, plus `chainId/nonce/issuedAt/expiry/signature`. Returns `{ member:{isMember}, templ:{...}, links:{...} }`. |

Example `/join` response:

```json
{
  "member": { "isMember": true },
  "templ": {
    "contract": "0xabc…",
    "priest": "0xdef…",
    "templHomeLink": "https://example.com"
  },
  "links": {
    "templ": "https://app.templ.fun/templs/0xabc…",
    "proposals": "https://app.templ.fun/templs/0xabc…/proposals",
    "vote": "https://app.templ.fun/templs/0xabc…/proposals",
    "join": "https://app.templ.fun/templs/join?address=0xabc…",
    "claim": "https://app.templ.fun/templs/0xabc…/claim"
  }
}
```

## Installation

```bash
npm --prefix backend ci
npm --prefix backend start
```

Running the server requires a JSON-RPC endpoint and aligned frontend/server IDs.

## Environment variables

| Variable | Description | Default |
| --- | --- | --- |
| `RPC_URL` | **Required.** JSON-RPC endpoint used for contract reads, membership checks, and event subscriptions. | – |
| `PORT` | Port for the Express app. | `3001` |
| `ALLOWED_ORIGINS` | Comma-separated CORS origins. | `http://localhost:5173` |
| `BACKEND_SERVER_ID` | Identifier embedded in EIP-712 typed data. Must match the frontend’s `VITE_BACKEND_SERVER_ID`. | – |
| `APP_BASE_URL` | Base URL used when generating links inside Telegram messages. | unset |
| `TELEGRAM_BOT_TOKEN` | Bot token used to post templ updates and poll binding codes. Leave unset to disable Telegram delivery. | unset |
| `TRUSTED_FACTORY_ADDRESS` | Optional factory address; when set, only templs emitted by this factory may register or rebind, and cached records from other factories are skipped on restart. | unset |
| `TRUSTED_FACTORY_DEPLOYMENT_BLOCK` | Optional block height that seeds trusted factory verification. Set this to the block the factory was deployed so log scans stay within RPC limits. | unset |
| `REQUIRE_CONTRACT_VERIFY` | When `1` (or `NODE_ENV=production`), enforce contract deployment + priest matching before accepting `/templs` requests. | `0` |
| `LOG_LEVEL` | Pino log level. | `info` |
| `RATE_LIMIT_STORE` | `memory` or `redis`; automatically switches to Redis when `REDIS_URL` is provided. | auto |
| `REDIS_URL` | Redis endpoint used for rate limiting when `RATE_LIMIT_STORE=redis`. | unset |
| `LEADER_TTL_MS` | Leader election heartbeat window (milliseconds) when using shared persistence. Must be ≥ 15000. | `60000` |
| `SQLITE_DB_PATH` | Path to a persistent SQLite database. When unset, the server falls back to an in-memory adapter. | unset |

For production runs set `SQLITE_DB_PATH` to a directory backed by durable storage (for example a Fly volume mounted at `/var/lib/templ/templ.db`). The server automatically creates tables when the path is writable. Distributed rate limiting is optional; when Redis is unavailable the in-process `MemoryStore` enforces limits per instance and logs a warning in `NODE_ENV=production`. Signature replay protection retains entries for roughly six hours regardless of the persistence backend.

`npm run deploy:cloudflare` (see `scripts/cloudflare.deploy.example.env`) builds the Vite frontend and deploys it to Cloudflare Pages. Backend deployment is handled separately (for example with the Fly workflow described in `docs/DEPLOYMENT_GUIDE.md`).

### Data model

SQLite (referenced by `SQLITE_DB_PATH`) stores:

- `templ_bindings(contract TEXT PRIMARY KEY, telegramChatId TEXT UNIQUE, priest TEXT, bindingCode TEXT)` – durable mapping between templ contracts and their optional Telegram chats plus the last-seen priest address. `bindingCode` stores any outstanding binding snippet so servers can restart without invalidating it. Rows keep `telegramChatId = NULL` until a binding completes so watchers can resume after restarts without leaking chat ids.
- `used_signatures(signature TEXT PRIMARY KEY, expiresAt INTEGER)` – replay protection for typed requests. Entries expire automatically (6 hour retention) and fall back to the in-memory cache only when persistent storage is unavailable.
- `leader_election(id TEXT PRIMARY KEY, owner TEXT, expiresAt INTEGER)` – coordinates which backend instance currently holds the notification lease. Only the owning instance streams Telegram events and runs interval jobs; other replicas stay idle until the lease expires.

Templ home links continue to live on-chain; watchers refresh them (and priest data) from the contract whenever listeners attach so the chain remains the canonical source of truth.

### Leadership & scaling

Only one backend instance should emit Telegram notifications at a time. When multiple replicas share the same SQLite/D1 database the server uses the `leader_election` table to acquire a short-lived lease (`LEADER_TTL_MS`, default 60s). The leader streams templ events, polls Telegram for binding codes, and sends daily digests; standby replicas wake up periodically to refresh the lease and take over if the active process disappears. When using the in-memory persistence adapter, run a single instance so notifications are not duplicated.

### Trusted factory indexing

Providing both `RPC_URL` and `TRUSTED_FACTORY_ADDRESS` enables an indexer that tails the factory's `TemplCreated` events. The server registers new templs automatically (re-using the same validation path as manual `/templs` calls) and attaches contract watchers as soon as the factory log lands. Set `TRUSTED_FACTORY_DEPLOYMENT_BLOCK` so the historical scan stays within provider limits. With this configuration, deployers only sign when requesting Telegram bindings or later rebinds—the creation flow no longer surfaces the registration signature prompt in the frontend.

## Routes

### `GET /templs`

Returns the list of registered templs. Chat identifiers are never exposed; requests with `?include=chatId`/`groupId` return `403` to deter scraping. Provide `?include=homeLink` (or `links`) to surface the stored templ home link alongside contract/priest metadata.

```json
{
  "templs": [
    {
      "contract": "0xabc…",
      "priest": "0xdef…",
      "templHomeLink": "https://example.com"
    }
  ]
}
```

> `templHomeLink` appears only when `include=homeLink` (or `links`) is provided.

### `POST /templs`

Manually registers a templ. Requires an EIP-712 typed signature from the priest (`buildCreateTypedData`). Optional `telegramChatId` seeds an existing Telegram binding and `templHomeLink` lets deployers publish the canonical landing page immediately.

When `TRUSTED_FACTORY_ADDRESS` is set, the backend already listens for `TemplCreated` events and calls this service internally, so deployers do not need to hit this endpoint after creating a templ. Keep the route enabled for advanced recovery scenarios (for example, backfilling templs deployed before the indexer was configured).

```json
{
  "contractAddress": "0xabc…",
  "priestAddress": "0xdef…",
  "telegramChatId": "-100123456",
  "templHomeLink": "https://example.com",
  "chainId": 8453,
  "signature": "0x…",
  "nonce": 1700000000000,
  "issuedAt": 1700000000000,
  "expiry": 1700000030000
}
```

When `REQUIRE_CONTRACT_VERIFY=1`, the server confirms that the address hosts bytecode and that `priest()` matches the signed address before persisting anything.
If `telegramChatId` is omitted the response contains a `bindingCode` together with the templ metadata (including the stored `templHomeLink`). Invite `@templfunbot` to your group and either tap the generated `https://t.me/templfunbot?startgroup=<bindingCode>` link or send `/templ <bindingCode>` once—the backend polls Telegram until it observes the command and then stores the resolved chat id.

### `POST /templs/rebind`

Issues a fresh binding code so a templ can re-link to a new Telegram chat. Requires the current priest to sign the `buildRebindTypedData` payload; in production the backend also verifies the on-chain priest address before updating persistence.

```json
{
  "contractAddress": "0xabc…",
  "priestAddress": "0xdef…",
  "chainId": 8453,
  "signature": "0x…",
  "nonce": 1700000001000,
  "issuedAt": 1700000001000,
  "expiry": 1700000031000
}
```

The response includes the new `bindingCode`; once the bot sees that code inside a Telegram group it stores the new chat id and clears the pending binding. Existing bindings are revoked immediately so only one group is active at a time.

### `POST /join`

Verifies a member has joined and returns templ metadata plus convenience links.

Request body mirrors the frontend’s join payload (`buildJoinTypedData`). The backend calls `isMember(member)` on the contract and responds with templ metadata (and convenience links) on success.

## Telegram notifications

When `TELEGRAM_BOT_TOKEN` is provided, the backend creates a notifier that emits plain-text, newline-delimited messages for key lifecycle moments:

- `MemberJoined` – announces new members, surfaces the current treasury + unclaimed member pool balances, links to `/templs/join` and `/templs/:address/claim`, and repeats the templ home link when present.
- `ProposalCreated` – highlights new proposals with their on-chain title/description and links directly to the vote page.
- `VoteCast` – records individual votes (YES/NO) while keeping the proposal link handy.
- `ProposalExecuted` – reports whether execution succeeded and links back to the proposal so members can audit the outcome.
- `ProposalQuorumReached` – fires once quorum is first satisfied so members who have not voted yet can participate before the deadline.
- `ProposalVotingClosed` – triggered after the post-quorum window elapses, stating whether the proposal can be executed and linking to the execution screen.
- `PriestChanged` – announces leadership changes and links to the templ overview.
- `TemplHomeLinkUpdated` – broadcasts when governance changes the on-chain home link so members have the latest canonical URL.
- `MemberRewardsClaimed` – flags when a member withdraws rewards, including the amount so the community can track redemptions.
- `ExternalRewardClaimed` – mirrors `MemberRewardsClaimed` for auxiliary reward tokens or ETH distributions.
- `JoinPauseUpdated` – notifies the channel whenever governance pauses or resumes new joins.
- `ConfigUpdated` – summarises entry fee and split changes so operators can confirm they match governance intent.
- `TreasuryAction` – records treasury withdrawals with recipient/amount/reason context for audit trails.
- `TreasuryDisbanded` – reports the total/per-member payout when treasury balances are dissolved into rewards.
- `DictatorshipModeChanged` – signals when the priest gains (or relinquishes) direct execution powers.
- `MaxMembersUpdated` – highlights membership cap changes with a call-to-action to invite new members when the limit increases.
- Daily digest – once every 24 hours each templ receives a "gm" message summarising treasury + unclaimed member pool totals with a call-to-action to claim.
- Binding acknowledgements – after a user triggers the start-group link or sends `/templ <hash>` in their Telegram group, the bot confirms the bridge is active.

Messages are posted with Telegram `MarkdownV2` formatting—the notifier escapes links, addresses, and labels before calling the API with `parse_mode=MarkdownV2`—so alerts can mix bold headings, monospace addresses, and deep links back to the app. If no bot token exists the backend skips delivery gracefully. When a templ is registered without a chat id, the backend issues a binding code; invite `@templfunbot` to the group and trigger the start link or `/templ <code>` command once to finish the handshake.

## Contract watchers

The server uses `ethers.Contract` to subscribe to templ events. Watchers are registered when a templ is stored or restored from persistence (SQLite or the in-memory fallback during local development).

- Listener errors are caught and logged (but do not crash the process).
- Proposal metadata is cached in-memory when events fire so follow-up notifications can include the title even if the on-chain read fails.
- Quorum checks run after every proposal creation and vote to emit a one-time "quorum reached" message once the threshold is crossed.
- Background jobs monitor proposal deadlines, fire daily treasury/member-pool digests, and poll Telegram for binding codes until each templ is linked to a chat.
- Priest and home-link updates are cached in memory; the contract remains the source of truth and watchers refresh them after restarts.
- Event cursors are not persisted. On restart the backend rehydrates watcher subscriptions from the stored templ bindings, letting `ethers.Contract` pick up new on-chain events while skipping anything that fired while the server was offline.

## Testing

`npm --prefix backend test` runs Node’s built-in test runner:

- Shared `shared/signing.test.js` covers typed-data builders.
- `backend/test/app.test.js` spins up the app against the in-memory persistence adapter, stubs a Telegram notifier, and checks templ registration, priest rebind flows, and membership checks.

Coverage uses `c8`; run `npm --prefix backend run coverage` for LCOV reports.

## Deployment checklist

1. Provide a reliable RPC URL and set `REQUIRE_CONTRACT_VERIFY=1` + `NODE_ENV=production`.
2. Set `BACKEND_SERVER_ID` and ensure the frontend uses the same value.
3. Configure `APP_BASE_URL` so Telegram links point to your deployed frontend.
4. Provide `TELEGRAM_BOT_TOKEN` and confirm the bot is present in each group you care about. (Leaving it unset disables notifications.)
5. Consider supplying `REDIS_URL` if you run multiple backend replicas and need distributed rate limiting.

### Fly deployment quickstart

1. Copy `backend/fly.example.toml` to `backend/fly.toml` and adjust the `app` name, region, and resource sizing.
2. Create a persistent volume (`fly volumes create templ_data --size 1 --region <region> --app <app>`).
3. Set Fly secrets for the environment variables listed above (`RPC_URL`, `APP_BASE_URL`, `BACKEND_SERVER_ID`, `TRUSTED_FACTORY_ADDRESS`, etc.). Include `REQUIRE_CONTRACT_VERIFY=1` for production hardening.
4. Deploy with `fly deploy --config backend/fly.toml`.

The Docker image defined in `backend/Dockerfile` installs production dependencies, exposes port `3001`, and stores SQLite data at `/var/lib/templ/templ.db`. Refer to `docs/DEPLOYMENT_GUIDE.md` for the full rollout checklist.
