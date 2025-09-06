import { test, expect, TestToken } from './fixtures.js';
import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import path from 'path';

const VERBOSE = process.env.PW_E2E_VERBOSE === '1';

test.describe('Tech Demo: Realtime multi-user flow', () => {
  test('Create, join, chat, claim fees, move treasury, vote, execute', async ({ page, provider, wallets }) => {
    if (VERBOSE) page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', err => console.log('PAGE ERROR:', err.message));

    // Load TEMPL ABI
    const templAbi = JSON.parse(readFileSync(path.join(process.cwd(), 'src/contracts/TEMPL.json'))).abi;

    // Deploy a fresh ERC-20 TestToken as access token
    const tokenFactory = new ethers.ContractFactory(TestToken.abi, TestToken.bytecode, wallets.priest);
    const token = await tokenFactory.deploy('Test', 'TEST', 18);
    await token.waitForDeployment();
    const tokenAddress = await token.getAddress();

    // Prepare 5 additional users and fund them with ETH
    const funder = new ethers.Wallet('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', provider);
    const u1 = ethers.Wallet.createRandom().connect(provider);
    const u2 = ethers.Wallet.createRandom().connect(provider);
    const u3 = ethers.Wallet.createRandom().connect(provider); // proposer
    const u4 = ethers.Wallet.createRandom().connect(provider);
    const u5 = ethers.Wallet.createRandom().connect(provider);
    const users = [u1, u2, u3, u4, u5];
    let nonceF = await funder.getNonce();
    for (const u of users) {
      const tx = await funder.sendTransaction({ to: await u.getAddress(), value: ethers.parseEther('10'), nonce: nonceF++ });
      await tx.wait();
    }

    // Helper to switch window.ethereum to a given wallet
    const registered = new Set();
    async function switchWallet(label, w, opts = { reload: true }) {
      const addr = await w.getAddress();
      const signFnName = `e2e_${label}_sign`;
      const sendFnName = `e2e_${label}_send`;
      // Ensure UI state resets between identities
      if (opts.reload !== false) {
        await page.reload();
        await page.waitForLoadState('domcontentloaded');
      }
      if (!registered.has(signFnName)) {
        await page.exposeFunction(signFnName, async ({ message }) => {
          if (typeof message === 'string' && message.startsWith('0x')) {
            return await w.signMessage(ethers.getBytes(message));
          }
          return await w.signMessage(message);
        });
        registered.add(signFnName);
      }
      if (!registered.has(sendFnName)) {
        await page.exposeFunction(sendFnName, async (tx) => {
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
        registered.add(sendFnName);
      }
      await page.evaluate(({ address, signFnName, sendFnName }) => {
        window.ethereum = {
          isMetaMask: true,
          selectedAddress: address,
          request: async ({ method, params }) => {
            if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [address];
            if (method === 'eth_chainId') return '0x7a69';
            if (method === 'personal_sign' || method === 'eth_sign') {
              const data = (params && params[0]) || '';
              // @ts-ignore
              return await window[signFnName]({ message: data });
            }
            if (method === 'eth_sendTransaction') {
              const [tx] = params || [];
              // @ts-ignore
              return await window[sendFnName](tx);
            }
            const response = await fetch('http://127.0.0.1:8545', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }) });
            const result = await response.json();
            if (result.error) throw new Error(result.error.message);
            return result.result;
          },
          on: () => {},
          removeListener: () => {}
        };
      }, { address: addr, signFnName, sendFnName });
      // Connect in the UI
      try { await page.click('button:has-text("Connect Wallet")'); } catch {}
    }

    // Navigate to app base
    await page.goto('./');
    await page.waitForLoadState('domcontentloaded');

    // Rotate UI wallet to the priest and create templ
    await switchWallet('priest', wallets.priest);
    await page.click('button:has-text("Create")');
    await expect(page.locator('h2:has-text("Create Templ")')).toBeVisible();
    await expect(page.locator('.status')).toContainText('Messaging client ready', { timeout: 5000 });
    await page.fill('input[placeholder*="Token address"]', tokenAddress);
    await page.fill('input[placeholder*="Protocol fee recipient"]', await wallets.priest.getAddress());
    await page.fill('input[placeholder*="Entry fee"]', '100');
    await page.click('button:has-text("Deploy")');
    // Resolve contract address deterministically via localStorage (set by the app on deploy)
    let templAddress = '';
    for (let i = 0; i < 75 && !templAddress; i++) {
      templAddress = await page.evaluate(() => localStorage.getItem('templ:lastAddress'));
      if (!templAddress) await page.waitForTimeout(200);
    }
    expect(ethers.isAddress(templAddress)).toBe(true);

    // Mint access tokens to priest + members
    const addressesToFund = [await wallets.priest.getAddress(), ...(await Promise.all(users.map(u => u.getAddress())))];
    let mintNonce = await wallets.priest.getNonce();
    for (const addr of addressesToFund) {
      const tx = await token.mint(addr, ethers.parseEther('1000'), { nonce: mintNonce++ });
      await tx.wait();
    }

    // Pre-approve and purchase membership on-chain for all to guarantee treasury funding
    const entryFee = 100n;
    // priest
    {
      const erc20 = new ethers.Contract(tokenAddress, ['function approve(address,uint256) returns (bool)'], wallets.priest);
      let n = await wallets.priest.getNonce();
      await (await erc20.approve(templAddress, entryFee, { nonce: n++ })).wait();
      const templPriest = new ethers.Contract(templAddress, templAbi, wallets.priest);
      await (await templPriest.purchaseAccess({ nonce: n++ })).wait();
    }
    for (const u of users) {
      const erc20 = new ethers.Contract(tokenAddress, ['function approve(address,uint256) returns (bool)'], u);
      let n = await u.getNonce();
      await (await erc20.approve(templAddress, entryFee, { nonce: n++ })).wait();
      const templU = new ethers.Contract(templAddress, templAbi, u);
      await (await templU.purchaseAccess({ nonce: n++ })).wait();
    }
    // Ensure all purchases accounted
    {
      const templPriest = new ethers.Contract(templAddress, templAbi, wallets.priest);
      await expect.poll(async () => Number(await templPriest.totalPurchases()), { timeout: 20000 }).toBe(6);
    }

    // Priest purchases and joins via UI
    await page.click('button:has-text("Join")');
    await page.fill('input[placeholder*="Contract address"]', templAddress);
    await page.click('button:has-text("Purchase & Join")');
    // Resolve groupId via debug endpoint
    let groupId = '';
    for (let i = 0; i < 120 && !groupId; i++) {
      try {
        const dbg = await fetch(`http://localhost:3001/debug/group?contractAddress=${templAddress}&refresh=1`).then(r => r.json());
        groupId = dbg.resolvedGroupId || dbg.storedGroupId || '';
        if (groupId && groupId.startsWith('0x')) groupId = groupId.slice(2);
      } catch {}
      if (!groupId) await page.waitForTimeout(1000);
    }
    expect(groupId && groupId.length > 0).toBe(true);
    // Discover conversation in browser context if status isn't yet marked connected
    let discovered = false;
    try { await expect(page.locator('[data-testid="group-connected"]')).toBeVisible({ timeout: 3000 }); discovered = true; } catch {}
    if (!discovered) {
      try {
        discovered = await page.evaluate(async (gid) => {
          if (!window.__xmtpGetById) return false;
          for (let i = 0; i < 5; i++) {
            try { const c = await window.__xmtpGetById(gid); if (c) return true; } catch {}
            await new Promise(r => setTimeout(r, 200));
          }
          return false;
        }, groupId);
      } catch { discovered = false; }
    }
    if (!discovered) throw new Error('Browser did not discover group conversation');

    // Helper to join and send a chat message for a user
    async function joinAndChat(label, w, message, { sendMessage: doSend = true } = {}) {
      // Avoid full reloads for speed and stability
      await switchWallet(label, w, { reload: true });
      // Ensure the app binds to this wallet and creates an XMTP client for it
      try { await page.click('button:has-text("Connect Wallet")'); } catch {}
      await expect(page.locator('.status')).toContainText('Messaging client ready', { timeout: 5000 });
      // Join via UI (idempotent)
      await page.click('button:has-text("Join")');
      await page.fill('input[placeholder*="Contract address"]', templAddress);
      await page.click('button:has-text("Purchase & Join")');
      // Optionally send a message via the chat UI
      await page.click('button:has-text("Chat")');
      // Ensure group discovery before attempting to chat
      let connected = false;
      try { await expect(page.locator('[data-testid="group-connected"]')).toBeVisible({ timeout: 3000 }); connected = true; } catch {}
      if (!connected) {
        try {
          connected = await page.evaluate(async (gid) => {
            if (!window.__xmtpGetById) return false;
            for (let i = 0; i < 5; i++) {
              try { const c = await window.__xmtpGetById(gid); if (c) return true; } catch {}
              await new Promise(r => setTimeout(r, 200));
            }
            return false;
          }, groupId);
        } catch { connected = false; }
      }
      // Optionally send a message via the chat UI (robust: retry until app reports success)
      if (doSend && message) {
        const base = `${message} ${Date.now()}`;
        let sent = false; let body = base;
        for (let i = 0; i < 10 && !sent; i++) {
          await page.fill('[data-testid="chat-input"]', body);
          await page.click('[data-testid="chat-send"]');
          try { await expect(page.locator('.status')).toContainText('Message sent', { timeout: 5000 }); sent = true; } catch {}
          if (!sent) { await page.waitForTimeout(3000); body = base + ' #' + (i+1); }
        }
        await expect(sent, `${label} message not sent`).toBeTruthy();
        await expect(page.locator('.messages')).toContainText(message, { timeout: 5000 });
      }
    }

    // Keep this lean for stability: have two members send real GMs via the UI-bound XMTP client
    await joinAndChat('u1', u1, 'GM from u1');
    await joinAndChat('u2', u2, 'GM from u2');
    await joinAndChat('u3', u3, 'GM from u3');
    // Finally connect a viewer wallet to render (no send)
    await joinAndChat('u5', u5, '', { sendMessage: false });
    // Validate that u5 can render messages authored by others
    await page.click('button:has-text("Chat")');
    await expect(page.locator('.messages')).toContainText('GM from u1', { timeout: 5000 });
    await expect(page.locator('.messages')).toContainText('GM from u3', { timeout: 5000 });

    // First user claims fees (u1) via top bar button
    await switchWallet('u1', u1);
    await page.click('button:has-text("Chat")');
    const claimTop = page.locator('[data-testid="claimable-amount"]');
    await expect(claimTop).toBeVisible({ timeout: 5000 });
    let topVal = (await claimTop.textContent() || '').trim();
    if (topVal !== '0') {
      try { await page.click('[data-testid="claim-fees-top"]'); } catch {}
      await expect.poll(async () => (await claimTop.textContent() || '').trim(), { timeout: 10000 }).toBe('0');
    }

    // Propose moving treasury to proposer's wallet (u3) via UI for the demo
    await switchWallet('u3', u3);
    await page.click('button:has-text("Chat")');
    await page.click('button:has-text("Propose vote")');
    await page.fill('input[placeholder="Title"]', 'Move Treasury to me');
    await page.click('button:has-text("Move Treasury To Me")');
    await page.click('button:has-text("Submit Proposal")');
    // Wait until a new proposal is registered on-chain
    const templForPriest = new ethers.Contract(templAddress, templAbi, wallets.priest);
    await expect.poll(async () => Number(await templForPriest.proposalCount()), { timeout: 30000 }).toBeGreaterThan(0);
    // Try to vote yes via UI as proposer so the poll shows interaction
    try {
      await expect(page.locator('.chat-item--poll')).toBeVisible({ timeout: 60000 });
      await page.click('.chat-item--poll >> text=Vote Yes');
    } catch {}

    // Record treasury before execution
    const treasuryBefore = await templForPriest.treasuryBalance();
    expect(treasuryBefore).toBeGreaterThan(0n);

    // Resolve latest proposal id
    const lastId = Number(await templForPriest.proposalCount()) - 1;
    // Cast votes on-chain
    const templU3 = new ethers.Contract(templAddress, templAbi, u3);
    const templU1 = new ethers.Contract(templAddress, templAbi, u1);
    const templU2 = new ethers.Contract(templAddress, templAbi, u2);
    const templU4 = new ethers.Contract(templAddress, templAbi, u4);
    const templU5 = new ethers.Contract(templAddress, templAbi, u5);
    // proposer may have already voted via UI; still safe to skip errors by try/catch
    try { await (await templU3.vote(lastId, true)).wait(); } catch {}
    await (await templU1.vote(lastId, true)).wait();
    await (await templU2.vote(lastId, true)).wait();
    await (await templU4.vote(lastId, false)).wait();
    await (await templU5.vote(lastId, false)).wait();

    // Advance time and execute via priest
    await fetch('http://127.0.0.1:8545', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'evm_increaseTime', params: [7 * 24 * 60 * 60] }) });
    await fetch('http://127.0.0.1:8545', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'evm_mine', params: [] }) });
    const balBefore = await token.balanceOf(await u3.getAddress());
    const execTx = await templForPriest.executeProposal(lastId);
    await execTx.wait();

    // Validate execution: treasury emptied and proposer received funds
    const treasuryAfter = await templForPriest.treasuryBalance();
    expect(treasuryAfter).toBe(0n);
    const balAfter = await token.balanceOf(await u3.getAddress());
    expect(balAfter - balBefore).toBe(treasuryBefore);

    // Send a celebratory chat message as priest (ensure discovery first)
    await switchWallet('priest', wallets.priest);
    await page.click('button:has-text("Chat")');
    let priestDiscovered = false;
    try { await expect(page.locator('[data-testid="group-connected"]')).toBeVisible({ timeout: 3000 }); priestDiscovered = true; } catch {}
    if (!priestDiscovered) {
      try {
        priestDiscovered = await page.evaluate(async (gid) => {
          if (!window.__xmtpGetById) return false;
          for (let i = 0; i < 5; i++) {
            try { const c = await window.__xmtpGetById(gid); if (c) return true; } catch {}
            await new Promise(r => setTimeout(r, 200));
          }
          return false;
        }, groupId);
      } catch { priestDiscovered = false; }
    }
    if (priestDiscovered) {
      const body1 = `Treasury moved! ${Date.now()}`;
      await page.fill('[data-testid="chat-input"]', body1);
      await page.click('[data-testid="chat-send"]');
      await expect(page.locator('.messages')).toContainText('Treasury moved!', { timeout: 5000 });
      // Stay on priest for the final capture; GMs have already been sent by other wallets over XMTP
    }

    // Final assertion: poll reflects votes (counts from on-chain) and screenshot the final state
    await expect(page.locator('.chat-item--poll')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="poll-legend"]')).toContainText('Yes 3 · No 2', { timeout: 5000 });
    // Confirm message history includes GM texts from multiple users (not from You)
    await expect(page.locator('.messages')).toContainText('GM from u1', { timeout: 5000 });
    await expect(page.locator('.messages')).toContainText('GM from u2', { timeout: 5000 });
    await expect(page.locator('.messages')).toContainText('GM from u3', { timeout: 5000 });

    await page.screenshot({ path: 'test-results/tech-demo-complete.png', fullPage: true });
  });
});
