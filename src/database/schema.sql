-- Database schema for token-gated Telegram access

-- Contracts we're monitoring
CREATE TABLE IF NOT EXISTS contracts (
    id SERIAL PRIMARY KEY,
    contract_address VARCHAR(42) UNIQUE NOT NULL,
    chain_id INTEGER NOT NULL,
    token_address VARCHAR(42) NOT NULL,
    burn_amount VARCHAR(100) NOT NULL,
    telegram_group_id VARCHAR(100) NOT NULL,
    group_title VARCHAR(255),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Track token purchases on-chain
CREATE TABLE IF NOT EXISTS purchases (
    id SERIAL PRIMARY KEY,
    contract_address VARCHAR(42) NOT NULL,
    wallet_address VARCHAR(42) NOT NULL,
    tx_hash VARCHAR(66) UNIQUE NOT NULL,
    block_number BIGINT NOT NULL,
    amount VARCHAR(100) NOT NULL,
    purchase_timestamp TIMESTAMP NOT NULL,
    detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(contract_address, wallet_address),
    FOREIGN KEY (contract_address) REFERENCES contracts(contract_address)
);

-- Track access claims (username submissions)
CREATE TABLE IF NOT EXISTS access_claims (
    id SERIAL PRIMARY KEY,
    contract_address VARCHAR(42) NOT NULL,
    wallet_address VARCHAR(42) NOT NULL,
    telegram_username VARCHAR(100) NOT NULL,
    telegram_user_id VARCHAR(100),
    claim_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    invitation_status VARCHAR(50) DEFAULT 'pending', -- pending, inviting, success, failed, retry_needed
    invitation_attempts INTEGER DEFAULT 0,
    last_invitation_attempt TIMESTAMP,
    invitation_error TEXT,
    user_joined BOOLEAN DEFAULT false,
    joined_at TIMESTAMP,
    UNIQUE(contract_address, wallet_address),
    FOREIGN KEY (contract_address) REFERENCES contracts(contract_address)
);

-- Track invitation attempts for audit
CREATE TABLE IF NOT EXISTS invitation_logs (
    id SERIAL PRIMARY KEY,
    claim_id INTEGER NOT NULL,
    attempt_number INTEGER NOT NULL,
    status VARCHAR(50) NOT NULL,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (claim_id) REFERENCES access_claims(id)
);

-- Session tracking for web interface
CREATE TABLE IF NOT EXISTS claim_sessions (
    id SERIAL PRIMARY KEY,
    session_token VARCHAR(255) UNIQUE NOT NULL,
    wallet_address VARCHAR(42) NOT NULL,
    contract_address VARCHAR(42) NOT NULL,
    ip_address VARCHAR(45),
    user_agent TEXT,
    expires_at TIMESTAMP NOT NULL,
    claimed BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_purchases_wallet ON purchases(wallet_address);
CREATE INDEX IF NOT EXISTS idx_purchases_contract ON purchases(contract_address);
CREATE INDEX IF NOT EXISTS idx_purchases_block ON purchases(block_number);
CREATE INDEX IF NOT EXISTS idx_claims_wallet ON access_claims(wallet_address);
CREATE INDEX IF NOT EXISTS idx_claims_contract ON access_claims(contract_address);
CREATE INDEX IF NOT EXISTS idx_claims_status ON access_claims(invitation_status);
CREATE INDEX IF NOT EXISTS idx_claims_composite ON access_claims(contract_address, wallet_address);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON claim_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON claim_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_contracts_address ON contracts(contract_address);

-- Views for easier querying
CREATE OR REPLACE VIEW pending_invitations AS
SELECT 
    ac.id,
    ac.contract_address,
    ac.wallet_address,
    ac.telegram_username,
    ac.invitation_attempts,
    c.telegram_group_id,
    c.group_title
FROM access_claims ac
JOIN contracts c ON ac.contract_address = c.contract_address
WHERE ac.invitation_status IN ('pending', 'retry_needed')
    AND ac.invitation_attempts < 10
    AND c.is_active = true;

CREATE OR REPLACE VIEW successful_claims AS
SELECT 
    ac.contract_address,
    ac.wallet_address,
    ac.telegram_username,
    ac.user_joined,
    ac.joined_at,
    p.tx_hash,
    p.amount,
    c.group_title
FROM access_claims ac
JOIN purchases p ON ac.wallet_address = p.wallet_address 
    AND ac.contract_address = p.contract_address
JOIN contracts c ON ac.contract_address = c.contract_address
WHERE ac.invitation_status = 'success';