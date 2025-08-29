import { test, expect } from '@playwright/test';
import { ethers } from 'ethers';

test.describe('TEMPL Tech Demo - Full Flow', () => {
  let provider;
  let priestWallet;
  let memberWallet;
  let delegateWallet;
  let tokenAddress;
  let templAddress;

  test.beforeAll(async () => {
    // Connect to local Hardhat node
    provider = new ethers.JsonRpcProvider('http://localhost:8545');
    
    // Use Hardhat test accounts
    const accounts = [
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', // Account 0 - Priest
      '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d', // Account 1 - Member
      '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a', // Account 2 - Delegate
    ];
    
    priestWallet = new ethers.Wallet(accounts[0], provider);
    memberWallet = new ethers.Wallet(accounts[1], provider);
    delegateWallet = new ethers.Wallet(accounts[2], provider);

    // Deploy test token
    const tokenAbi = [
      'constructor()',
      'function mint(address to, uint256 amount)',
      'function approve(address spender, uint256 amount) returns (bool)',
      'function balanceOf(address account) view returns (uint256)'
    ];
    
    const tokenBytecode = '0x608060405234801561001057600080fd5b50336000908152602081905260409020681b1ae4d6e2ef50000090556104b3806100396000396000f3fe608060405234801561001057600080fd5b50600436106100415760003560e01c806340c10f191461004657806370a082311461005b578063dd62ed3e14610084575b600080fd5b610059610054366004610239565b61009d565b005b61007261006936600461027b565b60009081526020819052604090205490565b60405190815260200160405180910390f35b610072610092366004610295565b600092915050565b50565b806100a833826100ee565b6100ea5760405162461bcd60e51b815260206004820152600f60248201526e1d1c985b9cd9995c8819985a5b1959608a1b604482015260640160405180910390fd5b5050565b60006100fa838361014e565b61014657508260008181526020819052604090205461011a91906102df565b600090815260208190526040902055816000908152602081905260409020546101449082610302565b155b949350505050565b600082610192576001600160a01b03821660009081526020819052604090205482111561018a5760008181526020819052604090205491506101d0565b5060016101d0565b6001600160a01b038216600090815260208190526040902054828110156101cb576000818152602081905260409020549150506101d0565b506000195b92915050565b80356001600160a01b03811681146101ed57600080fd5b919050565b60008060408385031215610204578182fd5b61020d836101d6565b946020939093013593505050565b60006020828403121561022d578081fd5b610236826101d6565b9392505050565b6000806040838503121561024f578182fd5b610258836101d6565b9150610266602084016101d6565b90509250929050565b60006020828403121561028057600080fd5b5035919050565b6000806040838503121561029957600080fd5b50508035926020909101359150565b6000602082840312156102ba578081fd5b81356001600160a01b0381168114610236578182fd5b634e487b7160e01b600052601160045260246000fd5b600082198211156102fa576102fa6102d0565b500190565b60008282101561031457610314d06102d0565b50039056fea2646970667358221220f9c7d2e3b4d8a6c1e5f2a8b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d364736f6c63430008170033';
    
    const tokenFactory = new ethers.ContractFactory(tokenAbi, tokenBytecode, priestWallet);
    const token = await tokenFactory.deploy();
    await token.waitForDeployment();
    tokenAddress = await token.getAddress();

    // Mint tokens to member
    await token.mint(memberWallet.address, ethers.parseEther('1000'));
  });

  test('Complete TEMPL Flow with Video Recording', async ({ page }) => {
    // Start recording with annotations
    await test.step('1. Navigate to TEMPL Application', async () => {
      await page.goto('/');
      await expect(page).toHaveTitle(/TEMPL/);
      
      // Add visual annotation
      await page.evaluate(() => {
        console.log('🎬 Starting TEMPL Tech Demo - Decentralized Access Control');
      });
    });

    await test.step('2. Connect Priest Wallet', async () => {
      // Click connect wallet button
      await page.click('button:has-text("Connect Wallet")');
      
      // In a real scenario, this would connect MetaMask
      // For demo, we'll simulate wallet connection
      await page.evaluate((address) => {
        window.localStorage.setItem('walletAddress', address);
        window.dispatchEvent(new Event('walletConnected'));
      }, priestWallet.address);
      
      await expect(page.locator('text=' + priestWallet.address.slice(0, 6))).toBeVisible();
    });

    await test.step('3. Deploy TEMPL Contract', async () => {
      // Fill in contract parameters
      await page.fill('input[name="tokenAddress"]', tokenAddress);
      await page.fill('input[name="entryFee"]', '100');
      await page.fill('input[name="protocolFeeRecipient"]', delegateWallet.address);
      
      // Click deploy button
      await page.click('button:has-text("Deploy TEMPL")');
      
      // Wait for transaction
      await page.waitForSelector('text=Contract deployed successfully', { timeout: 30000 });
      
      // Get deployed contract address
      templAddress = await page.locator('[data-testid="contract-address"]').textContent();
      
      // Show deployed contract
      await page.screenshot({ path: 'screenshots/contract-deployed.png', fullPage: true });
    });

    await test.step('4. Member Purchases Access', async () => {
      // Switch to member wallet
      await page.evaluate((address) => {
        window.localStorage.setItem('walletAddress', address);
        window.dispatchEvent(new Event('walletConnected'));
      }, memberWallet.address);
      
      // Navigate to TEMPL page
      await page.goto(`/templ/${templAddress}`);
      
      // Approve token spending
      await page.click('button:has-text("Approve Tokens")');
      await page.waitForSelector('text=Tokens approved', { timeout: 15000 });
      
      // Purchase access
      await page.click('button:has-text("Purchase Access")');
      await page.waitForSelector('text=Access granted', { timeout: 15000 });
      
      await page.screenshot({ path: 'screenshots/access-purchased.png', fullPage: true });
    });

    await test.step('5. Send Message in Group', async () => {
      // Access messaging interface
      await page.click('button:has-text("Open Chat")');
      
      // Type and send message
      await page.fill('textarea[placeholder="Type your message..."]', 
        'Hello! This is a demonstration of TEMPL\'s secure group messaging.');
      await page.click('button:has-text("Send")');
      
      // Verify message appears
      await expect(page.locator('text=Hello! This is a demonstration')).toBeVisible();
      
      await page.screenshot({ path: 'screenshots/message-sent.png', fullPage: true });
    });

    await test.step('6. Create Governance Proposal', async () => {
      // Open governance panel
      await page.click('button:has-text("Governance")');
      
      // Create proposal
      await page.fill('input[name="proposalTitle"]', 'Enable Emergency Pause');
      await page.fill('textarea[name="proposalDescription"]', 
        'This proposal will enable the emergency pause feature for added security.');
      
      // Set voting period
      await page.fill('input[name="votingPeriod"]', '7');
      
      // Submit proposal
      await page.click('button:has-text("Create Proposal")');
      await page.waitForSelector('text=Proposal created', { timeout: 15000 });
      
      await page.screenshot({ path: 'screenshots/proposal-created.png', fullPage: true });
    });

    await test.step('7. Vote on Proposal', async () => {
      // Cast vote
      await page.click('button:has-text("Vote Yes")');
      await page.waitForSelector('text=Vote cast successfully', { timeout: 15000 });
      
      // Show voting results
      await expect(page.locator('text=Votes For: 1')).toBeVisible();
      
      await page.screenshot({ path: 'screenshots/vote-cast.png', fullPage: true });
    });

    await test.step('8. Delegate Moderation Powers', async () => {
      // Switch back to priest wallet
      await page.evaluate((address) => {
        window.localStorage.setItem('walletAddress', address);
        window.dispatchEvent(new Event('walletConnected'));
      }, priestWallet.address);
      
      // Open moderation panel
      await page.click('button:has-text("Moderation")');
      
      // Delegate powers
      await page.fill('input[name="delegateAddress"]', delegateWallet.address);
      await page.click('button:has-text("Add Delegate")');
      
      await page.waitForSelector('text=Delegate added', { timeout: 15000 });
      
      await page.screenshot({ path: 'screenshots/delegate-added.png', fullPage: true });
    });

    await test.step('9. Execute Moderation Action', async () => {
      // Switch to delegate wallet
      await page.evaluate((address) => {
        window.localStorage.setItem('walletAddress', address);
        window.dispatchEvent(new Event('walletConnected'));
      }, delegateWallet.address);
      
      // Mute a member (demo only)
      await page.fill('input[name="muteAddress"]', '0x0000000000000000000000000000000000000001');
      await page.click('button:has-text("Mute Member")');
      
      await page.waitForSelector('text=Member muted', { timeout: 15000 });
      
      // Show mute list
      await expect(page.locator('text=Muted for 24 hours')).toBeVisible();
      
      await page.screenshot({ path: 'screenshots/moderation-applied.png', fullPage: true });
    });

    await test.step('10. Demo Complete', async () => {
      // Show summary screen
      await page.goto('/');
      
      // Add completion message
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
          <h1>TEMPL Demo Complete! 🎉</h1>
          <p style="margin-top: 20px; font-size: 18px; font-weight: normal;">
            Successfully demonstrated:
          </p>
          <ul style="text-align: left; margin-top: 20px; font-size: 16px; font-weight: normal;">
            <li>✅ Smart Contract Deployment</li>
            <li>✅ Token-Gated Access Control</li>
            <li>✅ Secure Group Messaging</li>
            <li>✅ On-Chain Governance</li>
            <li>✅ Delegated Moderation</li>
          </ul>
        `;
        document.body.appendChild(banner);
      });
      
      await page.waitForTimeout(5000); // Keep banner visible for recording
      await page.screenshot({ path: 'screenshots/demo-complete.png', fullPage: true });
    });
  });
});