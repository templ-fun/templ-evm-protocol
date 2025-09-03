import { test, expect } from './fixtures.js';
import { Client as NodeClient } from '@xmtp/node-sdk';
import { ethers } from 'ethers';

test('XMTP add-after-join minimal repro (local)', async ({ page, wallets }) => {
  // Require explicit local flag to run this repro deterministically
  if (process.env.E2E_XMTP_LOCAL !== '1') {
    test.skip(true, 'Skipping local XMTP repro; set E2E_XMTP_LOCAL=1 to run');
  }

  // 1) Browser: connect to app so Browser SDK registers
  await page.goto('./');
  await page.waitForLoadState('domcontentloaded');
  const uiWallet = wallets.priest;
  const signFn = 'repro_sign';
  const addr = await uiWallet.getAddress();
  await page.exposeFunction(signFn, async ({ message }) => {
    if (typeof message === 'string' && message.startsWith('0x')) {
      return await uiWallet.signMessage(ethers.getBytes(message));
    }
    return await uiWallet.signMessage(message);
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
  await expect(page.locator('.status')).toContainText('Messaging client ready', { timeout: 15000 });
  const browserInboxId = await page.evaluate(() => window.__XMTP?.inboxId || null);
  expect(browserInboxId).toBeTruthy();
  console.log('REPRO: Browser inboxId=', browserInboxId);

  // 2) Node: create a server client (env=local) and create a group without the browser
  const provider = new ethers.JsonRpcProvider('http://127.0.0.1:8545');
  const server = ethers.Wallet.createRandom().connect(provider);
  // fund server
  const funder = new ethers.Wallet(
    '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    provider
  );
  await (await funder.sendTransaction({ to: await server.getAddress(), value: ethers.parseEther('10') })).wait();

  const dbEncryptionKey = new Uint8Array(32);
  const serverAddr = (await server.getAddress()).toLowerCase();
  const xmtpServer = await NodeClient.create({
    type: 'EOA',
    getIdentifier: () => ({ identifier: serverAddr, identifierKind: 0, nonce: 1 }),
    signMessage: async (msg) => ethers.getBytes(await server.signMessage(typeof msg === 'string' ? msg : ethers.toBeHex(msg)))
  }, { env: 'local', dbEncryptionKey, loggingLevel: 'off', appVersion: 'templ/repro-0.1.0' });

  // Create a group with only the server (creator) participating
  let group;
  try {
    group = await xmtpServer.conversations.newGroup([]);
  } catch {
    // Fallback: include server itself explicitly if empty array not supported
    group = await xmtpServer.conversations.newGroup([xmtpServer.inboxId]);
  }
  const groupId = group.id;
  await xmtpServer.conversations.sync();
  console.log('REPRO: Server created group', groupId, 'serverInbox=', xmtpServer.inboxId);

  // 3) Add the browser member after creation
  const aggBefore = xmtpServer.debugInformation.apiAggregateStatistics();
  await group.addMembers([browserInboxId]);
  await xmtpServer.conversations.sync();
  const aggAfter = xmtpServer.debugInformation.apiAggregateStatistics();
  console.log('REPRO: Node aggregate stats before/after add:\n', aggBefore, '\n---\n', aggAfter);
  try { await group.send('repro-warm'); } catch {}

  // 4) Browser attempts to discover this group by id within 10s
  const found = await page.evaluate(async (gid) => {
    if (!window.__xmtpGetById || !window.__xmtpList) return { error: 'debug helpers not available' };
    for (let i = 0; i < 10; i++) {
      try { const byId = await window.__xmtpGetById(gid); if (byId) return { ok: true, attempt: i+1, byId: true }; } catch {}
      try { const ids = await window.__xmtpList(); if (ids.includes(gid)) return { ok: true, attempt: i+1, list: true }; } catch {}
      await new Promise((r) => setTimeout(r, 1000));
    }
    return { ok: false };
  }, groupId);
  console.log('REPRO: discovery result', found);
  expect(found.ok, `Group ${groupId} not discovered by browser within window`).toBe(true);
});
