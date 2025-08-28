#!/bin/bash

# TEMPL Protocol Setup Continuation Script
# This script continues setup from step 7, using existing .env values
# Use this when dependencies are already installed and .env is configured

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}   TEMPL Protocol Setup (Continuation)${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo -e "${RED}Error: .env file not found!${NC}"
    echo "This script requires an existing .env file with all variables configured."
    exit 1
fi

# Load environment variables
echo -e "${GREEN}Loading configuration from .env...${NC}"
export $(cat .env | grep -v '^#' | xargs)

# Validate required variables are set
echo ""
echo -e "${BLUE}=== Validating Configuration ===${NC}"
echo ""

REQUIRED_VARS=(
    "JWT_SECRET"
    "FRONTEND_URL"
    "RPC_URL"
    "TOKEN_ADDRESS"
    "ENTRY_FEE"
    "DB_HOST"
    "DB_NAME"
    "DB_USER"
    "DB_PASSWORD"
    "API_ID"
    "API_HASH"
    "PHONE_NUMBER"
    "TELEGRAM_GROUP_ID"
    "BOT_USERNAME"
)

ALL_VARS_SET=true
for VAR in "${REQUIRED_VARS[@]}"; do
    if [ -z "${!VAR}" ]; then
        echo -e "${RED}✗ $VAR is not set${NC}"
        ALL_VARS_SET=false
    else
        echo -e "${GREEN}✓ $VAR is set${NC}"
    fi
done

if [ "$ALL_VARS_SET" = false ]; then
    echo ""
    echo -e "${RED}Error: Some required variables are missing in .env${NC}"
    echo "Please configure all variables before running this script."
    exit 1
fi

echo ""
echo -e "${GREEN}All required variables are configured!${NC}"

# Step 7: Initialize Database
echo ""
echo -e "${BLUE}=== Step 7: Database Initialization ===${NC}"
echo ""

# Check if PostgreSQL is running
if command -v psql &> /dev/null; then
    echo "PostgreSQL client found."
    
    # Test database connection
    echo "Testing database connection..."
    PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p ${DB_PORT:-5432} -U $DB_USER -d postgres -c '\q' 2>/dev/null && DB_CONNECTED=true || DB_CONNECTED=false
    
    if [ "$DB_CONNECTED" = true ]; then
        echo -e "${GREEN}✓ Database connection successful${NC}"
        
        # Create database if it doesn't exist
        echo "Creating database if it doesn't exist..."
        PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p ${DB_PORT:-5432} -U $DB_USER -d postgres -c "CREATE DATABASE $DB_NAME;" 2>/dev/null || echo "Database already exists"
        
        # Initialize schema
        echo "Initializing database schema..."
        PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p ${DB_PORT:-5432} -U $DB_USER -d $DB_NAME -f src/database/schema.sql
        echo -e "${GREEN}✓ Database schema initialized${NC}"
    else
        echo -e "${YELLOW}⚠ Could not connect to database. Please ensure PostgreSQL is running.${NC}"
        echo "You can initialize the database manually with:"
        echo "  psql -h $DB_HOST -U $DB_USER -d $DB_NAME -f src/database/schema.sql"
    fi
else
    echo -e "${YELLOW}PostgreSQL client not found. Skipping database initialization.${NC}"
    echo "Install PostgreSQL client and run:"
    echo "  npm run init-db"
fi

# Step 8: Compile Smart Contracts (if contract not deployed)
echo ""
echo -e "${BLUE}=== Step 8: Smart Contract Compilation ===${NC}"
echo ""

if [ -z "$CONTRACT_ADDRESS" ]; then
    echo "No contract address found. Compiling contracts..."
    if [ -f "hardhat.config.js" ]; then
        echo "Running: npx hardhat compile"
        npx hardhat compile || echo -e "${YELLOW}⚠ Compilation failed. You may need to install dependencies first.${NC}"
    else
        echo -e "${YELLOW}Hardhat config not found. Skipping compilation.${NC}"
    fi
else
    echo -e "${GREEN}Contract already deployed at: $CONTRACT_ADDRESS${NC}"
    echo "Skipping compilation."
fi

# Step 9: First-run Telegram Authentication Check
echo ""
echo -e "${BLUE}=== Step 9: Telegram Authentication ===${NC}"
echo ""

if [ -z "$SESSION_STRING" ]; then
    echo -e "${YELLOW}No Telegram session found.${NC}"
    echo "You'll need to authenticate on first run."
    echo ""
    echo "To authenticate Telegram, run:"
    echo -e "${GREEN}  ./first-run.sh${NC}"
    echo ""
    echo "This will:"
    echo "  1. Connect to Telegram with your phone number"
    echo "  2. Ask for the verification code"
    echo "  3. Save the session for future use"
else
    echo -e "${GREEN}✓ Telegram session string found${NC}"
    echo "Authentication may not be needed."
fi

# Step 10: Systemd Service Setup (optional)
echo ""
echo -e "${BLUE}=== Step 10: Service Installation (Optional) ===${NC}"
echo ""

if [ "$EUID" -eq 0 ] || sudo -n true 2>/dev/null; then
    read -p "Would you like to install as a systemd service? (y/n): " INSTALL_SERVICE
    
    if [ "$INSTALL_SERVICE" = "y" ]; then
        SERVICE_FILE="/etc/systemd/system/templ.service"
        
        echo "Creating systemd service..."
        sudo tee $SERVICE_FILE > /dev/null << EOF
[Unit]
Description=TEMPL Token Gated Telegram Service
After=network.target postgresql.service

[Service]
Type=simple
User=$USER
WorkingDirectory=$(pwd)
ExecStart=/usr/bin/node $(pwd)/src/tokenGatedService.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
Environment="NODE_ENV=production"

[Install]
WantedBy=multi-user.target
EOF
        
        sudo systemctl daemon-reload
        echo -e "${GREEN}✓ Service installed${NC}"
        echo ""
        echo "Service commands:"
        echo "  Start:   sudo systemctl start templ"
        echo "  Stop:    sudo systemctl stop templ"
        echo "  Status:  sudo systemctl status templ"
        echo "  Enable:  sudo systemctl enable templ"
        echo "  Logs:    journalctl -u templ -f"
    fi
else
    echo "Skipping service installation (requires sudo)."
fi

# Step 11: Verification
echo ""
echo -e "${BLUE}=== Step 11: System Verification ===${NC}"
echo ""

if [ -f "scripts/verify-system.js" ]; then
    echo "Running system verification..."
    node scripts/verify-system.js || echo -e "${YELLOW}⚠ Verification script encountered issues${NC}"
else
    echo -e "${YELLOW}Verification script not found. Skipping.${NC}"
fi

# Final Summary
echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}         Setup Complete!${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

echo -e "${GREEN}Configuration Summary:${NC}"
echo "  Network: BASE (Chain ID: 8453)"
if [ -n "$PRIEST_ADDRESS" ]; then
    echo "  Priest: $PRIEST_ADDRESS"
else
    echo "  Priest: deployer wallet"
fi
echo "  Token: $TOKEN_ADDRESS"
echo "  Entry Fee: $ENTRY_FEE (50% treasury, 50% burn)"
echo "  Group ID: $TELEGRAM_GROUP_ID"
echo "  API Port: ${API_PORT:-3002}"

if [ -n "$CONTRACT_ADDRESS" ]; then
    echo "  Contract: $CONTRACT_ADDRESS"
else
    echo -e "  Contract: ${YELLOW}Not deployed yet${NC}"
fi

echo ""
echo -e "${GREEN}Next Steps:${NC}"
echo ""

if [ -z "$CONTRACT_ADDRESS" ]; then
    echo "1. Deploy the smart contract:"
    echo "   npm run deploy"
    echo "   Then add CONTRACT_ADDRESS to .env"
    echo ""
fi

if [ -z "$SESSION_STRING" ]; then
    echo "2. Authenticate with Telegram:"
    echo "   ./first-run.sh"
    echo ""
fi

echo "3. Start the service:"
echo "   npm start"
echo ""
echo "4. Access the web interface:"
echo "   ${FRONTEND_URL}/purchase.html?contract=\${CONTRACT_ADDRESS}"
echo ""

echo -e "${GREEN}✓ Setup continuation complete!${NC}"
echo ""
echo -e "${YELLOW}Important Reminders:${NC}"
echo "• Ensure the Telegram group is created manually"
echo "• Add your bot as admin with restricted permissions"
echo "• Treasury withdrawals require DAO proposals"
echo "• Users must pay tokens to join the group"
echo ""

# Make scripts executable
chmod +x first-run.sh 2>/dev/null || true
chmod +x setup.sh 2>/dev/null || true
chmod +x setup-continue.sh 2>/dev/null || true

echo -e "${GREEN}Ready to launch! 🚀${NC}"