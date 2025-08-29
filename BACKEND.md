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
  - `POST /mute` – priest address may mute a member; no other admin powers exist.
- **Dependencies** – XMTP JS SDK and an on-chain provider; event watching requires a `connectContract` factory.
- **Persistence** – group metadata persists to `backend/groups.json`. The file is read on startup and rewritten when groups change; back it up to avoid losing state.

## Security considerations
- The service trusts the provided wallet address; production deployments should authenticate requests.
- The bot key must be stored securely; compromise allows muting or invitation of arbitrary members.
- Governance events are forwarded to the group chat; untrusted RPC data could mislead voters.
- RPC responses are assumed honest; use a trusted provider.
