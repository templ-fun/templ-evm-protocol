# TEMPL – Token Entry Management Protocol

TEMPL coordinates on-chain memberships with an XMTP group chat.

## Architecture
TEMPL is composed of three parts that work together:

- **Smart contracts** on Base gate access by requiring a paid `purchaseAccess` call.
- **Backend bot** owns the XMTP group and only invites wallets that purchased.
- **React frontend** deploys contracts, verifies purchases and lets members chat.

The frontend calls the contract to purchase membership, then asks the backend to invite
the wallet into the group. The backend can also watch contract events and forward
proposal or vote updates to the chat.

## Documentation
Use the docs below to dive into each component:

- [CONTRACTS.md](./CONTRACTS.md) – smart‑contract specification
- [BACKEND.md](./BACKEND.md) – XMTP bot and API
- [FRONTEND.md](./FRONTEND.md) – React client

## Quick start
1. **Clone & install**
   ```bash
   git clone <repo>
   cd templ
   npm install
   npm --prefix backend install
   npm --prefix frontend install
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
4. **Configure environment files**
   - **Root `.env`** – used by deployment scripts. Populate values like RPC URL and deployer keys (see *Deploying to production* below).
  - **`backend/.env`** – used only by the XMTP bot. Copy any shared values from the root `.env` or provide separate ones as needed.
    Include `ALLOWED_ORIGINS` with the frontend URLs allowed to call the API.
  ```env
  # backend/.env
  RPC_URL=https://mainnet.base.org
  BOT_PRIVATE_KEY=0x...
  ALLOWED_ORIGINS=http://localhost:5173
  ```
5. **Launch backend bot**
   ```bash
   npm --prefix backend start
   ```
6. **Start frontend**
   ```bash
   npm --prefix frontend run dev
   ```

## Deploying to production
1. Create a `.env` file in the project root for the deployment scripts. This file is distinct from `backend/.env` used by the bot; copy any overlapping variables (e.g., `RPC_URL`, keys) into `backend/.env` if the bot requires them. The bot's key (`BOT_PRIVATE_KEY`) belongs only in `backend/.env`. The deploying wallet becomes the priest automatically, so `PRIEST_ADDRESS` is only needed when overriding in tests.
    ```env
    PROTOCOL_FEE_RECIPIENT=0x...
    TOKEN_ADDRESS=0x...
    ENTRY_FEE=100000000000000000 # wei
    RPC_URL=https://mainnet.base.org
    PRIVATE_KEY=0x...
    PRIEST_VOTE_WEIGHT=10
    PRIEST_WEIGHT_THRESHOLD=10
    BASESCAN_API_KEY=...
    ```
   See [`CONTRACTS.md`](./CONTRACTS.md) for the full list of supported variables.
2. Run the full test suite and Slither analysis.
3. Deploy with `scripts/deploy.js` and record the contract address and XMTP group ID.
4. Host the backend bot (e.g., on a VM) using the contract address and bot key. Ensure
   `backend/.env` sets `ALLOWED_ORIGINS` to the frontend URL(s) permitted to call the API.
5. Build the frontend (`npm --prefix frontend run build`) and serve the static files.

## Core flows
1. **Templ creation** – deploy contract and create a private XMTP group with the priest added at creation time.
2. **Pay‑to‑join** – wallet calls `purchaseAccess` and backend invites it into the group.
3. **Messaging** – members send and receive XMTP messages in the group chat.
4. **Priest muting** – priest can mute members but cannot rug the group.
5. **Proposal creation** – any member drafts a call‑data proposal from the chat UI.
6. **Voting** – members cast yes/no votes and see live tallies as events arrive.

For auditing guides, continue with the docs linked above.

## Security considerations
- Proposals invoking `executeDAO` can call any external contract with ETH.
  Members should carefully audit these proposals because malicious or misconfigured calls can drain funds or interact with unsafe contracts.
