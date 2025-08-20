#!/bin/bash

# TEMPL Protocol Setup Script
# This script sets up the token-gated Telegram group access system

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}   TEMPL Protocol Setup Script${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Function to prompt for input with default value
prompt_with_default() {
    local prompt=$1
    local default=$2
    local var_name=$3
    
    if [ -z "$default" ]; then
        read -p "$prompt: " value
    else
        read -p "$prompt [$default]: " value
        value=${value:-$default}
    fi
    
    eval "$var_name='$value'"
}

# Function to generate random secret
generate_secret() {
    openssl rand -hex 32 2>/dev/null || cat /dev/urandom | tr -dc 'a-zA-Z0-9' | fold -w 32 | head -n 1
}

# Check if .env exists and load it
if [ -f .env ]; then
    echo -e "${YELLOW}Found existing .env file. Loading current values...${NC}"
    export $(cat .env | grep -v '^#' | xargs)
    ENV_EXISTS=true
else
    echo -e "${GREEN}No .env file found. Starting fresh setup...${NC}"
    ENV_EXISTS=false
fi

echo ""
echo -e "${BLUE}=== Step 1: Security Configuration ===${NC}"
echo ""

# JWT Secret
if [ -z "$JWT_SECRET" ]; then
    JWT_SECRET=$(generate_secret)
    echo -e "${GREEN}Generated new JWT_SECRET${NC}"
else
    echo -e "${YELLOW}Using existing JWT_SECRET${NC}"
fi

# Frontend URL
prompt_with_default "Frontend URL (comma-separated for multiple)" "${FRONTEND_URL:-http://localhost:3002,http://localhost:8080}" FRONTEND_URL

echo ""
echo -e "${BLUE}=== Step 2: BASE Blockchain Configuration ===${NC}"
echo ""

CHAIN_ID=8453
NETWORK_NAME="base"
DEFAULT_RPC="https://mainnet.base.org"

echo -e "${GREEN}Network: BASE Mainnet (Chain ID: 8453)${NC}"

# RPC URL
prompt_with_default "RPC URL for BASE" "${RPC_URL:-$DEFAULT_RPC}" RPC_URL

# Addresses
prompt_with_default "Priest Address (controls treasury)" "$PRIEST_ADDRESS" PRIEST_ADDRESS
prompt_with_default "Token Contract Address" "$TOKEN_ADDRESS" TOKEN_ADDRESS
prompt_with_default "Entry Fee (must be even number)" "${ENTRY_FEE:-420}" ENTRY_FEE

# Validate entry fee is even
if [ $((ENTRY_FEE % 2)) -ne 0 ]; then
    echo -e "${RED}Error: Entry fee must be an even number for 50/50 split${NC}"
    exit 1
fi

# Contract deployment
if [ -z "$CONTRACT_ADDRESS" ]; then
    echo ""
    echo -e "${YELLOW}No contract address found. Would you like to deploy now?${NC}"
    read -p "Deploy contract? (y/n): " DEPLOY_NOW
    
    if [ "$DEPLOY_NOW" = "y" ]; then
        prompt_with_default "Deployer Private Key (starts with 0x)" "" PRIVATE_KEY
        DEPLOY_CONTRACT=true
    else
        echo -e "${YELLOW}You'll need to deploy manually and add CONTRACT_ADDRESS to .env${NC}"
        CONTRACT_ADDRESS=""
        DEPLOY_CONTRACT=false
    fi
else
    echo -e "${GREEN}Using existing contract: $CONTRACT_ADDRESS${NC}"
    DEPLOY_CONTRACT=false
fi

echo ""
echo -e "${BLUE}=== Step 3: Database Configuration ===${NC}"
echo ""

prompt_with_default "Database Host" "${DB_HOST:-localhost}" DB_HOST
prompt_with_default "Database Port" "${DB_PORT:-5432}" DB_PORT
prompt_with_default "Database Name" "${DB_NAME:-telegram_access}" DB_NAME
prompt_with_default "Database User" "${DB_USER:-postgres}" DB_USER
prompt_with_default "Database Password" "$DB_PASSWORD" DB_PASSWORD

echo ""
echo -e "${BLUE}=== Step 4: Telegram Configuration ===${NC}"
echo ""

echo -e "${YELLOW}Get your API credentials from: https://my.telegram.org${NC}"
prompt_with_default "API ID" "$API_ID" API_ID
prompt_with_default "API Hash" "$API_HASH" API_HASH
prompt_with_default "Phone Number (with country code)" "$PHONE_NUMBER" PHONE_NUMBER

echo ""
echo -e "${YELLOW}IMPORTANT: Manual Group Setup Required${NC}"
echo "1. Create a Telegram group manually using the account with phone: $PHONE_NUMBER"
echo "2. Add your bot as admin (with restricted permissions - no invite)"
echo "3. Get the group ID (it will look like -1001234567890)"
echo ""

prompt_with_default "Telegram Group ID" "$TELEGRAM_GROUP_ID" TELEGRAM_GROUP_ID
prompt_with_default "Group Title" "${GROUP_TITLE:-Premium Access Group}" GROUP_TITLE
prompt_with_default "Bot Username (without @)" "$BOT_USERNAME" BOT_USERNAME
prompt_with_default "Rosie Bot Username (optional)" "${ROSIE_BOT_USERNAME:-RosieBot}" ROSIE_BOT_USERNAME

# Session string handling
if [ -n "$SESSION_STRING" ]; then
    echo -e "${GREEN}Session string exists. Telegram authentication may not be needed.${NC}"
else
    echo -e "${YELLOW}No session string found. You'll need to authenticate on first run.${NC}"
fi

echo ""
echo -e "${BLUE}=== Step 5: Server Configuration ===${NC}"
echo ""

prompt_with_default "API Port" "${API_PORT:-3002}" API_PORT

echo ""
echo -e "${BLUE}=== Creating .env file ===${NC}"
echo ""

# Create .env file
cat > .env << EOF
# ========================================
# TEMPL Protocol Configuration
# Generated: $(date)
# ========================================

# SECURITY (Required)
JWT_SECRET=$JWT_SECRET
PRIEST_ADDRESS=$PRIEST_ADDRESS
FRONTEND_URL=$FRONTEND_URL

# BLOCKCHAIN (Required)
PRIVATE_KEY=${PRIVATE_KEY:-}
RPC_URL=$RPC_URL
TOKEN_ADDRESS=$TOKEN_ADDRESS
ENTRY_FEE=$ENTRY_FEE
CONTRACT_ADDRESS=$CONTRACT_ADDRESS
CHAIN_ID=$CHAIN_ID
NETWORK_NAME=$NETWORK_NAME

# DATABASE (Required)
DB_HOST=$DB_HOST
DB_PORT=$DB_PORT
DB_NAME=$DB_NAME
DB_USER=$DB_USER
DB_PASSWORD=$DB_PASSWORD

# TELEGRAM (Required)
API_ID=$API_ID
API_HASH=$API_HASH
PHONE_NUMBER=$PHONE_NUMBER
SESSION_STRING=$SESSION_STRING
BOT_USERNAME=$BOT_USERNAME
ROSIE_BOT_USERNAME=$ROSIE_BOT_USERNAME
TELEGRAM_GROUP_ID=$TELEGRAM_GROUP_ID
GROUP_TITLE=$GROUP_TITLE

# SERVER
API_PORT=$API_PORT

# OPTIONAL
BASESCAN_API_KEY=${BASESCAN_API_KEY:-}
EOF

echo -e "${GREEN}✅ .env file created successfully${NC}"

# Check if dependencies are installed
echo ""
echo -e "${BLUE}=== Step 6: Installing Dependencies ===${NC}"
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}Node.js is not installed. Please install Node.js v16+${NC}"
    exit 1
fi

# Check PostgreSQL
if ! command -v psql &> /dev/null; then
    echo -e "${YELLOW}PostgreSQL client not found. Make sure PostgreSQL is running.${NC}"
else
    echo -e "${GREEN}PostgreSQL client found${NC}"
fi

# Install npm dependencies
echo ""
echo "Installing npm dependencies..."
npm install

# Initialize database
echo ""
echo -e "${BLUE}=== Step 7: Database Setup ===${NC}"
echo ""

read -p "Initialize database now? (y/n): " INIT_DB
if [ "$INIT_DB" = "y" ]; then
    echo "Creating database..."
    PGPASSWORD=$DB_PASSWORD createdb -h $DB_HOST -p $DB_PORT -U $DB_USER $DB_NAME 2>/dev/null || echo "Database may already exist"
    
    echo "Initializing schema..."
    PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f src/database/schema.sql
    echo -e "${GREEN}✅ Database initialized${NC}"
fi

# Compile contracts
echo ""
echo -e "${BLUE}=== Step 8: Smart Contracts ===${NC}"
echo ""

echo "Compiling contracts..."
npm run compile
echo -e "${GREEN}✅ Contracts compiled${NC}"

# Deploy contract if requested
if [ "$DEPLOY_CONTRACT" = true ]; then
    echo ""
    echo "Deploying contract to BASE mainnet..."
    npm run deploy
    
    echo ""
    echo -e "${YELLOW}IMPORTANT: Add the deployed CONTRACT_ADDRESS to your .env file${NC}"
    echo "Then run: npm run verify"
fi

# Create systemd service file
echo ""
echo -e "${BLUE}=== Step 9: Service Configuration ===${NC}"
echo ""

read -p "Create systemd service file? (y/n): " CREATE_SERVICE
if [ "$CREATE_SERVICE" = "y" ]; then
    sudo tee /etc/systemd/system/templ.service > /dev/null << EOF
[Unit]
Description=TEMPL Token-Gated Service
After=network.target postgresql.service

[Service]
Type=simple
User=$USER
WorkingDirectory=$(pwd)
ExecStart=/usr/bin/node src/tokenGatedService.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

    echo -e "${GREEN}✅ Systemd service file created${NC}"
    echo ""
    echo "To start service:"
    echo "  sudo systemctl start templ"
    echo ""
    echo "To enable on boot:"
    echo "  sudo systemctl enable templ"
fi

# Final verification
echo ""
echo -e "${BLUE}=== Step 10: System Verification ===${NC}"
echo ""

npm run verify || true

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}   🎉 Setup Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Next steps:"
echo ""
echo "1. ${YELLOW}Manual Telegram Group Setup:${NC}"
echo "   - Create a group using the Telegram account: $PHONE_NUMBER"
echo "   - Add bot @$BOT_USERNAME as admin with restricted permissions:"
echo "     • Can delete messages: Yes"
echo "     • Can ban users: Yes"
echo "     • Can invite users: No"
echo "   - Note the group ID and update TELEGRAM_GROUP_ID if needed"
echo ""
echo "2. ${YELLOW}Deploy Contract (if not done):${NC}"
echo "   npm run deploy"
echo "   Add CONTRACT_ADDRESS to .env"
echo ""
echo "3. ${YELLOW}Start Service:${NC}"
echo "   npm start"
echo ""
echo "4. ${YELLOW}First-time Telegram Authentication:${NC}"
echo "   When you first run the service, you'll need to:"
echo "   - Enter the verification code sent to $PHONE_NUMBER"
echo "   - The SESSION_STRING will be saved automatically"
echo ""
echo "5. ${YELLOW}Access Frontend:${NC}"
echo "   http://localhost:$API_PORT"
echo ""
echo -e "${BLUE}Run 'npm run verify' to check system status${NC}"