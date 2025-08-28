# Backend Auditing Guide

The backend is an Express service that acts as the XMTP group owner. It creates rooms for new TEMPL deployments, verifies on‑chain purchases and invites members.

## Architecture
- **Ownership** – The bot wallet owns each XMTP group; no human has admin rights.
- **Endpoints**
  - `POST /templs` – create a group for a deployed contract and start watching its governance events.
  - `POST /join` – verify `hasPurchased` on‑chain and invite the wallet.
  - `POST /mute` – priest address may mute a member; no other admin powers exist.
- **Dependencies** – XMTP JS SDK and an on‑chain provider.

## Environment
```env
RPC_URL=https://mainnet.base.org
BOT_PRIVATE_KEY=0x...
```
Optional environment variables include contract addresses and port selection.

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
