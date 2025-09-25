# Backend Service

The backend is a Node 22 / Express server that acts as the “web2” side of templ:

* verifies EIP-712 signatures for templ creation and membership checks,
* persists templ metadata (contract address, priest address, optional Telegram chat id),
* confirms membership by asking the contract’s `hasAccess` function, and
* streams contract events into Telegram groups when configured.

The service no longer depends on XMTP. All messaging happens through Telegram bots.

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
| `TELEGRAM_BOT_TOKEN` | Bot token used to post templ updates. Leave unset to disable Telegram delivery. | unset |
| `REQUIRE_CONTRACT_VERIFY` | When `1` (or `NODE_ENV=production`), enforce contract deployment + priest matching before accepting `/templs` requests. | `0` |
| `LOG_LEVEL` | Pino log level. | `info` |
| `RATE_LIMIT_STORE` | `memory` or `redis`; automatically switches to Redis when `REDIS_URL` is provided. | auto |
| `REDIS_URL` | Redis endpoint used for rate limiting when `RATE_LIMIT_STORE=redis`. | unset |
| `DB_PATH` | SQLite path for persisted templ records. | `backend/groups.db` |
| `CLEAR_DB` | When `1`, delete the SQLite database on boot (useful for tests). | `0` |

### Data model

The backend stores templ metadata and replay protection state inside SQLite:

- `groups(contract TEXT PRIMARY KEY, groupId TEXT, priest TEXT)` – `groupId` now stores the Telegram chat id.
- `signatures` – tracks used EIP-712 signatures for replay protection.

The in-memory cache mirrors SQLite entries and powers fast lookups during join flows and contract event handlers.

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

### `POST /join`

Verifies a member has purchased access and returns templ metadata plus convenience links.

Request body mirrors the frontend’s join payload (`buildJoinTypedData`). The backend calls `hasAccess(member)` on the contract. On success the response includes the templ data (including the Telegram chat id) and computed URLs:

```json
{
  "member": { "address": "0x123…", "hasAccess": true },
  "templ": { "contract": "0xabc…", "telegramChatId": "-100123456", "priest": "0xdef…" },
  "links": {
    "templ": "https://app.templ.fun/templs/0xabc…",
    "join": "https://app.templ.fun/templs/join?address=0xabc…",
    "proposals": "https://app.templ.fun/templs/0xabc…/proposals"
  }
}
```

## Telegram notifications

When `TELEGRAM_BOT_TOKEN` is provided, the backend creates a notifier that emits HTML-formatted messages for key lifecycle moments:

- `AccessPurchased` – announces new members, surfaces the current treasury + unclaimed member pool balances, links to `/templs/join`, and deep-links to `/templs/:address/claim` so members can immediately harvest rewards.
- `ProposalCreated` – highlights new proposals with their on-chain title/description and links directly to the vote page.
- `VoteCast` – records individual votes (YES/NO) while keeping the proposal link handy.
- `ProposalQuorumReached` – fires once quorum is first satisfied so members who have not voted yet can still participate.
- `ProposalVotingClosed` – triggered after the post-quorum window elapses, stating whether the proposal can be executed and linking to the execution screen.
- `PriestChanged` – announces leadership changes and links to the templ overview.
- Daily digest – once every 24 hours each templ receives a "gm" message summarising treasury + unclaimed member pool totals with a call-to-action to claim.

Messages are posted with `parse_mode=HTML` and include contract/member addresses in `<code>` blocks to aid scanning. If no bot token or chat id exists, the backend skips delivery gracefully.

## Contract watchers

The server uses `ethers.Contract` to subscribe to templ events. Watchers are registered when a templ is stored or restored from SQLite.

- Listener errors are caught and logged (but do not crash the process).
- Proposal metadata is cached in-memory when events fire so follow-up notifications can include the title even if the on-chain read fails.
- Quorum checks run after every vote (and on startup) to emit a one-time "quorum reached" message.
- Background jobs monitor proposal deadlines and fire daily treasury/member-pool digests for every templ with a Telegram chat id.
- Priest changes update both the in-memory store and SQLite row so new priests see fresh state.

## Testing

`npm --prefix backend test` runs Node’s built-in test runner:

- Shared `shared/signing.test.js` covers typed-data builders.
- `backend/test/app.test.js` spins up the app with an in-memory DB, stubs a Telegram notifier, and checks templ registration + membership flows.

Coverage uses `c8`; run `npm --prefix backend run coverage` for LCOV reports.

## Deployment checklist

1. Provide a reliable RPC URL and set `REQUIRE_CONTRACT_VERIFY=1` + `NODE_ENV=production`.
2. Set `BACKEND_SERVER_ID` and ensure the frontend uses the same value.
3. Configure `APP_BASE_URL` so Telegram links point to your deployed frontend.
4. Provide `TELEGRAM_BOT_TOKEN` and confirm the bot is present in each group you care about. (Leaving it unset disables notifications.)
5. Keep `ENABLE_DEBUG_ENDPOINTS` off in production; expose them only in controlled environments.
6. Consider supplying `REDIS_URL` if you run multiple backend replicas and need distributed rate limiting.
