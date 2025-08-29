# TEMPL Tech Demo Recording Instructions

Since Playwright needs to be installed with proper permissions, here's how to create the demo recording:

## Option 1: Fix NPM permissions and run Playwright

1. Fix NPM permissions (run in terminal):
```bash
sudo chown -R $(whoami) ~/.npm
```

2. Install Playwright:
```bash
cd frontend
npm install @playwright/test
npx playwright install
```

3. Run the tests with video recording:
```bash
npm run test:e2e:record
```

4. Find the videos in:
- `frontend/test-results/` - Individual test videos
- `frontend/videos/` - Retained videos
- `frontend/playwright-report/` - HTML report with embedded videos

## Option 2: Manual Demo Recording

If you prefer to record manually:

1. Start all services:
```bash
# Terminal 1 - Blockchain
npx hardhat node

# Terminal 2 - Backend
cd backend && npm start

# Terminal 3 - Frontend
cd frontend && npm run dev
```

2. Open browser at http://localhost:5173

3. Use screen recording software (OBS, QuickTime, etc.) to record while following these steps:

### Demo Flow Script:

1. **Connect Wallet**
   - Click "Connect Wallet"
   - MetaMask will pop up - connect with account

2. **Deploy TEMPL Contract**
   - Enter token address: `0x5FbDB2315678afecb367f032d93F642f64180aa3`
   - Enter protocol fee recipient: `0x70997970C51812dc3A010C7d01b50e0d17dc79C8`
   - Enter entry fee: `100`
   - Click "Deploy TEMPL"
   - Sign transaction in MetaMask

3. **Purchase Access & Join**
   - Copy the deployed contract address
   - Enter it in "TEMPL contract address" field
   - Click "Join TEMPL"
   - Approve token spending in MetaMask
   - Confirm purchase transaction

4. **Send Message**
   - Type: "Hello! This is a demonstration of TEMPL's secure messaging"
   - Click "Send"

5. **Create Proposal**
   - Title: "Enable Emergency Pause"
   - Description: "This proposal enables the emergency pause feature"
   - Calldata: `0x12345678`
   - Click "Create Proposal"
   - Sign transaction

6. **Vote on Proposal**
   - Click "Vote For" on the proposal
   - Sign transaction

7. **Check Moderation**
   - Click "Fetch Mutes"
   - Shows active mutes and moderation status

## Option 3: Use the Integration Tests

Run the integration tests which demonstrate all flows programmatically:

```bash
cd frontend
npm test
```

This will run through all the core flows automatically and show that everything works.

## Expected Output

The video should demonstrate:
- ✅ Smart contract deployment
- ✅ Token-gated access control  
- ✅ Encrypted group messaging via XMTP
- ✅ On-chain governance with proposals and voting
- ✅ Delegated moderation capabilities
- ✅ Complete decentralized access control system

The full flow typically takes 3-5 minutes to demonstrate all features.