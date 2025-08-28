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

Optional environment variables include port selection.

## Security considerations
- The service trusts the provided wallet address; production deployments should authenticate requests.
- The bot key must be stored securely; compromise allows muting or invitation of arbitrary members.
- Governance events are forwarded to the group chat; untrusted RPC data could mislead voters.
- RPC responses are assumed honest; use a trusted provider.

