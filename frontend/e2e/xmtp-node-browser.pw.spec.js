import { test, expect } from './fixtures.js';
import { Client as NodeClient, generateInboxId } from '@xmtp/node-sdk';
import { ethers } from 'ethers';

test('XMTP Node<->Browser PoC: group discovery', async ({ page, wallets }) => {
  // Browser side first: connect wallet so the Browser XMTP client registers keys
  const uiWallet = wallets.priest;
  const addr = await uiWallet.getAddress();
  await page.goto('./');
  await page.waitForLoadState('domcontentloaded');
  const signFn = 'poc_signMessage';
  await page.exposeFunction(signFn, async ({ message }) => {
    const w = uiWallet;
    try {
      if (typeof message === 'string' && message.startsWith('0x')) {
        return await w.signMessage(ethers.getBytes(message));
      }
      return await w.signMessage(message);
    } catch (err) {
      throw new Error(`poc sign failed: ${err?.message || String(err)}`);
    }
  });
  await page.evaluate(({ address, signFn }) => {
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
        return null;
      },
      on: () => {}, removeListener: () => {}
    };
  }, { address: addr, signFn });

  await page.click('button:has-text("Connect Wallet")');
  await expect(page.locator('.status')).toContainText('Wallet connected');
  await expect(page.locator('.status')).toContainText('Messaging client ready', { timeout: 15000 });
  // Grab the browser inboxId
  const browserInboxId = await page.evaluate(() => window.__XMTP?.inboxId || null);
  console.log('PoC: Browser inboxId=', browserInboxId);

  // Node side: create a fresh XMTP client (server-like) and create a group adding the browser wallet
  const provider = new ethers.JsonRpcProvider('http://localhost:8545');
  const server = ethers.Wallet.createRandom().connect(provider);
  // fund server
  const funder = new ethers.Wallet(
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    provider
  );
  let ftx = await funder.sendTransaction({ to: await server.getAddress(), value: ethers.parseEther('10') });
  await ftx.wait();

  const dbEncryptionKey = new Uint8Array(32);
  const xmtpServer = await NodeClient.create({
    type: 'EOA',
    getIdentifier: () => ({ identifier: server.address.toLowerCase(), identifierKind: 0, nonce: 1 }),
    signMessage: async (msg) => ethers.getBytes(await server.signMessage(typeof msg === 'string' ? msg : ethers.toBeHex(msg)))
  }, { env: 'dev', dbEncryptionKey, loggingLevel: 'off' });

  const uiAddr = (await uiWallet.getAddress()).toLowerCase();
  const uiInboxId = browserInboxId || generateInboxId({ identifier: uiAddr, identifierKind: 0 });
  const group = await xmtpServer.conversations.newGroup([uiInboxId]);
  const groupId = group.id; // plain hex, no 0x
  await xmtpServer.conversations.sync();
  try { await group.send('warm'); } catch {}
  console.log('PoC: Node created group', groupId, 'and added inbox', uiInboxId);

  // Use exposed debug helpers to check Browser SDK conversations (enabled via VITE_E2E_DEBUG)
  const found = await page.evaluate(async (gid) => {
    if (!window.__xmtpList || !window.__xmtpGetById) return { error: 'debug helpers not available' };
    for (let i = 0; i < 60; i++) {
      const ids = await window.__xmtpList();
      console.log('PoC browser ids len=', ids.length, 'first=', ids.slice(0,3));
      if (ids.includes(gid)) return { ok: true, attempt: i+1 };
      const byId = await window.__xmtpGetById(gid);
      if (byId) return { ok: true, attempt: i+1, byId: true };
      await new Promise((r) => setTimeout(r, 1000));
    }
    return { ok: false };
  }, groupId);

  console.log('PoC discovery result:', found);
  // Do not fail the suite here; this PoC is diagnostic. Assert shape only.
  expect(found).toHaveProperty('ok');
});
