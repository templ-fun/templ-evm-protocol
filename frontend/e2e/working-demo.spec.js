import { test, expect } from '@playwright/test';

test.describe('TEMPL Working Demo', () => {
  test.beforeEach(async ({ context }) => {
    // Mock window.ethereum for MetaMask
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
            return '0x7a69'; // 31337 in hex
          }
          if (method === 'personal_sign') {
            return '0xmocksignature';
          }
          return null;
        },
        on: () => {},
        removeListener: () => {},
      };
    });
  });

  test('Basic UI Flow', async ({ page }) => {
    // Navigate to app
    await page.goto('/');
    
    // Wait for app to load
    await page.waitForSelector('button:has-text("Connect Wallet")', { timeout: 5000 });
    
    // Click connect wallet
    await page.click('button:has-text("Connect Wallet")');
    
    // Wait a bit for React state to update
    await page.waitForTimeout(1000);
    
    // Check if deployment form appears
    const deployTitle = page.locator('h2:has-text("Create Templ")');
    await expect(deployTitle).toBeVisible({ timeout: 5000 });
    
    // Fill deployment form
    await page.fill('input[placeholder*="Token address"]', '0x5FbDB2315678afecb367f032d93F642f64180aa3');
    await page.fill('input[placeholder*="Protocol fee recipient"]', '0x70997970C51812dc3A010C7d01b50e0d17dc79C8');
    await page.fill('input[placeholder*="Entry fee"]', '100');
    
    // Take screenshot
    await page.screenshot({ path: 'test-results/working-demo.png' });
    
    console.log('Test completed successfully!');
  });
});