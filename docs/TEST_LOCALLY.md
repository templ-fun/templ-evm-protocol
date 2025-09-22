# Test Locally (Fast Path)

Bring the entire stack up on your machine so you can deploy a templ, join as members, and exercise governance without touching production services.

## Why this guide matters

- Spin up Hardhat, the backend bot, and the frontend with minimal setup.
- Preload MetaMask with deterministic wallets so you can test priest/member roles quickly.
- Optionally run against a local XMTP node when you need hermetic e2e tests.

This guide uses Hardhat’s default accounts; never reuse these keys on real networks. XMTP dev is the default target, but you can switch to a local node when needed.

## Prerequisites

- Node >= 22.18.0
- One terminal per service (or use tmux)

## 1) Start a local chain

Terminal A:

```bash
npm run node
```

This boots Hardhat at `http://127.0.0.1:8545` with 20 funded test accounts.

## 2) Start the backend (local XMTP + Hardhat)

Create `backend/.env` with the local RPC and a bot key (Hardhat account #0):

```bash
RPC_URL=http://127.0.0.1:8545
BOT_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
ALLOWED_ORIGINS=http://localhost:5173
ENABLE_DEBUG_ENDPOINTS=1
```

Terminal B:

```bash
npm --prefix backend start
```

The backend listens on `http://localhost:3001`.

Tip: to target a local XMTP node instead of dev, set `XMTP_ENV=local` in `backend/.env` and start a local node as described in `xmtp-local-node/README.md`.

## 3) Start the frontend (Vite dev)

Terminal C:

```bash
npm --prefix frontend run dev
```

Open `http://localhost:5173` in your browser.

Tip: the app defaults to XMTP dev when running on `localhost`.
To target a local XMTP node instead, set `VITE_XMTP_ENV=local` in `frontend/.env`.

## 4) Generate fresh wallets (avoid XMTP install caps)

By default, Hardhat’s first 20 accounts are static. XMTP imposes per-address installation limits over time. For clean local tests, generate fresh wallets and fund them from Hardhat #0:

```bash
npm run gen:wallets
```

This writes `wallets.local.json` and prints private keys for import. You can also mint TestToken to them in one go if you already deployed the token:

```bash
npm run gen:wallets -- --token <TestTokenAddress>
```

## 5) Import wallets into MetaMask

Add the Hardhat network in MetaMask:

- Network name: Hardhat
- RPC URL: `http://127.0.0.1:8545`
- Chain ID: `1337`
- Currency: ETH

Import these private keys (addresses are shown for convenience):

- Backend bot (do not use in UI):
  - `0xac0974…ff80` → `0xf39f…2266`
- Priest (use this first in the UI):
  - `0x7c8521…07a6` → `0x90F7…b906`
- Member (use after deploying):
  - `0x47e179…926a` → `0x15d3…6A65`
- Optional delegate:
  - `0x8b3a35…ffba` → `0x9965…A4dc`

These are Hardhat defaults, funded automatically.

## 6) Deploy a test ERC-20 token locally

Use Hardhat console (Terminal A or a new one):

```bash
npx hardhat console --network localhost
```

In the console:

```bash
const [deployer] = await ethers.getSigners();
const Token = await ethers.getContractFactory("TestToken");
const token = await Token.deploy("Test", "TEST", 18);
await token.waitForDeployment();
token.target

// Fund priest and member with TEST tokens
await token.mint("0x90F79bf6EB2c4f870365E785982E1f101E93b906", ethers.parseEther("1000000"));
await token.mint("0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65", ethers.parseEther("1000000"));
```

Copy the printed `token.target` address.

## 7) Create a Templ (priest)

In the frontend (with the Priest wallet selected):

1. Click `Connect Wallet`.
2. Go to `Create`.
3. Fill:
   - Token address: paste the `token.target` from step 5
   - Protocol fee recipient: `0x70997970C51812dc3A010C7d01b50e0d17dc79C8` (Hardhat #1)
   - Entry fee: `100` (must be ≥10 and divisible by 10)
   - Note: governance rules:
     - One member = one vote; proposer auto-YES; votes are changeable until eligibility closes.
     - Before quorum, any member may vote; after quorum is reached, only members who joined before `quorumReachedAt` may vote.
     - Execution requires a simple majority. For most proposals, execution is allowed only after quorum is reached and the post-quorum delay elapses; priest-proposed disband is quorum-exempt and respects only its end time.
4. Click `Deploy`.

You’ll land in `Chat` with the group created. The header shows the contract short address.

## 8) Join as a member

Switch MetaMask to the Member wallet (`0x15d3…6A65`). In the app:

1. Click `Connect Wallet`.
2. Go to `Join`.
3. Paste the Templ contract address you just deployed.
4. Click `Purchase & Join` (the UI approves tokens and purchases access, then connects to chat).

   The join flow now always posts to `/join`; the UI only falls back to any locally cached templ addresses when `TEMPL_ENABLE_LOCAL_FALLBACK=1` (used in automated tests). Leave that flag unset during manual runs so you verify the backend invite path end-to-end.

The chat auto-loads the last 100 messages and any past proposals. Use “Load previous” to page older history.

## 9) Try governance in chat

- Click `Propose vote` (priest or any member): optionally set a title (shared via XMTP only) and use the “Pause DAO” quick action (encodes `setPausedDAO(true)`). Submit and sign the tx.
- A poll bubble appears in chat.
- Vote via `Vote Yes/No`; each voter signs their tx.
- If you’re the priest, an `Execute` button is always visible; the contract enforces eligibility (quorum, delay, quorum-exempt priest disband timing) and reverts when the proposal cannot yet be executed.

## Troubleshooting

- Backend CORS: update `ALLOWED_ORIGINS` in `backend/.env` if your frontend origin differs.
- Ports in use: stop stray `:8545`, `:3001`, or `:5173` processes before restarting.
- XMTP boot time: the first run may take ~20-60s while the SDK initializes identity and device sync. Subsequent runs are faster.

## Next

Check [../scripts/README.md](../scripts/README.md) for deployment, wallet, and CI scripts that build on this setup.
