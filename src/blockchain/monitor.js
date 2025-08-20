const { ethers } = require('ethers');
const Database = require('../database/db');
const fs = require('fs').promises;
require('dotenv').config();

/**
 * Blockchain Monitor - SECURE VERSION
 * Monitors TelegramGroupAccess contract for AccessPurchased events
 * Tracks both treasury deposits and token burns
 * Validates priest address and treasury balance
 */
class BlockchainMonitor {
  constructor() {
    this.provider = null;
    this.contract = null;
    this.db = new Database();
    this.processedBlocks = 0;
    this.lastProcessedBlock = null;
    this.stateFile = '.monitor-state.json';
    this.priestAddress = null;
    this.treasuryBalance = 0n;
  }

  async initialize() {
    try {
      // Validate critical environment variables
      if (!process.env.RPC_URL || process.env.RPC_URL.includes('YOUR_KEY')) {
        throw new Error('FATAL: Valid RPC_URL environment variable is required');
      }
      
      if (!process.env.CONTRACT_ADDRESS) {
        throw new Error('FATAL: CONTRACT_ADDRESS environment variable is required');
      }
      
      if (!process.env.PRIEST_ADDRESS) {
        throw new Error('FATAL: PRIEST_ADDRESS environment variable is required for monitoring');
      }
      
      // Initialize database
      await this.db.initialize();
      
      // Load saved state
      await this.loadState();
      
      // Load configuration
      const RPC_URL = process.env.RPC_URL;
      const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
      this.priestAddress = process.env.PRIEST_ADDRESS.toLowerCase();
      
      // Register contract in database
      await this.db.registerContract(
        CONTRACT_ADDRESS,
        process.env.CHAIN_ID || 1,
        process.env.TOKEN_ADDRESS,
        process.env.ENTRY_FEE || '420',
        process.env.TELEGRAM_GROUP_ID,
        process.env.GROUP_TITLE || 'Premium Group'
      );

      // Connect to blockchain
      this.provider = new ethers.JsonRpcProvider(RPC_URL);
      
      // Contract ABI with treasury management
      const abi = [
        {
          "anonymous": false,
          "inputs": [
            {"indexed": true, "internalType": "address", "name": "purchaser", "type": "address"},
            {"indexed": false, "internalType": "uint256", "name": "totalAmount", "type": "uint256"},
            {"indexed": false, "internalType": "uint256", "name": "burnedAmount", "type": "uint256"},
            {"indexed": false, "internalType": "uint256", "name": "treasuryAmount", "type": "uint256"},
            {"indexed": false, "internalType": "uint256", "name": "timestamp", "type": "uint256"},
            {"indexed": false, "internalType": "uint256", "name": "blockNumber", "type": "uint256"}
          ],
          "name": "AccessPurchased",
          "type": "event"
        },
        {
          "anonymous": false,
          "inputs": [
            {"indexed": true, "internalType": "address", "name": "priest", "type": "address"},
            {"indexed": true, "internalType": "address", "name": "recipient", "type": "address"},
            {"indexed": false, "internalType": "uint256", "name": "amount", "type": "uint256"},
            {"indexed": false, "internalType": "uint256", "name": "timestamp", "type": "uint256"}
          ],
          "name": "TreasuryWithdrawn",
          "type": "event"
        },
        {
          "inputs": [],
          "name": "priest",
          "outputs": [{"internalType": "address", "name": "", "type": "address"}],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "getTreasuryInfo",
          "outputs": [
            {"internalType": "uint256", "name": "balance", "type": "uint256"},
            {"internalType": "uint256", "name": "totalReceived", "type": "uint256"},
            {"internalType": "uint256", "name": "totalBurnedAmount", "type": "uint256"},
            {"internalType": "address", "name": "priestAddress", "type": "address"}
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [],
          "name": "getConfig",
          "outputs": [
            {"internalType": "address", "name": "token", "type": "address"},
            {"internalType": "uint256", "name": "fee", "type": "uint256"},
            {"internalType": "bool", "name": "isPaused", "type": "bool"},
            {"internalType": "uint256", "name": "purchases", "type": "uint256"},
            {"internalType": "uint256", "name": "treasury", "type": "uint256"}
          ],
          "stateMutability": "view",
          "type": "function"
        }
      ];

      this.contract = new ethers.Contract(CONTRACT_ADDRESS, abi, this.provider);
      
      // Verify priest address matches
      const onChainPriest = await this.contract.priest();
      if (onChainPriest.toLowerCase() !== this.priestAddress) {
        throw new Error(`CRITICAL: Priest address mismatch! Contract: ${onChainPriest}, Expected: ${this.priestAddress}`);
      }
      
      // Get initial treasury info
      const treasuryInfo = await this.contract.getTreasuryInfo();
      this.treasuryBalance = treasuryInfo[0];
      
      console.log('✅ Blockchain Monitor (SECURE) initialized');
      console.log('Contract:', CONTRACT_ADDRESS);
      console.log('Network:', (await this.provider.getNetwork()).name);
      console.log('Priest Address:', this.priestAddress);
      console.log('Current Treasury Balance:', ethers.formatEther(this.treasuryBalance), 'tokens');
      
    } catch (error) {
      console.error('Failed to initialize monitor:', error);
      throw error;
    }
  }

  async startMonitoring() {
    console.log('🔍 Starting secure blockchain monitoring...');
    
    // Use polling instead of WebSocket filters for public RPC compatibility
    console.log('📡 Using polling mode for event monitoring (public RPC compatible)');
    
    // Process past events first
    await this.processPastEvents();

    // Start periodic polling for new events (every 30 seconds)
    this.startEventPolling();
    
    // Start periodic checks
    this.startPeriodicCheck();
    
    // Start treasury monitoring
    this.startTreasuryMonitoring();

    console.log('✅ Secure monitoring active');
    console.log('📊 Monitoring: Purchases, Treasury deposits, Treasury withdrawals');
  }
  
  async startEventPolling() {
    // Poll for new events every 30 seconds
    setInterval(async () => {
      try {
        await this.processPastEvents();
      } catch (error) {
        console.error('Error polling for events:', error.message);
      }
    }, 30000); // 30 seconds
  }

  async handlePurchase(purchaser, totalAmount, burnedAmount, treasuryAmount, timestamp, blockNumber, event) {
    try {
      const txHash = event.log.transactionHash;
      const contractAddress = event.log.address.toLowerCase();
      
      console.log('\n💰 New Purchase Detected!');
      console.log('Purchaser:', purchaser);
      console.log('Total Amount:', ethers.formatEther(totalAmount));
      console.log('  - Burned:', ethers.formatEther(burnedAmount));
      console.log('  - To Treasury:', ethers.formatEther(treasuryAmount));
      console.log('Block:', blockNumber.toString());
      console.log('Tx Hash:', txHash);
      
      // Verify the split is correct (50/50)
      if (burnedAmount !== treasuryAmount) {
        console.error('⚠️  WARNING: Burn/Treasury split is not 50/50!');
      }
      
      // Record purchase in database
      const purchase = await this.db.recordPurchase(
        contractAddress,
        purchaser.toLowerCase(),
        txHash,
        blockNumber.toString(),
        totalAmount.toString(),
        timestamp.toString()
      );
      
      if (purchase) {
        console.log('✅ Purchase recorded in database');
        
        // Update treasury balance tracking
        this.treasuryBalance = this.treasuryBalance + treasuryAmount;
        console.log('💰 New Treasury Balance:', ethers.formatEther(this.treasuryBalance));
      } else {
        console.log('ℹ️  Purchase already recorded (duplicate)');
      }
      
      // Save state after processing
      await this.saveState();
      
    } catch (error) {
      console.error('Error handling purchase:', error);
    }
  }
  
  async handleTreasuryWithdrawal(priest, recipient, amount, timestamp, event) {
    try {
      const txHash = event.log.transactionHash;
      
      console.log('\n🏦 Treasury Withdrawal Detected!');
      console.log('Priest:', priest);
      console.log('Recipient:', recipient);
      console.log('Amount:', ethers.formatEther(amount));
      console.log('Timestamp:', new Date(Number(timestamp) * 1000).toISOString());
      console.log('Tx Hash:', txHash);
      
      // Verify it's the authorized priest
      if (priest.toLowerCase() !== this.priestAddress) {
        console.error('⚠️  CRITICAL: Unauthorized treasury withdrawal by:', priest);
        // In production, this should trigger alerts
      }
      
      // Update treasury balance tracking
      this.treasuryBalance = this.treasuryBalance - amount;
      console.log('💰 New Treasury Balance:', ethers.formatEther(this.treasuryBalance));
      
      // Log this important event
      // In production, you might want to send notifications
      
    } catch (error) {
      console.error('Error handling treasury withdrawal:', error);
    }
  }

  async processPastEvents() {
    try {
      const currentBlock = await this.provider.getBlockNumber();
      
      // Determine starting block
      let fromBlock;
      if (this.lastProcessedBlock) {
        fromBlock = this.lastProcessedBlock + 1;
        console.log(`Resuming from block ${fromBlock}`);
      } else {
        // Look back up to 1000 blocks
        fromBlock = Math.max(0, currentBlock - 1000);
        console.log(`Processing past events from block ${fromBlock}`);
      }
      
      if (fromBlock >= currentBlock) {
        console.log('Already up to date');
        return;
      }
      
      // Get past purchase events
      const purchaseFilter = this.contract.filters.AccessPurchased();
      const purchaseEvents = await this.contract.queryFilter(purchaseFilter, fromBlock, currentBlock);
      
      console.log(`Found ${purchaseEvents.length} past purchase events`);
      
      for (const event of purchaseEvents) {
        const [purchaser, totalAmount, burnedAmount, treasuryAmount, timestamp, blockNumber] = event.args;
        await this.handlePurchase(purchaser, totalAmount, burnedAmount, treasuryAmount, timestamp, blockNumber, { log: event });
      }
      
      // Get past withdrawal events
      const withdrawalFilter = this.contract.filters.TreasuryWithdrawn();
      const withdrawalEvents = await this.contract.queryFilter(withdrawalFilter, fromBlock, currentBlock);
      
      console.log(`Found ${withdrawalEvents.length} past withdrawal events`);
      
      for (const event of withdrawalEvents) {
        const [priest, recipient, amount, timestamp] = event.args;
        await this.handleTreasuryWithdrawal(priest, recipient, amount, timestamp, { log: event });
      }
      
      // Update last processed block
      this.lastProcessedBlock = currentBlock;
      await this.saveState();
      
    } catch (error) {
      console.error('Error processing past events:', error);
    }
  }

  startPeriodicCheck() {
    // Check for missed events every 5 minutes
    setInterval(async () => {
      console.log('🔄 Running periodic check...');
      await this.processPastEvents();
      
      // Verify treasury balance matches on-chain
      const treasuryInfo = await this.contract.getTreasuryInfo();
      const onChainBalance = treasuryInfo[0];
      
      if (onChainBalance !== this.treasuryBalance) {
        console.error('⚠️  Treasury balance mismatch!');
        console.error('Local:', ethers.formatEther(this.treasuryBalance));
        console.error('On-chain:', ethers.formatEther(onChainBalance));
        // Sync with on-chain value
        this.treasuryBalance = onChainBalance;
      }
    }, 5 * 60 * 1000);
  }
  
  startTreasuryMonitoring() {
    // Monitor treasury balance every hour
    setInterval(async () => {
      try {
        const treasuryInfo = await this.contract.getTreasuryInfo();
        const config = await this.contract.getConfig();
        
        console.log('\n📊 Treasury Status Report');
        console.log('========================');
        console.log('Current Balance:', ethers.formatEther(treasuryInfo[0]), 'tokens');
        console.log('Total Received:', ethers.formatEther(treasuryInfo[1]), 'tokens');
        console.log('Total Burned:', ethers.formatEther(treasuryInfo[2]), 'tokens');
        console.log('Total Purchases:', config[3].toString());
        console.log('Contract Paused:', config[2]);
        console.log('Priest Address:', treasuryInfo[3]);
        console.log('========================\n');
        
      } catch (error) {
        console.error('Error checking treasury status:', error);
      }
    }, 60 * 60 * 1000); // Every hour
  }

  async loadState() {
    try {
      const stateData = await fs.readFile(this.stateFile, 'utf8');
      const state = JSON.parse(stateData);
      this.lastProcessedBlock = state.lastProcessedBlock;
      console.log('Loaded state: Last processed block', this.lastProcessedBlock);
    } catch (error) {
      console.log('No previous state found, starting fresh');
    }
  }

  async saveState() {
    try {
      const state = {
        lastProcessedBlock: this.lastProcessedBlock,
        savedAt: new Date().toISOString(),
        treasuryBalance: this.treasuryBalance.toString()
      };
      await fs.writeFile(this.stateFile, JSON.stringify(state, null, 2));
    } catch (error) {
      console.error('Failed to save state:', error);
    }
  }

  async stop() {
    console.log('Stopping monitor...');
    // No listeners to remove in polling mode
    await this.db.close();
    console.log('Monitor stopped');
  }
}

module.exports = BlockchainMonitor;