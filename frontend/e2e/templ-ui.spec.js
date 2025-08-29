import { test, expect } from '@playwright/test';

test.describe('TEMPL UI E2E Tests', () => {
  test.beforeEach(async ({ page, context }) => {
    // Mock ethereum provider for testing - must be done before navigation
    await context.addInitScript(() => {
      window.ethereum = {
        isMetaMask: true,
        request: async ({ method }) => {
          if (method === 'eth_requestAccounts') {
            return ['0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'];
          }
          if (method === 'eth_accounts') {
            return ['0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'];
          }
          if (method === 'eth_chainId') {
            return '0x7a69'; // 31337 for local hardhat
          }
          if (method === 'personal_sign') {
            return '0x' + '0'.repeat(130); // Mock signature
          }
          return null;
        },
        on: () => {},
        removeListener: () => {},
      };
    });
    
    // Navigate to the app after setting up mocks
    await page.goto('/');
  });

  test('Complete TEMPL flow through UI', async ({ page }) => {
    // Record video for demo purposes
    await test.info().annotations.push({
      type: 'video',
      description: 'Recording TEMPL tech demo'
    });

    // Step 1: Connect wallet
    await test.step('Connect wallet', async () => {
      const connectButton = page.locator('button:has-text("Connect Wallet")');
      await expect(connectButton).toBeVisible();
      await connectButton.click();
      
      // Wait for deployment form to appear (indicates wallet connected)
      await expect(page.locator('h2:has-text("Create Templ")')).toBeVisible({ timeout: 5000 });
    });

    // Step 2: Fill deployment form
    await test.step('Deploy TEMPL contract', async () => {
      // Fill in token address
      await page.fill('input[placeholder*="Token address"]', '0x5FbDB2315678afecb367f032d93F642f64180aa3');
      
      // Fill protocol fee recipient
      await page.fill('input[placeholder*="Protocol fee recipient"]', '0x70997970C51812dc3A010C7d01b50e0d17dc79C8');
      
      // Fill entry fee
      await page.fill('input[placeholder*="Entry fee"]', '100');
      
      // Keep default priest weights
      
      // Click deploy button
      const deployButton = page.locator('button:has-text("Deploy")');
      await deployButton.click();
      
      // Wait for deployment (contract address should appear)
      await expect(page.locator('text=Contract:')).toBeVisible({ timeout: 30000 });
      
      // Take screenshot of deployed contract
      await page.screenshot({ 
        path: 'e2e-results/01-contract-deployed.png',
        fullPage: true 
      });
    });

    // Step 3: Join the TEMPL
    await test.step('Purchase access and join', async () => {
      // Get the deployed contract address
      const contractText = await page.locator('text=/Contract: 0x[a-fA-F0-9]+/').textContent();
      const templAddress = contractText.split(': ')[1];
      
      // Fill in the templ address to join
      await page.fill('input[placeholder*="TEMPL contract address"]', templAddress);
      
      // Click join button
      const joinButton = page.locator('button:has-text("Join TEMPL")');
      await joinButton.click();
      
      // Wait for group to be joined
      await expect(page.locator('text=Group:')).toBeVisible({ timeout: 30000 });
      
      await page.screenshot({ 
        path: 'e2e-results/02-joined-group.png',
        fullPage: true 
      });
    });

    // Step 4: Send a message
    await test.step('Send message in group', async () => {
      // Type message
      await page.fill('input[placeholder*="Type a message"]', 'Hello from Playwright E2E test! 🎬');
      
      // Send message
      const sendButton = page.locator('button:has-text("Send")');
      await sendButton.click();
      
      // Message should appear in the list
      await expect(page.locator('text=Hello from Playwright')).toBeVisible({ timeout: 10000 });
      
      await page.screenshot({ 
        path: 'e2e-results/03-message-sent.png',
        fullPage: true 
      });
    });

    // Step 5: Create a proposal
    await test.step('Create governance proposal', async () => {
      // Fill proposal form
      await page.fill('input[placeholder*="Proposal title"]', 'Enable Emergency Pause');
      await page.fill('textarea[placeholder*="Description"]', 'This proposal enables the emergency pause feature for enhanced security.');
      await page.fill('input[placeholder*="Calldata"]', '0x12345678');
      
      // Submit proposal
      const proposeButton = page.locator('button:has-text("Create Proposal")');
      await proposeButton.click();
      
      // Proposal should appear in list
      await expect(page.locator('text=Enable Emergency Pause')).toBeVisible({ timeout: 15000 });
      
      await page.screenshot({ 
        path: 'e2e-results/04-proposal-created.png',
        fullPage: true 
      });
    });

    // Step 6: Vote on proposal
    await test.step('Vote on proposal', async () => {
      // Find vote button for the proposal
      const voteButton = page.locator('button:has-text("Vote For")').first();
      await voteButton.click();
      
      // Vote should be recorded
      await expect(page.locator('text=/Votes: [1-9]/')).toBeVisible({ timeout: 10000 });
      
      await page.screenshot({ 
        path: 'e2e-results/05-vote-cast.png',
        fullPage: true 
      });
    });

    // Step 7: Check mutes/moderation
    await test.step('Check moderation features', async () => {
      // Fetch mutes button should be visible
      const mutesButton = page.locator('button:has-text("Fetch Mutes")');
      if (await mutesButton.isVisible()) {
        await mutesButton.click();
        
        // Mutes section should update
        await expect(page.locator('text=Active Mutes')).toBeVisible({ timeout: 5000 });
      }
      
      await page.screenshot({ 
        path: 'e2e-results/06-moderation-check.png',
        fullPage: true 
      });
    });

    // Final screenshot showing complete state
    await test.step('Demo complete', async () => {
      // Scroll to top
      await page.evaluate(() => window.scrollTo(0, 0));
      
      // Add completion banner
      await page.evaluate(() => {
        const banner = document.createElement('div');
        banner.id = 'demo-complete-banner';
        banner.style.cssText = `
          position: fixed;
          top: 20px;
          left: 50%;
          transform: translateX(-50%);
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          padding: 20px 40px;
          border-radius: 10px;
          font-size: 20px;
          font-weight: bold;
          z-index: 10000;
          box-shadow: 0 10px 30px rgba(0,0,0,0.3);
        `;
        banner.textContent = '✅ TEMPL E2E Demo Complete!';
        document.body.appendChild(banner);
      });
      
      await page.waitForTimeout(2000);
      
      await page.screenshot({ 
        path: 'e2e-results/07-demo-complete.png',
        fullPage: true 
      });
    });
  });

  test('Mobile responsive test', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 812 });
    
    await page.goto('/');
    
    // Check that UI is responsive
    await expect(page.locator('button:has-text("Connect Wallet")')).toBeVisible();
    
    await page.screenshot({ 
      path: 'e2e-results/mobile-view.png',
      fullPage: true 
    });
  });
});