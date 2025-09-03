# TEMPL Backend

The TEMPL backend is an Express service that acts as the XMTP group owner. It creates rooms for new TEMPL deployments, verifies on-chain purchases and invites members.

## Setup
Install dependencies:

```bash
npm --prefix backend install
```

Environment variables:

```env
RPC_URL=https://mainnet.base.org
PORT=3001
BOT_PRIVATE_KEY=0x...
ALLOWED_ORIGINS=http://localhost:5173
```

The API limits cross-origin requests using the [`cors`](https://www.npmjs.com/package/cors) middleware. Allowed origins are configured with the `ALLOWED_ORIGINS` environment variable (comma-separated list). By default only `http://localhost:5173` is permitted.

## Development
Start the API service:

```bash
npm --prefix backend start
```

### Logging
Structured logging is provided by [Pino](https://github.com/pinojs/pino). Logs are emitted in JSON format to `stdout` and the verbosity is controlled with the `LOG_LEVEL` environment variable. In development you may pipe the output through `pino-pretty` for human-readable logs. For production deployments, pipe the process output to a file and rotate it with a tool such as `logrotate`:

```bash
node src/server.js | pino >> /var/log/templ/backend.log
```

## Tests & Lint

```bash
npm --prefix backend test
npm --prefix backend run lint
```

## Architecture
- **Ownership** – The bot wallet owns each XMTP group; no human has admin rights.
- **Endpoints**
  - `POST /templs` – create a group for a deployed contract; if a `connectContract` factory is supplied the backend also watches governance events.
  - `POST /join` – verify `hasPurchased` on-chain and invite the wallet.
  - `POST /delegates` – priest assigns mute rights to a member.
  - `DELETE /delegates` – revoke a delegate's mute rights.
  - `POST /mute` – priest or delegate records an escalating mute for a member.
  - `GET /mutes` – list active mutes for a contract so the frontend can hide messages.
  - `POST /send` – convenience endpoint to have the backend post a message into a group's chat (useful during discovery on dev networks).
- **Dependencies** – XMTP JS SDK and an on-chain provider; event watching requires a `connectContract` factory.
- **Persistence** – group metadata persists to a SQLite database at `backend/groups.db` (or a custom path via `createApp({ dbPath })` in tests). The database is read on startup and updated when groups change; back it up to avoid losing state.

### XMTP client details
- The backend creates its XMTP client with `appVersion` for clearer network diagnostics.
- Invitations add members by inboxId for determinism:
  - Resolve via `findInboxIdByIdentifier({ identifier, identifierKind: 0 /* Ethereum */ })`.
  - Fall back to `generateInboxId(...)` if the identity hasn’t propagated yet.
  - Add using `group.addMembers([inboxId])` with fallbacks for SDK variants (`addMembersByInboxId`, `addMembersByIdentifiers`).
- After creation/join, the backend attempts to `conversations.sync()` and sends a small warm message to help client discovery.

### E2E and debug endpoints
When `ENABLE_DEBUG_ENDPOINTS=1`, additional endpoints assist tests and local debugging:
- `GET /debug/group?contractAddress=<addr>&refresh=1` – returns server inboxId, stored/resolved groupId, and (if available) members.
- `GET /debug/conversations` – returns a count and the first few conversation ids seen by the server.

Playwright e2e uses `XMTP_ENV=production` for realistic behavior and injects a random `BOT_PRIVATE_KEY` per run.

### Endpoint behaviors
- `/templs`
  - Request: `{ contractAddress, priestAddress, signature, priestInboxId? }` where `signature = sign("create:<contract>")`.
  - If `priestInboxId` is not provided, the server derives it deterministically from the address.
  - After group creation the server posts a small warm‑up message so XMTP clients can discover the conversation quickly.
- `/join`
  - Request: `{ contractAddress, memberAddress, signature, memberInboxId? }` with `signature = sign("join:<contract>")`.
  - Requires `hasPurchased(contract, member)` to return `true`.
  - If `memberInboxId` is not provided, the server derives it from the address and posts a "member‑joined" warm‑up message.

## Security considerations
- The service trusts the provided wallet address; production deployments should authenticate requests.
- The bot key must be stored securely; compromise allows muting or invitation of arbitrary members.
- Governance events are forwarded to the group chat; untrusted RPC data could mislead voters.
- RPC responses are assumed honest; use a trusted provider.
