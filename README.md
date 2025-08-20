# TEMPL - Telegram Entry Management Protocol

**Production-Ready** token-gated Telegram group access system with priest-controlled treasury on BASE.

## 🎯 Overview

**Deployed on BASE Chain** - Users pay tokens to join exclusive Telegram groups:
- **50% to Treasury**: Accumulates for priest-controlled withdrawals
- **50% Burned**: Permanently removed from circulation  
- **One Purchase Per Wallet**: Enforced on-chain and off-chain
- **Direct Invitations**: No public invite links for maximum security
- **BASE Network**: Fast & low-cost transactions

## 🔒 Security Features

- ✅ Single priest authority (controls treasury & admin)
- ✅ 50/50 fee split (treasury/burn)
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

### Complete Purchase Flow
Use the all-in-one interface at `https://yoursite.com/purchase.html?contract=0x...`
1. **Connect Wallet** - MetaMask or any Web3 wallet (ensure BASE network)
2. **Approve Tokens** - One-time approval for the contract
3. **Purchase Access** - Pay entry fee (50% treasury, 50% burned)
4. **Enter Username** - Submit your Telegram username
5. **Receive Invitation** - Bot sends group invite

### Alternative: Direct Contract + Claim
1. Call `contract.purchaseAccess()` directly via Etherscan/wallet
2. Visit `https://yoursite.com/claim.html?contract=0x...`
3. Connect wallet and verify purchase
4. Enter Telegram username
5. Receive group invitation

## 👑 Treasury Management

The priest (set at deployment) has complete control:

```javascript
// Check treasury balance
const info = await contract.getTreasuryInfo()

// Withdraw specific amount
await contract.withdrawTreasury(recipient, amount)

// Withdraw all funds
await contract.withdrawAllTreasury(recipient)
```

## 🔧 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/verify-purchase` | POST | Verify wallet purchase (requires signature) |
| `/api/claim-access` | POST | Submit Telegram username (requires JWT) |
| `/api/retry-invitation` | POST | Retry failed invitation |
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

// Treasury Functions (Priest Only)
function withdrawTreasury(address recipient, uint256 amount) external
function withdrawAllTreasury(address recipient) external
function getTreasuryInfo() view returns (balance, received, burned, priest)

// Admin Functions (Priest Only)
function setPaused(bool) external
function updateConfig(address token, uint256 fee) external
function recoverWrongToken(address token, address to) external
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
PRIEST_ADDRESS=0x...  # Treasury controller
FRONTEND_URL=https://yoursite.com

# BLOCKCHAIN (Required)
RPC_URL=https://mainnet.base.org
TOKEN_ADDRESS=0x...   # ERC20 token on BASE
ENTRY_FEE=420         # Must be even
CONTRACT_ADDRESS=0x...  # After deployment
CHAIN_ID=8453        # BASE mainnet

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

## 🐛 Troubleshooting

### Cannot Withdraw Treasury
- Verify calling from priest address
- Check treasury has balance
- Ensure contract not paused

### User Can't Join
- Check Telegram privacy settings
- Verify purchase on-chain
- Check username format

### Session Expired
- Run `./first-run.sh` to re-authenticate
- SESSION_STRING will be updated automatically

## 🔐 Security Notes

- **Priest is the sole authority** (no separate owner role)
- Priest address is **immutable** after deployment
- All sensitive operations logged
- Nonce prevents replay attacks
- JWT sessions expire after 1 hour
- No automatic group creation - manual control only

## 📝 License

MIT License - Use responsibly and in accordance with Telegram's Terms of Service.

---

**Important**: This system uses direct API invitations for maximum security. No public invite links are generated. Groups must be created manually.