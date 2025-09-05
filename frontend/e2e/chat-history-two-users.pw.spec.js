import { test, expect, TestToken } from './fixtures.js';
import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import path from 'path';

test.describe('Chat History - Two Users', () => {
  test('both users see each other after reload', async ({ page, wallets }) => {
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', err => console.log('PAGE ERROR:', err.message));

    // Deploy TestToken with Node ethers
    const tokenFactory = new ethers.ContractFactory(
      TestToken.abi,
      TestToken.bytecode,
      wallets.priest
    );
    const token = await tokenFactory.deploy('Test', 'TEST', 18);
    await token.waitForDeployment();
    const tokenAddress = await token.getAddress();

    // Pre-mint tokens to both UI wallets
    const priestAddr = await wallets.priest.getAddress();
    const memberAddr = await wallets.member.getAddress();
    let nonce = await wallets.priest.getNonce();
    let txm = await token.mint(priestAddr, ethers.parseEther('1000000'), { nonce: nonce++ });
    await txm.wait();
    txm = await token.mint(memberAddr, ethers.parseEther('1000000'), { nonce: nonce++ });
    await txm.wait();

    // Helpers to inject a wallet as window.ethereum
    async function bridgeWallet(w, label) {
      const signFn = `e2e_sign_${label}`;
      const sendFn = `e2e_send_${label}`;
      await page.exposeFunction(signFn, async ({ message }) => {
        if (typeof message === 'string' && message.startsWith('0x')) {
          return await w.signMessage(ethers.getBytes(message));
        }
        return await w.signMessage(message);
      });
      await page.exposeFunction(sendFn, async (tx) => {
        const req = {
          to: tx.to || undefined,
          data: tx.data || undefined,
          value: tx.value ? BigInt(tx.value) : undefined,
          gasPrice: tx.gasPrice ? BigInt(tx.gasPrice) : undefined,
          gasLimit: tx.gas || tx.gasLimit ? BigInt(tx.gas || tx.gasLimit) : undefined,
        };
        const resp = await w.sendTransaction(req);
        return resp.hash;
      });
      const address = await w.getAddress();
      await page.evaluate(async ({ address, signFn, sendFn }) => {
        window.ethereum = {
          isMetaMask: true,
          selectedAddress: address,
          request: async ({ method, params }) => {
            if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [address];
            if (method === 'eth_chainId') return '0x7a69';
            if (method === 'personal_sign' || method === 'eth_sign') {
              const data = (params && params[0]) || '';
              // @ts-ignore
              return await window[signFn]({ message: data });
            }
            if (method === 'eth_sendTransaction') {
              const [tx] = params || [];
              // @ts-ignore
              return await window[sendFn](tx);
            }
            // passthrough JSON-RPC
            const response = await fetch('http://127.0.0.1:8545', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 })
            });
            const result = await response.json();
            if (result.error) throw new Error(result.error.message);
            return result.result;
          },
          on: () => {},
          removeListener: () => {}
        };
      }, { address, signFn, sendFn });
    }

    // Open app base
    await page.goto('./');
    await page.waitForLoadState('domcontentloaded');

    // Wallet A (priest): connect and deploy via UI
    await bridgeWallet(wallets.priest, 'a');
    await page.click('button:has-text("Connect Wallet")');
    await expect(page.locator('.status')).toContainText('Messaging client ready', { timeout: 20000 });
    await page.click('button:has-text("Create")');
    await page.fill('input[placeholder*="Token address"]', tokenAddress);
    await page.fill('input[placeholder*="Protocol fee recipient"]', '0x70997970C51812dc3A010C7d01b50e0d17dc79C8');
    await page.fill('input[placeholder*="Entry fee"]', '100');
    await page.click('button:has-text("Deploy")');

    // Grab deployed address from data attribute or localStorage
    const depInfo = page.locator('[data-testid="deploy-info"]');
    await expect(depInfo).toBeVisible({ timeout: 30000 });
    let templAddress = (await depInfo.getAttribute('data-contract-address')) || '';
    if (!templAddress) {
      templAddress = await page.evaluate(() => localStorage.getItem('templ:lastAddress'));
    }
    expect(templAddress && templAddress.length > 0).toBe(true);

    // Pre-purchase membership on Node for member to avoid UI nonce/queuing
    const templAbi = JSON.parse(readFileSync(path.join(process.cwd(), 'src/contracts/TEMPL.json'))).abi;
    {
      const member = wallets.member;
      const templMember = new ethers.Contract(templAddress, templAbi, member);
      const tokenMember = new ethers.Contract(tokenAddress, ['function approve(address,uint256) returns (bool)'], member);
      const provider = templMember.runner.provider;
      const memberAddr2 = await member.getAddress();
      let n = await provider.getTransactionCount(memberAddr2);
      let tx = await tokenMember.approve(templAddress, 100, { nonce: n++ });
      await tx.wait();
      tx = await templMember.purchaseAccess({ nonce: n++ });
      await tx.wait();
    }

    // Switch to Wallet B (member) and join via UI
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await bridgeWallet(wallets.member, 'b');
    await page.click('button:has-text("Connect Wallet")');
    await expect(page.locator('.status')).toContainText('Messaging client ready', { timeout: 20000 });
    await page.click('button:has-text("Join")');
    await page.fill('input[placeholder*="Contract address"]', templAddress);
    await page.click('button:has-text("Purchase & Join")');

    // Wait for group connection then send a message from member
    await page.click('button:has-text("Chat")');
    // Retry send until the app reports success (group discovery can lag)
    const sendBtn1 = page.locator('[data-testid="chat-send"]');
    await expect(sendBtn1).toBeEnabled({ timeout: 60000 });
    const msgB = 'Member says hello ' + Date.now();
    let sentOk = false;
    const maxTries = 10;
    for (let i = 0; i < maxTries && !sentOk; i++) {
      await page.fill('[data-testid="chat-input"]', msgB);
      await page.click('[data-testid="chat-send"]');
      try {
        await expect(page.locator('.status')).toContainText('Message sent', { timeout: 5000 });
        sentOk = true;
      } catch {
        await page.waitForTimeout(3000);
      }
    }
    await expect(sentOk, 'message was not sent by member').toBeTruthy();
    await expect(page.locator('.messages')).toContainText(msgB, { timeout: 60000 });

    // Switch to Wallet A (priest), reload and verify history contains member message
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await bridgeWallet(wallets.priest, 'a2');
    await page.click('button:has-text("Connect Wallet")');
    await expect(page.locator('.status')).toContainText('Messaging client ready', { timeout: 20000 });
    await page.click('button:has-text("Chat")');
    await expect.poll(async () => {
      return await page.evaluate(async () => {
        try {
          const el = document.querySelector('.messages');
          return el && el.textContent ? el.textContent : '';
        } catch { return ''; }
      });
    }, { timeout: 120000 }).toContain(msgB);

    // Send priest reply, switch back to member, reload, and verify
    const msgA = 'Priest replies ' + Date.now();
    let sentA = false;
    for (let i = 0; i < 10 && !sentA; i++) {
      await page.fill('[data-testid="chat-input"]', msgA);
      await page.click('[data-testid="chat-send"]');
      try {
        await expect(page.locator('.status')).toContainText('Message sent', { timeout: 5000 });
        sentA = true;
      } catch {
        await page.waitForTimeout(3000);
      }
    }
    await expect(sentA, 'priest message not sent').toBeTruthy();
    await expect(page.locator('.messages')).toContainText(msgA, { timeout: 60000 });

    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await bridgeWallet(wallets.member, 'b2');
    await page.click('button:has-text("Connect Wallet")');
    await expect(page.locator('.status')).toContainText('Messaging client ready', { timeout: 20000 });
    await page.click('button:has-text("Chat")');
    await expect.poll(async () => {
      return await page.evaluate(async () => {
        try {
          const el = document.querySelector('.messages');
          return el && el.textContent ? el.textContent : '';
        } catch { return ''; }
      });
    }, { timeout: 120000 }).toContain(msgA);
  });
});
