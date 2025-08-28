# Frontend Auditing Guide

The frontend is a React single page app that interacts with the TEMPL contract and XMTP.

## Architecture
- **Wallet connection** via `ethers` and `window.ethereum`.
- **Contract deployment** and group creation handled in `deployTempl`.
- **Pay‑to‑join flow** in `purchaseAndJoin` verifies membership and requests an invite from the backend.
- **Chat UI** streams XMTP messages and sends new ones using the group inbox ID.

## Tests & lint
```bash
npm --prefix frontend test
npm --prefix frontend run lint
npm --prefix frontend run build
```

## Security considerations
- Membership verification happens on-chain; bypassing the backend would require membership proof.
- The app relies on the backend service for invitations; if the service is down no new members can join.
- Users must share the contract address and group ID manually; there is no routing.
