const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

/**
 * Database connection and helper functions
 */
class Database {
  constructor() {
    this.pool = new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      database: process.env.DB_NAME || 'telegram_access',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
      query_timeout: 10000,
      statement_timeout: 10000,
    });
    
    // Handle pool errors
    this.pool.on('error', (err) => {
      console.error('Unexpected database pool error:', err);
    });
    
    // Handle connection errors
    this.pool.on('connect', () => {
      console.log('Database pool: new client connected');
    });
  }

  /**
   * Initialize database schema
   */
  async initialize() {
    try {
      // Read and execute schema
      const schemaPath = path.join(__dirname, 'schema.sql');
      const schema = fs.readFileSync(schemaPath, 'utf8');
      
      // Split by semicolon and execute each statement
      const statements = schema.split(';').filter(s => s.trim());
      
      for (const statement of statements) {
        if (statement.trim()) {
          await this.pool.query(statement);
        }
      }
      
      console.log('✅ Database schema initialized');
    } catch (error) {
      console.error('Failed to initialize database:', error);
      throw error;
    }
  }

  /**
   * Register a contract for monitoring
   */
  async registerContract(contractAddress, chainId, tokenAddress, burnAmount, groupId, groupTitle) {
    const query = `
      INSERT INTO contracts (
        contract_address, chain_id, token_address, 
        burn_amount, telegram_group_id, group_title
      ) VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (contract_address) 
      DO UPDATE SET 
        telegram_group_id = EXCLUDED.telegram_group_id,
        group_title = EXCLUDED.group_title,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;
    
    const result = await this.pool.query(query, [
      contractAddress.toLowerCase(),
      chainId,
      tokenAddress.toLowerCase(),
      burnAmount,
      groupId,
      groupTitle
    ]);
    
    return result.rows[0];
  }

  /**
   * Record a token purchase
   */
  async recordPurchase(contractAddress, walletAddress, txHash, blockNumber, amount, timestamp) {
    const query = `
      INSERT INTO purchases (
        contract_address, wallet_address, tx_hash, 
        block_number, amount, purchase_timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (contract_address, wallet_address) DO NOTHING
      RETURNING *
    `;
    
    const result = await this.pool.query(query, [
      contractAddress.toLowerCase(),
      walletAddress.toLowerCase(),
      txHash.toLowerCase(),
      blockNumber,
      amount,
      new Date(timestamp * 1000)
    ]);
    
    return result.rows[0];
  }

  /**
   * Check if wallet has purchased access
   */
  async hasPurchased(contractAddress, walletAddress) {
    const query = `
      SELECT * FROM purchases 
      WHERE contract_address = $1 AND wallet_address = $2
    `;
    
    const result = await this.pool.query(query, [
      contractAddress.toLowerCase(),
      walletAddress.toLowerCase()
    ]);
    
    return result.rows.length > 0 ? result.rows[0] : null;
  }

  /**
   * Check if wallet has already claimed access
   */
  async hasClaimed(contractAddress, walletAddress) {
    const query = `
      SELECT * FROM access_claims 
      WHERE contract_address = $1 AND wallet_address = $2
    `;
    
    const result = await this.pool.query(query, [
      contractAddress.toLowerCase(),
      walletAddress.toLowerCase()
    ]);
    
    return result.rows.length > 0 ? result.rows[0] : null;
  }

  /**
   * Submit access claim with Telegram username
   */
  async submitClaim(contractAddress, walletAddress, telegramUsername) {
    // First verify purchase exists
    const purchase = await this.hasPurchased(contractAddress, walletAddress);
    if (!purchase) {
      throw new Error('No purchase found for this wallet');
    }
    
    // Check if already claimed
    const existingClaim = await this.hasClaimed(contractAddress, walletAddress);
    if (existingClaim) {
      throw new Error('Access already claimed for this wallet');
    }
    
    const query = `
      INSERT INTO access_claims (
        contract_address, wallet_address, telegram_username
      ) VALUES ($1, $2, $3)
      RETURNING *
    `;
    
    const result = await this.pool.query(query, [
      contractAddress.toLowerCase(),
      walletAddress.toLowerCase(),
      telegramUsername
    ]);
    
    return result.rows[0];
  }

  /**
   * Update claim status after invitation attempt
   */
  async updateClaimStatus(claimId, status, error = null) {
    const query = `
      UPDATE access_claims 
      SET 
        invitation_status = $2,
        invitation_attempts = invitation_attempts + 1,
        last_invitation_attempt = CURRENT_TIMESTAMP,
        invitation_error = $3
      WHERE id = $1
      RETURNING *
    `;
    
    const result = await this.pool.query(query, [claimId, status, error]);
    
    // Log the attempt
    await this.pool.query(
      `INSERT INTO invitation_logs (claim_id, attempt_number, status, error_message)
       VALUES ($1, $2, $3, $4)`,
      [claimId, result.rows[0]?.invitation_attempts || 1, status, error]
    );
    
    return result.rows[0];
  }

  /**
   * Mark user as joined
   */
  async markUserJoined(contractAddress, walletAddress) {
    const query = `
      UPDATE access_claims 
      SET 
        user_joined = true,
        joined_at = CURRENT_TIMESTAMP,
        invitation_status = 'success'
      WHERE contract_address = $1 AND wallet_address = $2
      RETURNING *
    `;
    
    const result = await this.pool.query(query, [
      contractAddress.toLowerCase(),
      walletAddress.toLowerCase()
    ]);
    
    return result.rows[0];
  }

  /**
   * Get pending invitations
   */
  async getPendingInvitations() {
    const query = `
      SELECT * FROM pending_invitations
      WHERE last_invitation_attempt IS NULL 
         OR last_invitation_attempt < NOW() - INTERVAL '1 minute'
    `;
    
    const result = await this.pool.query(query);
    return result.rows;
  }

  /**
   * Create a claim session
   */
  async createSession(walletAddress, contractAddress, ipAddress, userAgent) {
    const sessionToken = require('crypto').randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 3600000); // 1 hour
    
    const query = `
      INSERT INTO claim_sessions (
        session_token, wallet_address, contract_address, 
        ip_address, user_agent, expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;
    
    const result = await this.pool.query(query, [
      sessionToken,
      walletAddress.toLowerCase(),
      contractAddress.toLowerCase(),
      ipAddress,
      userAgent,
      expiresAt
    ]);
    
    return result.rows[0];
  }

  /**
   * Validate session
   */
  async validateSession(sessionToken) {
    const query = `
      SELECT * FROM claim_sessions 
      WHERE session_token = $1 
        AND expires_at > NOW() 
        AND claimed = false
    `;
    
    const result = await this.pool.query(query, [sessionToken]);
    return result.rows[0];
  }

  /**
   * Mark session as claimed
   */
  async markSessionClaimed(sessionToken) {
    const query = `
      UPDATE claim_sessions 
      SET claimed = true 
      WHERE session_token = $1
      RETURNING *
    `;
    
    const result = await this.pool.query(query, [sessionToken]);
    return result.rows[0];
  }

  /**
   * Get contract details
   */
  async getContract(contractAddress) {
    const query = `SELECT * FROM contracts WHERE contract_address = $1`;
    const result = await this.pool.query(query, [contractAddress.toLowerCase()]);
    return result.rows[0];
  }

  /**
   * Get statistics for a contract
   */
  async getContractStats(contractAddress) {
    const stats = await this.pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM purchases WHERE contract_address = $1) as total_purchases,
        (SELECT COUNT(*) FROM access_claims WHERE contract_address = $1) as total_claims,
        (SELECT COUNT(*) FROM access_claims WHERE contract_address = $1 AND user_joined = true) as successful_joins,
        (SELECT COUNT(*) FROM access_claims WHERE contract_address = $1 AND invitation_status = 'retry_needed') as pending_retries
    `, [contractAddress.toLowerCase()]);
    
    return stats.rows[0];
  }

  /**
   * Close database connection
   */
  async close() {
    await this.pool.end();
  }
}

module.exports = Database;