# Develop and test templ locally

Follow this guide to spin up the entire stack (Hardhat RPC, backend API, and chat-first frontend) on your workstation. The end result should let you mint a templ, register it with the backend, join from a wallet, and govern entirely through the XMTP chat UI.

## 0) Install dependencies and copy sample env files

```bash
npm ci
npm --prefix backend ci
npm --prefix frontend ci

cp backend/.env.test backend/.env          # tweak values in the next step
cp frontend/.env.example frontend/.env.local 2>/dev/null || true
```

The backend sample already sets `BACKEND_SERVER_ID=templ-dev` and `APP_BASE_URL=http://localhost:5173`. The frontend defaults to the same URLs unless you override them in `.env.local`.

## 1) Start a Hardhat chain

Terminal A:

```bash
npm run node
```

Hardhat exposes JSON-RPC on `http://127.0.0.1:8545` and pre-funds 20 deterministic accounts.

## 2) Configure & start the backend

Create or update `backend/.env`:

```env
RPC_URL=http://127.0.0.1:8545
ALLOWED_ORIGINS=http://localhost:5173
BACKEND_SERVER_ID=templ-dev
APP_BASE_URL=http://localhost:5173
# Optional extras
# XMTP_ENV=local
# TELEGRAM_BOT_TOKEN=123456:bot-token-from-botfather
# SQLITE_DB_PATH=./templ.local.db
```

Terminal B:

```bash
npm --prefix backend start
```

The server listens on `http://localhost:3001`, verifies signatures, persists templ metadata, orchestrates XMTP groups, and—if you supply `TELEGRAM_BOT_TOKEN`—forwards events to Telegram. SQLite is optional for local work; memory storage keeps things simple.

## 3) Start the frontend

Terminal C:

```bash
npm --prefix frontend run dev
```

Open `http://localhost:5173`. The home page lists templs, exposes a Join button, and routes directly into the chat-first workflow after a templ is registered and joined.

## 4) Deploy and register a templ manually

The UI does not handle deployments. Use Hardhat or a script to deploy via `TemplFactory` and register the address with the backend.

Example using the Hardhat console (Terminal D):

```bash
npx hardhat console --network localhost
```

Inside the console:

```js
const [deployer] = await ethers.getSigners();
const factoryFactory = await ethers.getContractFactory('TemplFactory', deployer);
const protocolRecipient = deployer.address;
const templFactory = await factoryFactory.deploy(protocolRecipient, 1000);
await templFactory.waitForDeployment();
await templFactory.setPermissionless(true);

const tokenFactory = await ethers.getContractFactory('TestToken', deployer);
const token = await tokenFactory.deploy('Templ Token', 'TMPL', 18);
await token.waitForDeployment();

const entryFee = ethers.parseUnits('1', 18);
const tx = await templFactory.createTemplFor(deployer.address, await token.getAddress(), entryFee);
const receipt = await tx.wait();
const templCreated = receipt.logs.map(log => {
  try { return templFactory.interface.parseLog(log); } catch { return null; }
}).find(Boolean);
const templAddress = templCreated.args.templ;
console.log('Templ deployed at', templAddress);
```

Back in your shell, register the templ with the backend so chat groups are created and metadata is cached:

```bash
curl -sS -X POST http://localhost:3001/templs/auto \
  -H "content-type: application/json" \
  -d "{\"contractAddress\":\"$templAddress\"}"
```

Mint access tokens to any wallets you plan to use (Hardhat account #4 is a good “member” account):

```bash
node <<'JS'
const { ethers } = require('ethers');
const provider = new ethers.JsonRpcProvider('http://127.0.0.1:8545');
const deployer = new ethers.Wallet('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', provider);
const token = new ethers.Contract(process.env.TOKEN_ADDRESS, require('../artifacts/contracts/mocks/TestToken.sol/TestToken.json').abi, deployer);
const member = '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65';
await (await token.mint(member, ethers.parseUnits('10', 18))).wait();
console.log('Minted tokens to', member);
JS
```

## 5) Join and chat

1. In the browser, click **Join** on the home page (or visit `/templs/join?address=<templAddress>` directly).
2. Approve the entry fee when prompted, then click **Join templ**. The UI waits for the transaction, signs the typed `/join` payload, and navigates straight to `/templs/<address>/chat` after the backend confirms membership.
3. Inside the chat you’ll see message history, the “New proposal” composer, poll-style proposal cards, vote buttons, and the **Claim rewards** modal.

Invite a second wallet (Hardhat account #5) and repeat the join flow if you want to observe multi-member quorum behaviour.

## 6) Propose, vote, and execute inside chat

- Use **New proposal** to raise actions (pause joins, change priest, tweak fee splits, update the home link, etc.).
- Poll cards appear in the timeline with YES/NO tallies. Vote buttons send `vote(proposalId, support)` transactions via the injected wallet.
- Once the voting window closes (fast-forward with `npx hardhat console` using `evm_increaseTime` for local tests), click **Execute** on the poll card to run the action on-chain.
- XMTP payloads mirror these actions, so every proposal, vote, execution, and reward claim stays visible to the group. Telegram notifications still work if you bind a chat, but they’re optional.

## 7) Automated checks

When manual testing looks good, run the full suite ahead of sending changes for review:

```bash
npm run test:all
```

This clears Vite caches, runs backend + frontend unit tests, and executes the Playwright chat flow (which deploys a templ, joins it, proposes, votes, and executes from chat).

## 8) Point the stack at a persistent deployment

Testing against a live factory is straightforward:

1. Update `backend/.env` with `RPC_URL`, `TRUSTED_FACTORY_ADDRESS`, and `TRUSTED_FACTORY_DEPLOYMENT_BLOCK`, then restart the server.
2. Override the frontend (`frontend/.env.local` or shell env) with the same factory address so the home page lists production templs.
3. Reinstate your usual `TRUSTED_FACTORY_ADDRESS` after the templ shows up in `/templs` responses so future registrations continue to be validated automatically.

With that in place you can join live templs from the chat UI while still iterating locally.
