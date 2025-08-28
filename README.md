# TEMPL – Token Entry Management Protocol

TEMPL coordinates on-chain memberships with an XMTP group chat. A TEMPL consists of:

- **Smart contracts** on Base that gate access by requiring a paid `purchaseAccess` call.
- **Backend bot** that owns the XMTP group and only invites wallets that purchased.
- **React frontend** that deploys contracts, verifies purchases and lets members chat.

Use the docs below to audit each component:

- [CONTRACTS.md](./CONTRACTS.md) – smart‑contract specification
- [BACKEND.md](./BACKEND.md) – XMTP bot and API
- [FRONTEND.md](./FRONTEND.md) – React client

## Quick start
1. **Clone & install**
   ```bash
   git clone <repo>
   cd templ
   npm install
   npm run prepare # enable Husky pre‑commit
   ```
2. **Run tests**
   ```bash
   npm test
   npm run slither
   npm --prefix backend test
   npm --prefix frontend test
   ```
3. **Deploy contracts**
   ```bash
   npx hardhat run scripts/deploy.js --network base
   ```
4. **Launch backend bot**
   ```bash
   npm --prefix backend start
   ```
5. **Start frontend**
   ```bash
   npm --prefix frontend run dev
   ```

## Deploying to production
1. Configure `.env` with priest address, fee recipient, token address and Base RPC.
2. Run the full test suite and Slither analysis.
3. Deploy with `scripts/deploy.js` and record the contract address and XMTP group ID.
4. Host the backend bot (e.g., on a VM) using the contract address and bot key.
5. Build the frontend (`npm --prefix frontend run build`) and serve the static files.

## Core flows
1. **Templ creation** – deploy contract and create an empty private XMTP group.
2. **Pay‑to‑join** – wallet calls `purchaseAccess` and backend invites it into the group.
3. **Messaging** – members send and receive XMTP messages in the group chat.
4. **Priest muting** – priest can mute members but cannot rug the group.
5. **Proposal creation** – any member drafts a call‑data proposal from the chat UI.
6. **Voting** – members cast yes/no votes and see live tallies as events arrive.

For detailed auditing guides, continue with the docs linked above.
