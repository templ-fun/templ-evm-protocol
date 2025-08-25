# TEMPL - Telegram Entry Management Protocol with DAO Governance

**Production-Ready** token-gated Telegram group access system with DAO-controlled treasury on BASE.

## 🎯 Overview

**Deployed on BASE Chain** - Users pay tokens to join exclusive Telegram groups:
- **30% Burned**: Permanently removed from circulation
- **30% to DAO Treasury**: Controlled by member voting, not priest
- **30% to Member Pool**: Distributed pro-rata to existing members (30% to 1st member, 15% each to 2 members, 10% each to 3+ members)
- **10% Protocol Fee**: Goes directly to protocol fee recipient address
- **DAO Governance**: Members vote on treasury withdrawals and config changes
- **Priest Voting Power**: Priest's vote has configurable weight (default 10x) until member threshold is reached (default 10 members)
- **Single Active Proposal**: Each member can only have one active proposal at a time
- **Voting Eligibility**: Only members who joined before a proposal was created can vote on it
- **One Purchase Per Wallet**: Enforced on-chain and off-chain
- **Direct Invitations**: No public invite links for maximum security
- **BASE Network**: Fast & low-cost transactions
- **Member Rewards**: Earlier members earn from new members joining

## 🔒 Security Features

- ✅ DAO-controlled treasury (voting required for withdrawals)
- ✅ 30/30/30/10 fee split (burn/DAO treasury/pool/protocol)
- ✅ Pro-rata member rewards system with fair distribution
- ✅ Member-driven governance with proposals and voting
- ✅ Executable on-chain proposals
- ✅ >50% yes votes required to pass proposals (simple majority)
- ✅ Single active proposal per member (prevents spam)
- ✅ Voting restricted to members who joined before proposal creation (prevents gaming)
- ✅ Payment enforcement before access
- ✅ JWT authentication with required secrets
- ✅ Nonce-based signature verification (replay attack prevention)
- ✅ Strict CORS policies
- ✅ Rate limiting
- ✅ SQL injection protection (parameterized queries)
- ✅ Admins cannot invite users (only via token payment)
- ✅ Admins can mute/ban users

## 📋 Prerequisites

- Node.js v16+
- PostgreSQL
- Wallet with ETH on BASE
- Telegram API credentials from https://my.telegram.org

## 🚀 Quick Setup (One Command)

```bash
# Run the setup script
./setup.sh

# For first-time Telegram authentication
./first-run.sh
```

The setup script will:
- Configure all environment variables
- Install dependencies
- Set up database
- Compile smart contracts
- Optionally deploy contracts
- Create systemd service

## 🎯 Important: Manual Group Setup

**You must manually create the Telegram group first:**

1. **Create Group**: Use the Telegram account associated with your API credentials
2. **Add Bot**: Add your bot (@YourBotUsername) as admin with these permissions:
   - Delete messages: ✅
   - Ban users: ✅ 
   - Invite users: ❌ (disabled to enforce token payments)
3. **Get Group ID**: Send a message in the group, then use [@userinfobot](https://t.me/userinfobot) to get the group ID
4. **Update .env**: Set `TELEGRAM_GROUP_ID` to your group ID (e.g., -1001234567890)

## 💰 User Flow

### Priest Dashboard (NEW)
Priests can create and manage temples at `https://yoursite.com/priest.html`
- Auto-creates Telegram groups
- Links groups to contracts
- Adds priest as admin
- Generates purchase URLs

### Complete Purchase Flow
Use the all-in-one interface at `https://yoursite.com/purchase.html?contract=0x...`
1. **Connect Wallet** - MetaMask or any Web3 wallet (ensure BASE network)
2. **Approve Tokens** - One-time approval for the contract
3. **Purchase Access** - Pay entry fee (30% burned, 30% treasury, 30% member pool, 10% protocol)
4. **Enter Username** - Submit your Telegram username
5. **Receive Invitation** - Bot sends group invite
6. **Claim Rewards** - Check and claim your member pool rewards anytime

### Member Pool Distribution
The 30% member pool is distributed based on member count:
- **1 Member**: Gets full 30% from next joiner
- **2 Members**: Each gets 15% from next joiner
- **3+ Members**: Each gets equal share (10% each for 3, 7.5% each for 4, etc.)

### Alternative: Direct Contract + Claim
1. Call `contract.purchaseAccess()` directly via Etherscan/wallet
2. Visit `https://yoursite.com/claim.html?contract=0x...`
3. Connect wallet and verify purchase
4. Enter Telegram username
5. Receive group invitation

## 🗳️ DAO Treasury Management

Treasury is controlled by member voting, not the priest:

### Creating Proposals
Visit `https://yoursite.com/propose.html?contract=0x...`
- Connect as a member
- Enter proposal title and description
- Choose action type:
  - Treasury withdrawal
  - Config updates
  - Pause/unpause contract
  - Custom actions
- Set voting period (7-30 days, default 7 days)
- Submit proposal
- **Note**: Each member can only have one active proposal at a time

### Voting on Proposals
Visit `https://yoursite.com/vote.html?contract=0x...`
- View active proposals
- Cast yes/no votes (one vote per member)
- Track voting progress
- Execute passed proposals (requires >50% yes votes)
- **Note**: Only members who joined before the proposal was created can vote

### Treasury Info
```javascript
// Check treasury balance
const info = await contract.getTreasuryInfo()

// Treasury withdrawals require passed DAO proposals
// These functions will revert with error message directing to DAO
await contract.withdrawTreasury(recipient, amount) // DEPRECATED - use DAO

// DAO-controlled treasury functions (called via proposals)
await contract.withdrawTreasuryDAO(recipient, amount, reason)
await contract.withdrawAllTreasuryDAO(recipient, reason)
```

### Governance Rules
- **Proposal Limits**: One active proposal per member at a time
- **Voting Eligibility**: Only members who joined before proposal creation can vote
- **Passing Threshold**: Simple majority (>50% of votes cast)
- **Voting Period**: Configurable from 7 to 30 days
- **Priest Vote Weight**: 
  - Priest's vote counts as multiple votes (configurable, default 10)
  - Weight applies when member count is below threshold (configurable, default 10 members)
  - Once threshold is reached, priest's vote counts as 1 like everyone else
- **Execution**: Anyone can execute passed proposals after voting ends

### Example Proposal Calldata

#### Withdraw Treasury Tokens (Access Token)
```javascript
// Withdraw specific amount of access tokens from treasury
const iface = new ethers.Interface([
    "function withdrawTreasuryDAO(address,uint256,string)"
]);
const callData = iface.encodeFunctionData("withdrawTreasuryDAO", [
    "0xRecipientAddress",
    ethers.parseUnits("100", 18), // Amount
    "Payment for development work"
]);
```

#### Transfer Any ERC20 Token from Contract
```javascript
// For transferring other tokens that the contract holds
// (e.g., tokens received from trades, airdrops, etc.)
const erc20Interface = new ethers.Interface([
    "function transfer(address,uint256)"
]);

// Create calldata for the ERC20 transfer
const transferCalldata = erc20Interface.encodeFunctionData("transfer", [
    "0xRecipientAddress",
    ethers.parseUnits("500", 18)
]);

// Wrap it in a proposal that executes on the token contract
const proposalInterface = new ethers.Interface([
    "function executeDAO(address,uint256,bytes)"
]);
const callData = proposalInterface.encodeFunctionData("executeDAO", [
    "0xTokenContractAddress", // The ERC20 token to transfer
    0, // ETH value (0 for token transfers)
    transferCalldata
]);
```

#### Approve Token Spending (for DEX trades, staking, etc.)
```javascript
// Approve a DEX or staking contract to spend treasury tokens
const erc20Interface = new ethers.Interface([
    "function approve(address,uint256)"
]);

// Create the approve calldata
const approveCalldata = erc20Interface.encodeFunctionData("approve", [
    "0xDEXorStakingContract",
    ethers.parseUnits("1000", 18)
]);

// Wrap it in executeDAO for the proposal
const proposalInterface = new ethers.Interface([
    "function executeDAO(address,uint256,bytes)"
]);
const callData = proposalInterface.encodeFunctionData("executeDAO", [
    "0xTokenContractAddress", // The token to approve
    0, // No ETH needed
    approveCalldata
]);
```

#### Update Contract Configuration
```javascript
// Change token or entry fee
const iface = new ethers.Interface([
    "function updateConfigDAO(address,uint256)"
]);
const callData = iface.encodeFunctionData("updateConfigDAO", [
    "0xNewTokenAddress", // or address(0) to keep current
    ethers.parseUnits("500", 18) // New entry fee, or 0 to keep current
]);
```

#### Pause/Unpause Contract
```javascript
// Pause or unpause new member joins
const iface = new ethers.Interface([
    "function setPausedDAO(bool)"
]);
const callData = iface.encodeFunctionData("setPausedDAO", [
    true // true to pause, false to unpause
]);
```

**Important**: All tokens held by the contract (treasury, member pool, and any other tokens) can ONLY be moved through successful DAO proposals. There is no backdoor or admin function to withdraw tokens.

## 🔧 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/verify-purchase` | POST | Verify wallet purchase (requires signature) |
| `/api/claim-access` | POST | Submit Telegram username (requires JWT) |
| `/api/retry-invitation` | POST | Retry failed invitation |
| `/api/create-temple` | POST | Create new group for contract (priest only) |
| `/api/group-contract/:id` | GET | Get contract info for a group |
| `/api/invite-rosie-bot` | POST | Invite Rosie bot to group (admin only) |
| `/api/claim-status/:wallet/:contract` | GET | Check claim status |
| `/api/contract-stats/:contract` | GET | Contract statistics |

## 📁 Project Structure

```
tgbot-group/
├── contracts/
│   ├── TEMPL.sol                  # Main smart contract
│   └── MockERC20.sol              # Test ERC20 token
├── src/
│   ├── tokenGatedService.js      # Main service
│   ├── api/
│   │   └── tokenGatedAPI.js      # REST API endpoints
│   ├── blockchain/
│   │   └── monitor.js            # Blockchain event monitor
│   ├── database/
│   │   ├── db.js                 # Database operations
│   │   └── schema.sql            # PostgreSQL schema
│   └── telegram/
│       └── client.js             # Telegram MTProto client
├── scripts/
│   ├── deploy.js                 # Smart contract deployment
│   ├── verify-system.js          # System verification
│   ├── setup.sh                  # One-command setup
│   └── first-run.sh              # Telegram authentication
├── public/
│   ├── index.html                # Landing page
│   ├── priest.html               # Priest dashboard (NEW)
│   ├── purchase.html             # Complete purchase flow
│   └── claim.html                # Claim-only interface
├── test/
│   └── TEMPL.test.js             # Smart contract tests
├── docker-compose.token-gated.yml # Docker configuration
├── Dockerfile                    # Container definition
├── hardhat.config.js             # Hardhat configuration
└── package.json                  # Dependencies
```

## 📊 Smart Contract Interface

```solidity
// User Functions
function purchaseAccess() external
function hasAccess(address user) view returns (bool)
function getPurchaseDetails(address) view returns (purchased, timestamp, block)
function getClaimablePoolAmount(address member) view returns (uint256)
function claimMemberPool() external

// DAO Governance Functions (Members Only)
function createProposal(string title, string description, bytes callData, uint256 votingPeriod) returns (uint256)
function vote(uint256 proposalId, bool support) external
function executeProposal(uint256 proposalId) external
function getProposal(uint256 proposalId) view returns (proposer, title, description, yesVotes, noVotes, endTime, executed, passed)
function hasVoted(uint256 proposalId, address voter) view returns (bool voted, bool support)
function getActiveProposals() view returns (uint256[] memory)
function hasActiveProposal(address member) view returns (bool)
function activeProposalId(address member) view returns (uint256)
function getVoteWeight(address voter) view returns (uint256)

// DAO-Controlled Treasury Functions (Called via Proposals)
function withdrawTreasuryDAO(address recipient, uint256 amount, string reason) external
function withdrawAllTreasuryDAO(address recipient, string reason) external
function executeDAO(address target, uint256 value, bytes data) external returns (bytes)
function updateConfigDAO(address token, uint256 fee) external
function setPausedDAO(bool paused) external

// Legacy Functions (Now Require DAO Approval - Will Revert)
function withdrawTreasury(address recipient, uint256 amount) external // DEPRECATED
function withdrawAllTreasury(address recipient) external // DEPRECATED
function updateConfig(address token, uint256 fee) external // DEPRECATED
function setPaused(bool) external // DEPRECATED

// Info Functions
function getTreasuryInfo() view returns (treasury, memberPool, totalReceived, totalBurned, totalProtocol, protocolFeeRecipient)
function getConfig() view returns (token, fee, isPaused, purchases, treasury, pool)
function getMemberCount() view returns (uint256)

```

## ⛓️ BASE Deployment

This system is specifically designed for BASE mainnet (Chain ID: 8453).

### Why BASE?
- **Low Gas Fees**: Fraction of Ethereum mainnet costs
- **Fast Transactions**: 2-second block times
- **Ethereum Security**: Secured by Ethereum through Optimism
- **Growing Ecosystem**: Native USDC and major tokens available

### Getting ETH on BASE
1. Bridge ETH from Ethereum: https://bridge.base.org
2. Buy directly on BASE via exchanges (Coinbase, etc.)
3. Use BASE native faucets for testing

## 🚢 Production Deployment

### Environment Variables

Create `.env` file (use `./setup.sh` for guided setup):

```env
# SECURITY (Required)
JWT_SECRET=your-strong-random-secret-min-32-chars
PRIEST_ADDRESS=0x...  # Temple creator with voting weight
PROTOCOL_FEE_RECIPIENT=0x...  # Receives 10% protocol fee (can be same as priest)
FRONTEND_URL=https://yoursite.com

# BLOCKCHAIN (Required)
RPC_URL=https://mainnet.base.org
TOKEN_ADDRESS=0x...   # ERC20 token on BASE
ENTRY_FEE=420         # Must be at least 10 for proper distribution
CONTRACT_ADDRESS=0x...  # After deployment
CHAIN_ID=8453        # BASE mainnet
PRIEST_VOTE_WEIGHT=10   # Optional: Priest vote multiplier (default 10)
PRIEST_WEIGHT_THRESHOLD=10  # Optional: Member count for priest weight reduction (default 10)

# DATABASE (Required)
DB_HOST=localhost
DB_PORT=5432
DB_NAME=telegram_access
DB_USER=postgres
DB_PASSWORD=strong_password

# TELEGRAM (Required)
API_ID=your_api_id
API_HASH=your_api_hash
PHONE_NUMBER=+1234567890
SESSION_STRING=       # Generated on first run
BOT_USERNAME=botname  # Without @
TELEGRAM_GROUP_ID=-1001234567890
```

### Deployment Steps

```bash
# 1. Setup
./setup.sh

# 2. Deploy contract to BASE
npm run deploy

# 3. Verify system
npm run verify

# 4. Start service
npm start

# Or use systemd
sudo systemctl start templ
sudo systemctl enable templ
```

### Monitoring

```bash
# Check treasury
curl http://localhost:3002/api/contract-stats/CONTRACT_ADDRESS

# View on Basescan
# https://basescan.org/address/CONTRACT_ADDRESS

# View logs
journalctl -u templ -f

# Database queries
psql -d telegram_access -c "SELECT * FROM purchases ORDER BY created_at DESC LIMIT 10;"
```