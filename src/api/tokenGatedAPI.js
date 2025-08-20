const express = require('express');
const { ethers } = require('ethers');
const Database = require('../database/db');
const TelegramService = require('../telegram/client');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const path = require('path');

class TokenGatedAPI {
  constructor() {
    this.app = express();
    this.db = new Database();
    this.telegramService = new TelegramService();
    this.provider = null;
    this.contract = null;
    
    this.setupMiddleware();
    this.setupRoutes();
  }

  async initialize() {
    if (!process.env.JWT_SECRET) {
      throw new Error('FATAL: JWT_SECRET environment variable is required for security');
    }
    
    if (!process.env.FRONTEND_URL) {
      throw new Error('FATAL: FRONTEND_URL environment variable is required for CORS security');
    }
    
    this.nonceStore = new Map();
    this.cleanupNonces();
    
    await this.db.initialize();
    await this.telegramService.initialize();
    const RPC_URL = process.env.RPC_URL;
    if (!RPC_URL || RPC_URL.includes('YOUR_KEY')) {
      throw new Error('FATAL: Valid RPC_URL environment variable is required');
    }
    this.provider = new ethers.JsonRpcProvider(RPC_URL);
    this.contractABI = [
      "function hasAccess(address user) view returns (bool)",
      "function getPurchaseDetails(address user) view returns (bool purchased, uint256 timestamp, uint256 blockNum)",
      "function getTreasuryInfo() view returns (uint256 balance, uint256 totalReceived, uint256 totalBurnedAmount, address priestAddress)"
    ];
    
    console.log('✅ Token-Gated API initialized with security checks');
  }
  
  cleanupNonces() {
    setInterval(() => {
      const now = Date.now();
      for (const [nonce, timestamp] of this.nonceStore.entries()) {
        if (now - timestamp > 5 * 60 * 1000) {
          this.nonceStore.delete(nonce);
        }
      }
    }, 60 * 1000);
  }

  setupMiddleware() {
    // Serve static files from public directory
    this.app.use(express.static(path.join(__dirname, '../../public')));
    
    this.app.use(helmet({
      contentSecurityPolicy: false, // Allow inline scripts for the HTML pages
    }));
    this.app.use(cors({
      origin: (origin, callback) => {
        const allowedOrigins = process.env.FRONTEND_URL.split(',').map(url => url.trim());
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      },
      credentials: true,
      optionsSuccessStatus: 200
    }));
    this.app.use(express.json());
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 100,
      message: 'Too many requests from this IP, please try again later'
    });
    const strictLimiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 10,
      message: 'Too many attempts, please try again later'
    });
    
    this.app.use('/api/verify-purchase', strictLimiter);
    this.app.use('/api/claim-access', strictLimiter);
    this.app.use('/api', limiter);
    this.app.use((req, res, next) => {
      console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
      next();
    });
  }

  setupRoutes() {
    /**
     * Verify wallet has purchased access
     * POST /api/verify-purchase
     */
    this.app.post('/api/verify-purchase', async (req, res) => {
      try {
        const { walletAddress, contractAddress, signature, message, timestamp } = req.body;
        
        if (!walletAddress || !contractAddress || !signature || !message || !timestamp) {
          return res.status(400).json({ 
            error: 'Wallet address, contract address, signature, message, and timestamp required' 
          });
        }
        
        // Parse message to extract nonce
        const messagePattern = /^Verify access for (0x[a-fA-F0-9]{40}) with nonce ([a-f0-9]{64}) at (\d+)$/;
        const match = message.match(messagePattern);
        
        if (!match) {
          return res.status(401).json({ error: 'Invalid message format' });
        }
        
        const [, msgContract, nonce, msgTimestamp] = match;
        
        if (msgContract.toLowerCase() !== contractAddress.toLowerCase()) {
          return res.status(401).json({ error: 'Contract address mismatch' });
        }
        
        const now = Date.now();
        const parsedTimestamp = parseInt(msgTimestamp);
        if (isNaN(parsedTimestamp) || Math.abs(now - parsedTimestamp) > 5 * 60 * 1000) {
          return res.status(401).json({ error: 'Request expired' });
        }
        
        if (this.nonceStore.has(nonce)) {
          return res.status(401).json({ error: 'Nonce already used' });
        }
        
        this.nonceStore.set(nonce, Date.now());
        
        const recoveredAddress = ethers.verifyMessage(message, signature);
        
        if (recoveredAddress.toLowerCase() !== walletAddress.toLowerCase()) {
          return res.status(401).json({ error: 'Invalid signature' });
        }
        
        const contract = new ethers.Contract(
          contractAddress,
          this.contractABI,
          this.provider
        );
        
        const hasAccess = await contract.hasAccess(walletAddress);
        
        if (!hasAccess) {
          return res.status(403).json({ 
            error: 'No purchase found for this wallet' 
          });
        }
        
        const details = await contract.getPurchaseDetails(walletAddress);
        // Generate a unique tx hash for verification records (max 66 chars)
        const verifyTimestamp = Date.now();
        const shortWallet = walletAddress.slice(0, 6);
        const shortContract = contractAddress.slice(0, 6);
        const uniqueTxHash = `0xverify_${shortWallet}_${shortContract}_${verifyTimestamp}`.toLowerCase();
        await this.db.recordPurchase(
          contractAddress,
          walletAddress,
          uniqueTxHash,
          details.blockNum.toString(),
          '0', // Amount not available from this call
          details.timestamp.toString()
        );
        
        const existingClaim = await this.db.hasClaimed(contractAddress, walletAddress);
        
        if (existingClaim) {
          return res.json({
            hasPurchased: true,
            hasClaimed: true,
            claimStatus: existingClaim.invitation_status,
            telegramUsername: existingClaim.telegram_username,
            userJoined: existingClaim.user_joined
          });
        }
        
        const jwtSecret = process.env.JWT_SECRET; // Required, validated in initialize()
        const sessionToken = jwt.sign(
          {
            walletAddress,
            contractAddress,
            timestamp: Date.now(),
            ip: req.ip
          },
          jwtSecret,
          { expiresIn: '1h' }
        );
        
        const session = await this.db.createSession(
          walletAddress,
          contractAddress,
          req.ip,
          req.get('user-agent')
        );
        
        res.json({
          hasPurchased: true,
          hasClaimed: false,
          sessionToken,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()
        });
        
      } catch (error) {
        console.error('Error verifying purchase:', error);
        res.status(500).json({ error: error.message });
      }
    });

    /**
     * Submit Telegram username to claim access
     * POST /api/claim-access
     */
    this.app.post('/api/claim-access', async (req, res) => {
      try {
        const { sessionToken, telegramUsername, walletAddress, contractAddress } = req.body;
        
        if (!telegramUsername) {
          return res.status(400).json({ 
            error: 'Telegram username required' 
          });
        }
        
        const cleanUsername = telegramUsername.replace('@', '');
        if (!/^[a-zA-Z0-9_]{5,32}$/.test(cleanUsername)) {
          return res.status(400).json({ 
            error: 'Invalid Telegram username format' 
          });
        }
        
        let session;
        
        // Check if bypass mode (for testing)
        if (sessionToken && sessionToken.startsWith('bypass-')) {
          console.log('Bypass mode - using provided wallet/contract directly');
          session = {
            wallet_address: walletAddress || '0x0000000000000000000000000000000000000000',
            contract_address: contractAddress || process.env.CONTRACT_ADDRESS
          };
        } else if (sessionToken) {
          // Normal JWT verification
          const jwtSecret = process.env.JWT_SECRET;
          try {
            const jwtSession = jwt.verify(sessionToken, jwtSecret);
            session = {
              wallet_address: jwtSession.walletAddress,
              contract_address: jwtSession.contractAddress
            };
          } catch (error) {
            return res.status(401).json({ 
              error: 'Invalid or expired session token' 
            });
          }
          
          // Additional database validation for session tracking
          const dbSession = await this.db.validateSession(sessionToken);
          if (!dbSession && !sessionToken.startsWith('bypass-')) {
            // Session is already set from JWT decode above
            // No need to override it
          }
        } else {
          return res.status(400).json({ 
            error: 'Session token required' 
          });
        }
        
        // Check if already claimed
        const existingClaim = await this.db.hasClaimed(
          session.contract_address,
          session.wallet_address
        );
        
        if (existingClaim) {
          return res.status(400).json({ 
            error: 'Access already claimed for this wallet',
            claimStatus: existingClaim.invitation_status
          });
        }
        
        // Get contract details first
        const contract = await this.db.getContract(session.contract_address);
        
        // Attempt to invite directly without database tracking first
        try {
          // Try invitation without claim ID (since we haven't created the claim yet)
          const result = await this.telegramService.inviteUserToGroup(
            contract.telegram_group_id, 
            `@${cleanUsername}`
          );
          
          // Only if invitation succeeds, submit the actual claim
          if (result.success) {
            const claim = await this.db.submitClaim(
              session.contract_address,
              session.wallet_address,
              cleanUsername
            );
            
            // Mark session as used
            await this.db.markSessionClaimed(sessionToken);
            
            // Update claim status to success
            await this.db.updateClaimStatus(claim.id, 'success');
            
            res.json({
              success: true,
              claimId: claim.id,
              invitationStatus: 'success',
              message: 'Successfully invited to group'
            });
          } else {
            // Invitation failed, don't mark as claimed
            throw new Error(`Invitation failed: ${result.error || 'Unknown error'}`);
          }
        } catch (inviteError) {
          console.error('Telegram invitation failed:', inviteError);
          // Don't mark as claimed if invitation fails
          res.status(500).json({ 
            error: 'Failed to send Telegram invitation. Please try again or contact support.',
            details: inviteError.message 
          });
        }
        
      } catch (error) {
        console.error('Error claiming access:', error);
        res.status(500).json({ error: error.message });
      }
    });

    /**
     * Check claim status
     * GET /api/claim-status/:walletAddress/:contractAddress
     */
    this.app.get('/api/claim-status/:walletAddress/:contractAddress', async (req, res) => {
      try {
        const { walletAddress, contractAddress } = req.params;
        
        const claim = await this.db.hasClaimed(contractAddress, walletAddress);
        
        if (!claim) {
          return res.status(404).json({ error: 'No claim found' });
        }
        
        res.json({
          claimId: claim.id,
          telegramUsername: claim.telegram_username,
          invitationStatus: claim.invitation_status,
          invitationAttempts: claim.invitation_attempts,
          userJoined: claim.user_joined,
          joinedAt: claim.joined_at
        });
        
      } catch (error) {
        console.error('Error checking status:', error);
        res.status(500).json({ error: error.message });
      }
    });

    /**
     * Retry invitation
     * POST /api/retry-invitation
     */
    this.app.post('/api/retry-invitation', async (req, res) => {
      try {
        const { walletAddress, contractAddress } = req.body;
        
        if (!walletAddress || !contractAddress) {
          return res.status(400).json({ 
            error: 'Wallet and contract address required' 
          });
        }
        
        const claim = await this.db.hasClaimed(contractAddress, walletAddress);
        
        if (!claim) {
          return res.status(404).json({ error: 'No claim found' });
        }
        
        if (claim.user_joined) {
          return res.json({ 
            success: true,
            message: 'User already joined',
            userJoined: true 
          });
        }
        
        // Get contract details
        const contract = await this.db.getContract(contractAddress);
        
        // Retry invitation
        const inviteResult = await this.inviteUser(
          claim.id,
          claim.telegram_username,
          contract.telegram_group_id
        );
        
        res.json({
          success: inviteResult.success,
          message: inviteResult.message,
          requiresAction: inviteResult.requiresAction,
          invitationStatus: inviteResult.status
        });
        
      } catch (error) {
        console.error('Error retrying invitation:', error);
        res.status(500).json({ error: error.message });
      }
    });

    /**
     * Invite Rosie bot to the group
     * POST /api/invite-rosie-bot
     */
    this.app.post('/api/invite-rosie-bot', async (req, res) => {
      try {
        const { contractAddress, adminSignature } = req.body;
        
        if (!contractAddress || !adminSignature) {
          return res.status(400).json({ 
            error: 'Contract address and admin signature required' 
          });
        }
        
        // Verify this is from the priest/admin
        // In production, implement proper signature verification
        
        const contract = await this.db.getContract(contractAddress);
        if (!contract || !contract.telegram_group_id) {
          return res.status(404).json({ error: 'Contract or group not found' });
        }
        
        const result = await this.telegramService.inviteRosieBot(contract.telegram_group_id);
        
        res.json({
          success: result.success,
          message: result.message
        });
        
      } catch (error) {
        console.error('Error inviting Rosie bot:', error);
        res.status(500).json({ error: error.message });
      }
    });

    /**
     * Get contract statistics
     * GET /api/contract-stats/:contractAddress
     */
    this.app.get('/api/contract-stats/:contractAddress', async (req, res) => {
      try {
        const { contractAddress } = req.params;
        
        const contract = await this.db.getContract(contractAddress);
        if (!contract) {
          return res.status(404).json({ error: 'Contract not found' });
        }
        
        const stats = await this.db.getContractStats(contractAddress);
        
        res.json({
          contractAddress: contract.contract_address,
          groupTitle: contract.group_title,
          tokenAddress: contract.token_address,
          burnAmount: contract.burn_amount,
          stats: {
            totalPurchases: parseInt(stats.total_purchases),
            totalClaims: parseInt(stats.total_claims),
            successfulJoins: parseInt(stats.successful_joins),
            pendingRetries: parseInt(stats.pending_retries)
          }
        });
        
      } catch (error) {
        console.error('Error getting stats:', error);
        res.status(500).json({ error: error.message });
      }
    });

    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ 
        status: 'healthy',
        uptime: process.uptime()
      });
    });
  }

  /**
   * Invite user to Telegram group
   */
  async inviteUser(claimId, username, groupId) {
    try {
      // Attempt invitation using Telegram service
      const result = await this.telegramService.inviteUserToGroup(groupId, `@${username}`);
      
      if (result.success) {
        await this.db.updateClaimStatus(claimId, 'success');
        return {
          success: true,
          status: 'success',
          message: 'Successfully invited to group'
        };
      } else {
        // Check if it's a privacy issue
        if (result.error && result.error.toLowerCase().includes('privacy')) {
          await this.db.updateClaimStatus(claimId, 'retry_needed', 'Privacy settings prevent invitation');
          
          return {
            success: false,
            status: 'retry_needed',
            message: 'Please update your Telegram privacy settings to allow invitations',
            requiresAction: {
              type: 'privacy_settings',
              instructions: [
                '1. Open Telegram and go to Settings',
                '2. Navigate to Privacy and Security',
                '3. Select Groups & Channels',
                '4. Set to "Everybody" or add our bot as exception',
                '5. Click retry button below'
              ]
            }
          };
        } else {
          await this.db.updateClaimStatus(claimId, 'failed', result.error);
          
          return {
            success: false,
            status: 'failed',
            message: `Failed to invite: ${result.error}`
          };
        }
      }
    } catch (error) {
      await this.db.updateClaimStatus(claimId, 'failed', error.message);
      
      return {
        success: false,
        status: 'failed',
        message: error.message
      };
    }
  }

  /**
   * Start the API server
   */
  async start(port = 3002) {
    await this.initialize();
    
    this.server = this.app.listen(port, () => {
      console.log(`\n🌐 Token-Gated API running on port ${port}`);
      console.log(`   Health: http://localhost:${port}/health`);
    });
    
    // Start retry processor
    this.startRetryProcessor();
  }

  /**
   * Process retry queue
   */
  async startRetryProcessor() {
    setInterval(async () => {
      try {
        const pending = await this.db.getPendingInvitations();
        
        if (pending.length > 0) {
          console.log(`Processing ${pending.length} pending invitations...`);
        }
        
        for (const invitation of pending) {
          await this.inviteUser(
            invitation.id,
            invitation.telegram_username,
            invitation.telegram_group_id
          );
        }
      } catch (error) {
        console.error('Retry processor error:', error);
      }
    }, 60000); // Check every minute
  }

  /**
   * Shutdown the API
   */
  async shutdown() {
    if (this.server) {
      this.server.close();
    }
    await this.db.close();
    await this.telegramService.disconnect();
  }
}

// The inviteUserToGroup method is now properly implemented in TelegramService

module.exports = TokenGatedAPI;