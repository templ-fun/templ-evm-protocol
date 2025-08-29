# TEMPL Frontend

The TEMPL frontend is a React + Vite application that lets members deploy contracts, verify purchases, and chat.

## Setup

Install dependencies:

```bash
npm --prefix frontend install
```

## Development

Start a hot-reloading dev server:

```bash
npm --prefix frontend run dev
```

## Tests & Lint

```bash
npm --prefix frontend test
npm --prefix frontend run lint
npm --prefix frontend run build
```
## Architecture

- **Wallet connection** via `ethers` and `window.ethereum`.
- **Contract deployment** and group creation handled in `deployTempl` (token address, protocol fee recipient, entry fee, and vote weights).
- The backend currently ignores the `protocolFeeRecipient` field. In production a contract factory will set this to the protocol treasury address automatically.
- **Default configuration** – priest vote weight and priest weight threshold default to 10.
- **Pay‑to‑join flow** in `purchaseAndJoin` verifies membership and requests an invite from the backend (defaults to `http://localhost:3001`).
- **Chat UI** streams XMTP messages and sends new ones using the group inbox ID.
- **Moderation** – the client polls `GET /mutes` and filters out messages from muted addresses before rendering.
- **Governance** – members create proposals and vote from the chat; `watchProposals` updates the UI when events fire.

## Security considerations
- Membership verification happens on-chain; bypassing the backend would require membership proof.
- The app relies on the backend service for invitations; if the service is down no new members can join.
- Users must share the contract address and group ID manually; there is no routing.
- Proposal and vote transactions are signed by the connected wallet; users should verify calldata before approving.
