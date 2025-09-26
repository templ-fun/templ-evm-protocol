# Backend Service

Use this doc to configure and operate the Node 22 / Express backend that handles the “web2” side of templ:

* verifies EIP-712 signatures for templ creation, rebind requests, and membership checks,
* persists a minimal Telegram chat ↔ contract binding so notifications survive restarts,
* confirms membership by asking the contract’s `hasAccess` function (no local member lists are stored), and
* streams contract events into Telegram groups when configured.

All messaging happens through Telegram bots.

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
| `REQUIRE_CONTRACT_VERIFY` | When `1` (or `NODE_ENV=production`), enforce contract deployment + priest matching before accepting `/templs` requests. | `0` |
| `LOG_LEVEL` | Pino log level. | `info` |
| `RATE_LIMIT_STORE` | `memory` or `redis`; automatically switches to Redis when `REDIS_URL` is provided. | auto |
| `REDIS_URL` | Redis endpoint used for rate limiting when `RATE_LIMIT_STORE=redis`. | unset |
| `DB_PATH` | SQLite path for persisted Telegram bindings. | `backend/groups.db` |
| `CLEAR_DB` | When `1`, delete the SQLite database on boot (useful for tests). | `0` |

### Data model

The backend persists only the Telegram binding in SQLite:

- `templ_bindings(contract TEXT PRIMARY KEY, telegramChatId TEXT UNIQUE)` – stores a durable mapping so the notifier can recover which chats belong to which templ contracts across restarts while retaining templs without Telegram bindings (rows keep `telegramChatId` as `NULL` until the binding completes).

Priest addresses and templ home links are always recovered from the contract when watchers attach after boot, so the chain remains the canonical source of truth for administrative metadata.

Signature replay protection now lives in-memory with a 6 hour retention window; bindings, proposal metadata, and home links are derived from on-chain reads and cached only for the lifetime of the process.

## Routes

### `GET /templs`

Returns the list of registered templs. Append `?include=chatId` (or `?include=groupId`) to surface the stored Telegram chat id.

```json
{
  "templs": [
    {
      "contract": "0xabc…",
      "priest": "0xdef…",
      "telegramChatId": "-100123456"
    }
  ]
}
```

### `POST /templs`

Registers a templ. Requires an EIP-712 typed signature from the priest (`buildCreateTypedData`). Optional `telegramChatId` binds the backend to a Telegram group for notifications.

```json
{
  "contractAddress": "0xabc…",
  "priestAddress": "0xdef…",
  "telegramChatId": "-100123456",
  "chainId": 8453,
  "signature": "0x…",
  "nonce": 1700000000000,
  "issuedAt": 1700000000000,
  "expiry": 1700000030000
}
```

When `REQUIRE_CONTRACT_VERIFY=1`, the server confirms that the address hosts bytecode and that `priest()` matches the signed address before persisting anything.
If `telegramChatId` is omitted the response also contains a `bindingCode`. Invite `@templfunbot` to your group and post `templ <bindingCode>` once—the backend polls Telegram until it observes the code and then stores the resolved chat id.

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

Verifies a member has purchased access and returns templ metadata plus convenience links.

Request body mirrors the frontend’s join payload (`buildJoinTypedData`). The backend calls `hasAccess(member)` on the contract. On success the response includes the templ data (including the Telegram chat id) and computed URLs:

```json
{
  "member": { "address": "0x123…", "hasAccess": true },
  "templ": { "contract": "0xabc…", "telegramChatId": "-100123456", "templHomeLink": "https://t.me/templ-group", "priest": "0xdef…" },
  "links": {
    "templ": "https://app.templ.fun/templs/0xabc…",
    "join": "https://app.templ.fun/templs/join?address=0xabc…",
    "proposals": "https://app.templ.fun/templs/0xabc…/proposals"
  }
}
```

## Telegram notifications

When `TELEGRAM_BOT_TOKEN` is provided, the backend creates a notifier that emits HTML-formatted messages for key lifecycle moments:

- `AccessPurchased` – announces new members, surfaces the current treasury + unclaimed member pool balances, links to `/templs/join` and `/templs/:address/claim`, and repeats the templ home link when present.
- `ProposalCreated` – highlights new proposals with their on-chain title/description and links directly to the vote page.
- `VoteCast` – records individual votes (YES/NO) while keeping the proposal link handy.
- `ProposalQuorumReached` – fires once quorum is first satisfied so members who have not voted yet can still participate.
- `ProposalVotingClosed` – triggered after the post-quorum window elapses, stating whether the proposal can be executed and linking to the execution screen.
- `PriestChanged` – announces leadership changes and links to the templ overview.
- `TemplHomeLinkUpdated` – broadcasts when governance changes the on-chain home link so members have the latest canonical URL.
- Daily digest – once every 24 hours each templ receives a "gm" message summarising treasury + unclaimed member pool totals with a call-to-action to claim.
- Binding acknowledgements – after a user posts the binding code (`templ <hash>`) in their Telegram group, the bot confirms the bridge is active.

Messages are posted with `parse_mode=HTML` and include contract/member addresses in `<code>` blocks to aid scanning. If no bot token exists the backend skips delivery gracefully. When a templ is registered without a chat id, the backend issues a binding code; invite `@templfunbot` to the group and post the code once to finish the handshake.

## Contract watchers

The server uses `ethers.Contract` to subscribe to templ events. Watchers are registered when a templ is stored or restored from SQLite.

- Listener errors are caught and logged (but do not crash the process).
- Proposal metadata is cached in-memory when events fire so follow-up notifications can include the title even if the on-chain read fails.
- Quorum checks run after every proposal creation and vote to emit a one-time "quorum reached" message once the threshold is crossed.
- Background jobs monitor proposal deadlines, fire daily treasury/member-pool digests, and poll Telegram for binding codes until each templ is linked to a chat.
- Priest and home-link updates are cached in memory; the contract remains the source of truth and watchers refresh them after restarts.

## Testing

`npm --prefix backend test` runs Node’s built-in test runner:

- Shared `shared/signing.test.js` covers typed-data builders.
- `backend/test/app.test.js` spins up the app against a temporary SQLite database, stubs a Telegram notifier, and checks templ registration, priest rebind flows, and membership checks.

Coverage uses `c8`; run `npm --prefix backend run coverage` for LCOV reports.

## Deployment checklist

1. Provide a reliable RPC URL and set `REQUIRE_CONTRACT_VERIFY=1` + `NODE_ENV=production`.
2. Set `BACKEND_SERVER_ID` and ensure the frontend uses the same value.
3. Configure `APP_BASE_URL` so Telegram links point to your deployed frontend.
4. Provide `TELEGRAM_BOT_TOKEN` and confirm the bot is present in each group you care about. (Leaving it unset disables notifications.)
5. Consider supplying `REDIS_URL` if you run multiple backend replicas and need distributed rate limiting.
