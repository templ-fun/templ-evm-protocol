# TEMPL Deployment and Testing Configuration

## Overview
This document describes the deployment configuration for TEMPL and how persistence is handled in different environments.

## Persistence

### What We Persist

1. **XMTP Databases** (`*.db3` files)
   - Located in the working directory where the service runs
   - Named pattern: `xmtp-{env}-{inboxId}.db3`
   - Contains encrypted XMTP conversation history and keys
   - Used to maintain consistent inbox IDs across restarts

2. **SQLite Groups Database** (`groups.db`)
   - Backend service database storing TEMPL group mappings
   - Maps contract addresses to XMTP group IDs
   - Persists across restarts in production

### Test Environment Handling

#### XMTP Inbox Rotation Issue
- XMTP has limits: 10-14 installations per inbox, 256 total inbox actions
- Once limits are reached, the inbox ID cannot be used anymore
- Tests were exhausting these limits quickly

#### Solution: Nonce-Based Rotation (Attempted)
```javascript
// For test environments, use a nonce to rotate inbox IDs
const nonce = process.env.ROTATE_INBOX ? BigInt(Date.now()) : undefined;
```
**Note**: This approach was attempted but XMTP SDK doesn't properly support nonce-based inbox rotation yet.

#### Current Solution: Pre-existing XMTP Databases
- Tests use pre-created XMTP database files from successful runs
- Located in `frontend/` directory: `xmtp-dev-*.db3` files
- These are copied to the backend directory for testing
- Ensures consistent inbox IDs that haven't hit limits

## Environment Configuration

### Backend (.env files)

#### Production
```bash
NODE_ENV=production
RPC_URL=https://your-rpc-endpoint
BOT_PRIVATE_KEY=0x...  # Server wallet private key
PORT=3001
ALLOWED_ORIGINS=https://your-frontend-domain
```

#### Test (.env.test)
```bash
NODE_ENV=test
RPC_URL=http://localhost:8545
BOT_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80  # Hardhat account[0]
PORT=3001
ALLOWED_ORIGINS=http://localhost:5173
```

### Frontend Configuration

The frontend expects:
- MetaMask or compatible wallet provider at `window.ethereum`
- Backend API at the URL specified in environment
- XMTP SDK for messaging

## Testing Setup

### E2E Tests with Playwright

1. **Services Required**:
   - Hardhat node: `npx hardhat node` (port 8545)
   - Backend: `npm start` in backend/ (port 3001)
   - Frontend: `npm run dev` or `npx vite preview` (port 5173)

2. **Wallet Mocking**:
   Tests mock MetaMask using `context.addInitScript`:
   ```javascript
   await context.addInitScript(() => {
     window.ethereum = {
       isMetaMask: true,
       request: async ({ method }) => {
         // Mock responses for eth_requestAccounts, eth_chainId, etc.
       }
     };
   });
   ```

3. **Running Tests**:
   ```bash
   # Start all services first
   npx hardhat node  # In root directory
   cd backend && npm start  # In another terminal
   cd frontend && npx vite preview  # Production build
   
   # Run tests
   cd frontend && npx playwright test --config=playwright-no-server.config.js
   ```

### Handling XMTP Limits

**Problem**: Default test wallets (Hardhat accounts) hit XMTP installation limits.

**Solutions Attempted**:
1. ❌ Nonce rotation - Not properly supported by SDK
2. ❌ Revoking installations - Doesn't reset the 256 action limit
3. ❌ Using different private keys - Requires funding new wallets
4. ✅ Using pre-existing XMTP databases - Works for tests

**For New Deployments**:
- Use a fresh private key that hasn't been used with XMTP
- Or accept that after ~10 deployments, you'll need a new wallet
- In production, this isn't an issue as the server maintains one persistent connection

## CI/CD Considerations

1. **XMTP in CI**: 
   - XMTP client creation fails in CI without proper setup
   - Integration tests have fallback to mock clients
   - E2E tests require real XMTP or pre-existing databases

2. **Database Files**:
   - Should NOT be committed for production keys
   - Test databases can be committed for consistent testing
   - CI should clean databases between test runs

3. **Environment Variables**:
   - Never commit real private keys
   - Use secrets management in CI/CD
   - Test keys (Hardhat defaults) are safe to commit

## Deployment Checklist

### Production
- [ ] Set production RPC URL
- [ ] Configure secure BOT_PRIVATE_KEY (not a test key)
- [ ] Set ALLOWED_ORIGINS to production domain
- [ ] Ensure XMTP database persists across deployments
- [ ] Configure proper backup for groups.db

### Testing
- [ ] Use test private keys (Hardhat accounts)
- [ ] Ensure local blockchain is running
- [ ] Copy XMTP test databases if needed
- [ ] Set NODE_ENV=test for proper behavior

## Known Issues

1. **Vite Dev Server**: "Outdated Optimize Dep" errors
   - Solution: Use production build with `vite preview`

2. **XMTP Signature Required**: First time client creation requires signature
   - Solution: Use existing database files for tests

3. **Installation Limits**: Hardhat test accounts hit XMTP limits
   - Solution: Use pre-created databases or new wallets

## Recovery Procedures

### If XMTP Inbox Is Exhausted
1. Generate new private key
2. Fund the new wallet
3. Update BOT_PRIVATE_KEY in .env
4. Delete old XMTP database files
5. Restart backend service

### If Groups Database Is Corrupted
1. Stop backend service
2. Restore from backup or delete groups.db
3. Restart service (will create new database)
4. Note: Group mappings will be lost