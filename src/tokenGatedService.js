
const BlockchainMonitor = require('./blockchain/monitor');
const TokenGatedAPI = require('./api/tokenGatedAPI');
require('dotenv').config();

class TokenGatedService {
  constructor() {
    this.monitor = new BlockchainMonitor();
    this.api = new TokenGatedAPI();
  }

  async start() {
    try {
      console.log('========================================');
      console.log('Starting Token Gated Service (SECURE)');
      console.log('========================================');
      
      this.validateEnvironment();
      
      console.log('\n📋 Configuration:');
      console.log('- Contract:', process.env.CONTRACT_ADDRESS);
      console.log('- Priest:', process.env.PRIEST_ADDRESS);
      console.log('- Entry Fee:', process.env.ENTRY_FEE || '420');
      console.log('  • Treasury: 50%');
      console.log('  • Burned: 50%');
      console.log('- Group ID:', process.env.TELEGRAM_GROUP_ID);
      console.log('- API Port:', process.env.API_PORT || 3002);
      
      console.log('\n🚀 Initializing components...');
      
      await this.monitor.initialize();
      await this.api.initialize();
      await this.monitor.startMonitoring();
      const port = process.env.API_PORT || 3002;
      this.api.app.listen(port, () => {
        console.log(`\n✅ API server running on port ${port}`);
        console.log(`📌 Health check: http://localhost:${port}/health`);
        console.log(`📌 Claim page: ${process.env.FRONTEND_URL}/claim.html`);
      });
      
      this.setupGracefulShutdown();
      
      console.log('\n========================================');
      console.log('✅ Token Gated Service is running');
      console.log('========================================');
      console.log('\n🔒 Security Features Active:');
      console.log('  ✅ JWT authentication required');
      console.log('  ✅ Nonce-based signature verification');
      console.log('  ✅ Strict CORS policy enforced');
      console.log('  ✅ Rate limiting enabled');
      console.log('  ✅ Treasury management active');
      console.log('  ✅ SQL injection protection');
      console.log('  ✅ Payment verification enforced');
      
      console.log('\n💰 Treasury Management:');
      console.log(`  • Priest: ${process.env.PRIEST_ADDRESS}`);
      console.log('  • 50% of fees go to treasury');
      console.log('  • 50% of fees are burned');
      console.log('  • Only priest can withdraw funds');
      
      console.log('\n📊 Monitoring:');
      console.log('  • Purchase events');
      console.log('  • Treasury deposits');
      console.log('  • Treasury withdrawals');
      console.log('  • Balance verification');
      
    } catch (error) {
      console.error('❌ Failed to start service:', error);
      process.exit(1);
    }
  }
  
  validateEnvironment() {
    const required = [
      'CONTRACT_ADDRESS',
      'PRIEST_ADDRESS',
      'TOKEN_ADDRESS',
      'TELEGRAM_GROUP_ID',
      'RPC_URL',
      'JWT_SECRET',
      'FRONTEND_URL',
      'DB_HOST',
      'DB_NAME',
      'DB_USER',
      'DB_PASSWORD',
      'API_ID',
      'API_HASH',
      'PHONE_NUMBER'
    ];
    
    const missing = required.filter(key => !process.env[key]);
    
    if (missing.length > 0) {
      console.error('❌ Missing required environment variables:');
      missing.forEach(key => console.error(`  - ${key}`));
      throw new Error('Missing required environment variables');
    }
    
    if (process.env.JWT_SECRET === 'change-this-secret-in-production') {
      throw new Error('FATAL: JWT_SECRET must be changed from default value');
    }
    
    if (process.env.RPC_URL.includes('YOUR_KEY')) {
      throw new Error('FATAL: RPC_URL must be configured with a valid API key');
    }
    
    if (process.env.FRONTEND_URL === '*') {
      throw new Error('FATAL: FRONTEND_URL must be set to specific origins, not wildcard');
    }
    
    const entryFee = parseInt(process.env.ENTRY_FEE || '420');
    if (entryFee % 2 !== 0) {
      throw new Error('FATAL: ENTRY_FEE must be an even number for 50/50 treasury/burn split');
    }
    
    console.log('✅ Environment validation passed');
  }
  
  setupGracefulShutdown() {
    const shutdown = async (signal) => {
      console.log(`\n⚠️  Received ${signal}, shutting down gracefully...`);
      
      try {
        await this.monitor.stop();
        
        if (this.api.db) {
          await this.api.db.close();
        }
        
        console.log('✅ Graceful shutdown complete');
        process.exit(0);
      } catch (error) {
        console.error('❌ Error during shutdown:', error);
        process.exit(1);
      }
    };
    
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('uncaughtException', (error) => {
      console.error('❌ Uncaught Exception:', error);
      shutdown('uncaughtException');
    });
    
    process.on('unhandledRejection', (reason, promise) => {
      console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
      shutdown('unhandledRejection');
    });
  }
}

// Start the service
if (require.main === module) {
  const service = new TokenGatedService();
  service.start();
}

module.exports = TokenGatedService;