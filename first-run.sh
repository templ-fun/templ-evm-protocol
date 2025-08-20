#!/bin/bash

# First Run Helper Script
# Captures SESSION_STRING and other generated values

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}   TEMPL First Run Helper${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo -e "${YELLOW}Please run ./setup.sh first to create .env file${NC}"
    exit 1
fi

# Load environment
export $(cat .env | grep -v '^#' | xargs)

echo -e "${GREEN}Starting Telegram authentication process...${NC}"
echo ""
echo "This will:"
echo "1. Connect to Telegram with phone: $PHONE_NUMBER"
echo "2. Send you a verification code"
echo "3. Save the SESSION_STRING for future use"
echo ""

# Create a temporary Node.js script in current directory
cat > capture_session_temp.js << 'EOF'
require('dotenv').config();
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const input = require('input');
const fs = require('fs');
const path = require('path');

async function captureSession() {
  const apiId = parseInt(process.env.API_ID);
  const apiHash = process.env.API_HASH;
  const phoneNumber = process.env.PHONE_NUMBER;
  
  console.log('Connecting to Telegram...');
  
  const stringSession = new StringSession('');
  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({
    phoneNumber: async () => phoneNumber,
    password: async () => await input.text('Please enter your 2FA password (if enabled): '),
    phoneCode: async () => await input.text('Please enter the code you received: '),
    onError: (err) => console.error(err),
  });

  console.log('Successfully authenticated!');
  
  const sessionString = client.session.save();
  console.log('\nSESSION_STRING=' + sessionString);
  
  // Update .env file
  const envPath = path.join(process.cwd(), '.env');
  let envContent = fs.readFileSync(envPath, 'utf-8');
  
  if (envContent.includes('SESSION_STRING=')) {
    envContent = envContent.replace(/SESSION_STRING=.*/g, `SESSION_STRING=${sessionString}`);
  } else {
    envContent += `\nSESSION_STRING=${sessionString}`;
  }
  
  fs.writeFileSync(envPath, envContent);
  console.log('\n✅ SESSION_STRING saved to .env file');
  
  // Get user info
  const me = await client.getMe();
  console.log(`\nLogged in as: ${me.firstName} ${me.lastName || ''} (@${me.username || 'no username'})`);
  
  await client.disconnect();
}

captureSession().catch(console.error);
EOF

# Run the session capture from current directory
echo -e "${YELLOW}Starting authentication...${NC}"
node capture_session_temp.js

# Clean up
rm capture_session_temp.js

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}   ✅ First Run Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "SESSION_STRING has been saved to .env"
echo ""
echo "Next steps:"
echo "1. Deploy your smart contract to BASE if not done:"
echo "   npm run deploy"
echo ""
echo "2. Verify the system:"
echo "   npm run verify"
echo ""
echo "3. Start the service:"
echo "   npm start"
echo ""