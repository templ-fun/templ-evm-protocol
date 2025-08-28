# TEMPL Backend

The TEMPL backend is an Express service that acts as the XMTP group owner. It creates rooms for new TEMPL deployments, verifies on-chain purchases and invites members.

## Setup

Install dependencies:

```bash
npm --prefix backend install
```

## Development

Start the API service:

```bash
npm --prefix backend start
```

## Logging

Structured logging is provided by [Pino](https://github.com/pinojs/pino).
Logs are emitted in JSON format to `stdout` and the verbosity can be
controlled with the `LOG_LEVEL` environment variable. In development you
may pipe the output through `pino-pretty` for human‑readable logs.

### Log rotation

For production deployments, pipe the process output to a file and rotate it
with a tool such as `logrotate`:

```bash
node src/server.js | pino >> /var/log/templ/backend.log
```

Configure your rotation utility to roll the log file periodically to avoid
unbounded growth.

## Testing

Run unit tests and lint:

```bash
npm --prefix backend test
npm --prefix backend run lint
```

## Auditing

The backend is an Express service that acts as the XMTP group owner. It creates rooms for new TEMPL deployments, verifies on-chain purchases and invites members.

## Architecture

- **Ownership** – The bot wallet owns each XMTP group; no human has admin rights.
- **Endpoints**
  - `POST /templs` – create a group for a deployed contract; if a `connectContract` factory is supplied the backend also watches governance events.
  - `POST /join` – verify `hasPurchased` on-chain and invite the wallet.
  - `POST /mute` – priest address may mute a member; no other admin powers exist.
- **Dependencies** – XMTP JS SDK and an on-chain provider; event watching requires a `connectContract` factory.

## Environment

```env
RPC_URL=https://mainnet.base.org
BOT_PRIVATE_KEY=0x...
```

## Persistence
- Group metadata persists to `backend/groups.json`. Each TEMPL contract address maps to its XMTP group ID and priest address.
- On startup the file is read and groups are reopened; if the file is missing the backend starts empty.

### Operational implications
- Back up `backend/groups.json` to avoid losing group state across deployments.
- The file may become stale if groups are modified outside the backend; prune or edit entries when necessary.
- To reset or migrate, stop the service and delete or update `backend/groups.json`. A fresh file is created when new groups are added.

## Tests
Run unit tests and lint:
```bash
npm --prefix backend test
npm --prefix backend run lint
```

## Security considerations
- The service trusts the provided wallet address; production deployments should authenticate requests.
- The bot key must be stored securely; compromise allows muting or invitation of arbitrary members.
- Governance events are forwarded to the group chat; untrusted RPC data could mislead voters.
- RPC responses are assumed honest; use a trusted provider.

