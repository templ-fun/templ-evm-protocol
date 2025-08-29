import { test, expect } from '@playwright/test';

test.describe('TEMPL Simple Demo Recording', () => {
  test('Record TEMPL UI Demo', async ({ page, context }) => {
    // Don't start backend - just test the frontend UI
    await page.goto('http://localhost:5173');
    
    // Take initial screenshot
    await page.screenshot({ 
      path: 'test-results/01-landing.png',
      fullPage: true 
    });
    
    // Mock wallet connection
    await page.evaluate(() => {
      window.ethereum = {
        request: async ({ method }) => {
          if (method === 'eth_requestAccounts') {
            return ['0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'];
          }
          if (method === 'eth_accounts') {
            return ['0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'];
          }
          return null;
        },
        on: () => {},
        removeListener: () => {},
      };
    });
    
    // Connect wallet
    const connectBtn = page.locator('button:has-text("Connect Wallet")');
    if (await connectBtn.isVisible()) {
      await connectBtn.click();
      await page.waitForTimeout(1000);
      
      await page.screenshot({ 
        path: 'test-results/02-wallet-connected.png',
        fullPage: true 
      });
    }
    
    // Show deployment form
    await page.fill('input[placeholder*="Token address"]', '0x5FbDB2315678afecb367f032d93F642f64180aa3');
    await page.fill('input[placeholder*="Protocol fee recipient"]', '0x70997970C51812dc3A010C7d01b50e0d17dc79C8');
    await page.fill('input[placeholder*="Entry fee"]', '100');
    
    await page.screenshot({ 
      path: 'test-results/03-deployment-form.png',
      fullPage: true 
    });
    
    // Show join form
    await page.fill('input[placeholder*="TEMPL contract address"]', '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9');
    
    await page.screenshot({ 
      path: 'test-results/04-join-form.png',
      fullPage: true 
    });
    
    // Show message form
    await page.fill('input[placeholder*="Type a message"]', 'Hello from TEMPL! This is a secure, token-gated message.');
    
    await page.screenshot({ 
      path: 'test-results/05-message-form.png',
      fullPage: true 
    });
    
    // Show proposal form
    await page.fill('input[placeholder*="Proposal title"]', 'Enable Emergency Pause');
    await page.fill('textarea[placeholder*="Description"]', 'This proposal enables the emergency pause feature for enhanced security.');
    
    await page.screenshot({ 
      path: 'test-results/06-proposal-form.png',
      fullPage: true 
    });
    
    // Add demo complete banner
    await page.evaluate(() => {
      const banner = document.createElement('div');
      banner.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        padding: 40px;
        border-radius: 20px;
        font-size: 24px;
        font-weight: bold;
        text-align: center;
        z-index: 10000;
        box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      `;
      banner.innerHTML = `
        <h1>🎉 TEMPL Demo</h1>
        <p style="margin-top: 20px; font-size: 18px;">
          Token-Gated Access Control Platform
        </p>
        <ul style="text-align: left; margin-top: 20px; font-size: 16px; list-style: none;">
          <li>✅ Smart Contract Deployment</li>
          <li>✅ Token-Gated Access</li>
          <li>✅ Encrypted Messaging (XMTP)</li>
          <li>✅ On-Chain Governance</li>
          <li>✅ Delegated Moderation</li>
        </ul>
      `;
      document.body.appendChild(banner);
    });
    
    await page.waitForTimeout(2000);
    
    await page.screenshot({ 
      path: 'test-results/07-demo-complete.png',
      fullPage: true 
    });
    
    console.log('Demo recording complete! Screenshots saved in test-results/');
  });
});