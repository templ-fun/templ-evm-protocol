import { test, expect, TestToken, TemplFactory } from './fixtures.js';
import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import path from 'path';

// Reduce noisy logs by default; enable with PW_E2E_VERBOSE=1
const VERBOSE = process.env.PW_E2E_VERBOSE === '1';
const dbg = (...args) => { if (VERBOSE) console.log(...args); };

test.describe('TEMPL E2E - All 7 Core Flows', () => {
  let templAddress;
  let templAbi;
  let memberInboxId = '';
  let priestInboxId = '';

  test('All 7 Core Flows', async ({ page, wallets }) => {

    const waitForUiReady = async (label) => {
      await expect.poll(async () => {
        const state = await page.evaluate(() => {
          const ready = typeof window !== 'undefined' ? window.__templReady : null;
          const statusText = document.querySelector('.status')?.textContent || '';
          return {
            signer: Boolean(ready?.signerReady),
            xmtp: Boolean(ready?.xmtpReady),
            status: statusText
          };
        });
        dbg(`[${label}] readiness`, state);
        if (state.signer && state.xmtp) return true;
        if (state.status.includes('Wallet connected') && state.status.includes('Messaging client ready')) return true;
        return false;
      }, { timeout: 120000 }).toBe(true);
    };
    const installWalletBridge = async ({ address, signFnName, signTypedFnName, sendFnName }) => {
      await page.evaluate(({ address, signFnName, signTypedFnName, sendFnName }) => {
        const TEST_ACCOUNT = address;
        window.ethereum = {
          isMetaMask: true,
          selectedAddress: TEST_ACCOUNT,
          request: async ({ method, params }) => {
            console.log('ETH method:', method);
            if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [TEST_ACCOUNT];
            if (method === 'eth_chainId') return '0x7a69';
            if (method === 'personal_sign') {
              const [data] = params || [];
              // @ts-ignore
              return await window[signFnName]({ message: data });
            }
            if (method === 'eth_sign') {
              const [, data] = params || [];
              // @ts-ignore
              return await window[signFnName]({ message: data });
            }
            if (method === 'eth_signTypedData' || method === 'eth_signTypedData_v4') {
              const [_addr, typed] = params || [];
              const payload = typeof typed === 'string' ? JSON.parse(typed) : typed;
              // @ts-ignore
              return await window[signTypedFnName]({ domain: payload.domain, types: payload.types, message: payload.message });
            }
            if (method === 'eth_sendTransaction') {
              const [tx] = params || [];
              // @ts-ignore
              return await window[sendFnName](tx);
            }
            const response = await fetch('http://localhost:8545', {
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
      }, { address, signFnName, signTypedFnName, sendFnName });
    };

    if (VERBOSE) page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
    if (VERBOSE) page.on('dialog', dialog => {
      console.log('PAGE DIALOG:', dialog.message());
      dialog.dismiss();
    });

    // Load TEMPL ABI for on-chain assertions
    templAbi = JSON.parse(readFileSync(path.join(process.cwd(), 'src/contracts/TEMPL.json'))).abi;

    // Deploy a fresh test token and factory
    const tokenFactory = new ethers.ContractFactory(
      TestToken.abi,
      TestToken.bytecode,
      wallets.priest
    );
    let deployNonce = await wallets.priest.getNonce();
    const token = await tokenFactory.deploy('Test', 'TEST', 18, { nonce: deployNonce++ });
    await token.waitForDeployment();
    const tokenAddress = await token.getAddress();

    const factoryFactory = new ethers.ContractFactory(
      TemplFactory.abi,
      TemplFactory.bytecode,
      wallets.priest
    );
    const templFactory = await factoryFactory.deploy(
      await wallets.delegate.getAddress(),
      1_000,
      { nonce: deployNonce++ }
    );
    await templFactory.waitForDeployment();
    const factoryAddress = await templFactory.getAddress();
    // Allow non-deployer wallets (including freshly generated UI accounts) to create templs.
    await (await templFactory.setPermissionless(true)).wait();

    // Rotate the UI-connected wallet until the app can initialize XMTP
    const sharedProvider = wallets.priest.provider;
    const freshUiWallet = ethers.Wallet.createRandom().connect(sharedProvider);
    {
      const fundingTx = await wallets.priest.sendTransaction({
        to: await freshUiWallet.getAddress(),
        value: ethers.parseEther('50')
      });
      await fundingTx.wait();
    }
    const candidates = [freshUiWallet, wallets.priest, wallets.delegate, wallets.member];
    let testWallet = null;
    let testAddress = '';

    // Navigate to app base once
    await page.goto('./');
    await page.waitForLoadState('domcontentloaded');

    for (let attempt = 0; attempt < candidates.length; attempt++) {
      const w = candidates[attempt];
      const addr = await w.getAddress();
      // Clear OPFS/IndexedDB storage to avoid XMTP OPFS access-handle locks between attempts
      try {
        await page.evaluate(async () => {
          try {
            if (navigator.storage && 'getDirectory' in navigator.storage) {
              // @ts-ignore
              const root = await navigator.storage.getDirectory();
              const names = [];
              // @ts-ignore
              for await (const [name] of root.entries()) names.push(name);
              for (const name of names) {
                try { /* @ts-ignore */ await root.removeEntry(name, { recursive: true }); } catch {}
              }
            }
            // Clear IndexedDB as well
            if (window.indexedDB) {
              const dbs = await window.indexedDB.databases?.() || [];
              for (const db of dbs) {
                try { window.indexedDB.deleteDatabase(db.name); } catch {}
              }
            }
            localStorage.clear?.();
            sessionStorage.clear?.();
          } catch {}
        });
      } catch {}
      // Bridge signing and tx sending from Node to the browser for this wallet
      const signFnName = `e2e_signMessage_${attempt}`;
      const signTypedFnName = `e2e_signTyped_${attempt}`;
      const sendFnName = `e2e_sendTransaction_${attempt}`;
      await page.exposeFunction(signFnName, async ({ message }) => {
        // Normalize message for signing
        try {
          if (typeof message === 'string' && message.startsWith('0x')) {
            return await w.signMessage(ethers.getBytes(message));
          }
          return await w.signMessage(message);
        } catch (err) {
          throw new Error(`signMessage failed: ${err?.message || String(err)}`);
        }
      });
      await page.exposeFunction(signTypedFnName, async ({ domain, types, message }) => {
        try {
          const sanitizedTypes = { ...(types || {}) };
          if (sanitizedTypes.EIP712Domain) delete sanitizedTypes.EIP712Domain;
          return await w.signTypedData(domain, sanitizedTypes, message);
        } catch (err) {
          throw new Error(`signTyped failed: ${err?.message || String(err)}`);
        }
      });
      let nextNonceForWallet = null;
      await page.exposeFunction(sendFnName, async (tx) => {
        try {
          const req = {
            to: tx.to || undefined,
            data: tx.data || undefined,
            value: tx.value ? BigInt(tx.value) : undefined,
            gasPrice: tx.gasPrice ? BigInt(tx.gasPrice) : undefined,
            gasLimit: tx.gas || tx.gasLimit ? BigInt(tx.gas || tx.gasLimit) : undefined,
          };
          let pendingNonce = await w.provider.getTransactionCount(addr, 'pending');
          if (nextNonceForWallet !== null && pendingNonce < nextNonceForWallet) {
            pendingNonce = nextNonceForWallet;
          }
          console.log('[wallet bridge] nonce selection', pendingNonce, nextNonceForWallet);
          req.nonce = pendingNonce;
          const resp = await w.sendTransaction(req);
          const usedNonce = typeof resp.nonce === 'bigint' ? Number(resp.nonce) : resp.nonce;
          if (Number.isFinite(usedNonce)) {
            nextNonceForWallet = usedNonce + 1;
          }
          return resp.hash;
        } catch (err) {
          throw new Error(`sendTransaction failed: ${err?.message || String(err)}`);
        }
      });

      // Inject/override window.ethereum for this candidate on the current page
      await installWalletBridge({ address: addr, signFnName, signTypedFnName, sendFnName });

      // Attempt connect
      dbg('Core Flow 1: Connect Wallet');
      await page.click('button:has-text("Connect Wallet")');
      // Navigate to /create in the new routed UI
      await page.evaluate(() => { window.__templSetAutoDeploy?.(true); });
      await page.click('button:has-text("Create")');
      try {
        await expect(page.locator('h2:has-text("Create Templ")')).toBeVisible();
        await expect(page.locator('.status')).toContainText('Wallet connected');
        // Wait for XMTP client to initialize deterministically
        await expect.poll(async () => await page.evaluate(() => Boolean(window.__XMTP?.inboxId)), { timeout: 15000 }).toBe(true);
        priestInboxId = await page.evaluate(() => window.__XMTP?.inboxId || '');
        testWallet = w;
        testAddress = addr;
        await page.evaluate(() => { window.__templSetAutoDeploy?.(true); });
        break;
      } catch {
        // Try next candidate
        await page.reload();
        await page.waitForLoadState('domcontentloaded');
      }
    }
    if (!testWallet) throw new Error('Failed to initialize XMTP for any candidate wallet');

    // Fund the selected UI wallet and the member with test tokens
    let tokenTx = await token.mint(testAddress, ethers.parseEther('1000'));
    await tokenTx.wait();
    tokenTx = await token.connect(wallets.member).mint(
      await wallets.member.getAddress(),
      ethers.parseEther('1000')
    );
    await tokenTx.wait();

    // Core Flow 2: Templ Creation
    dbg('Core Flow 2: Templ Creation');
    await page.fill('input[placeholder*="Token address"]', tokenAddress);
    if (await page.locator('input[placeholder*="Factory address"]:not([readonly])').count()) {
      await page.fill('input[placeholder*="Factory address"]', factoryAddress);
    }
    await page.fill('input[placeholder*="Entry fee"]', '100');
    // Use factory default values (30/30/30) which expect a 10% protocol fee for 100% total
    await page.fill('input[placeholder="Burn"]', '30');
    await page.fill('input[placeholder="Treasury"]', '30');
    await page.fill('input[placeholder="Member pool"]', '30');
    // Ensure default exponential curve is used (curve selection can stick across runs)
    const curveToggle = page.locator('label:has-text("Customize curve") input[type="checkbox"]');
    if (await curveToggle.count()) {
      const checked = await curveToggle.isChecked();
      if (checked) {
        await curveToggle.uncheck({ force: true });
      }
    }

    const entryFeeValue = await page.inputValue('input[placeholder*="Entry fee"]');
    const burnValue = await page.locator('input[placeholder="Burn"]').inputValue();
    const treasuryValue = await page.locator('input[placeholder="Treasury"]').inputValue();
    const memberValue = await page.locator('input[placeholder="Member pool"]').inputValue();
    const entryFeeWei = BigInt(entryFeeValue || '0');
    const burnPercentNum = Number(burnValue || '0');
    const treasuryPercentNum = Number(treasuryValue || '0');
    const memberPercentNum = Number(memberValue || '0');
    const burnPercentBps = Math.round(burnPercentNum * 100);
    const treasuryPercentBps = Math.round(treasuryPercentNum * 100);
    const memberPercentBps = Math.round(memberPercentNum * 100);

    // Factory defaults are 30/30/30 with 10% protocol fee = 100% total
    const defaultsRequested = burnPercentNum === 30 && treasuryPercentNum === 30 && memberPercentNum === 30;
    let predictedTempl;
    if (defaultsRequested) {
      predictedTempl = await templFactory.createTempl.staticCall(tokenAddress, entryFeeWei);
    } else {
      predictedTempl = await templFactory.createTemplWithConfig.staticCall({
        priest: testAddress,
        token: tokenAddress,
        entryFee: entryFeeWei,
        burnPercent: burnPercentBps,
        treasuryPercent: treasuryPercentBps,
        memberPoolPercent: memberPercentBps,
        priestIsDictator: false,
        curveProvided: false
      });
    }
    templAddress = ethers.getAddress(predictedTempl);

    await expect.poll(async () => {
      const addrLower = testAddress.toLowerCase();
      const latest = await wallets.priest.provider.getTransactionCount(addrLower, 'latest');
      const pending = await wallets.priest.provider.getTransactionCount(addrLower, 'pending');
      dbg('[priest join] nonce sync check', { latest, pending });
      return pending === latest;
    }, { timeout: 60000 }).toBe(true);

    await page.evaluate(() => { window.__templTrigger?.('deploy'); });
    dbg('[priest join] triggered deploy via __templTrigger');

    await expect.poll(async () => {
      const status = await page.locator('.status').textContent().catch(() => '');
      return status?.includes('✅ Templ deployed');
    }, { timeout: 120000 }).toBe(true);

    await expect.poll(async () => {
      const code = await wallets.priest.provider.getCode(templAddress);
      return code && code !== '0x';
    }, { timeout: 120000 }).toBe(true);

    try {
      await page.evaluate((address) => {
        localStorage.setItem('templ:lastAddress', address);
      }, templAddress);
    } catch {}
    console.log('TEMPL deployed at:', templAddress);
    // Assert the contract on-chain state matches input
    const templ = new ethers.Contract(templAddress, templAbi, wallets.priest);
    expect(await templ.accessToken()).toBe(tokenAddress);

    const waitForBackendJoin = async (contractAddress, inboxId, label) => {
      dbg(`[waitForBackendJoin] start ${label} contract=${contractAddress} inbox=${inboxId}`);
      await expect.poll(async () => {
        if (!inboxId) return false;
        try {
          const membership = await fetch(`http://localhost:3001/debug/membership?contractAddress=${contractAddress}&inboxId=${inboxId}`).then(r => r.json());
          dbg(`[waitForBackendJoin] membership poll ${label}`, membership);
          if (membership && membership.contains === true) return true;
        } catch (err) {
          dbg(`[waitForBackendJoin] membership poll error ${label}`, err?.message || err);
        }
        try {
          const lastJoin = await fetch('http://localhost:3001/debug/last-join').then(r => r.json());
          const meta = lastJoin?.payload?.joinMeta;
          const norm = (s) => String(s || '').replace(/^0x/i, '').toLowerCase();
          if (meta && norm(meta.contract) === norm(contractAddress) && norm(meta.inboxId) === norm(inboxId)) {
            return true;
          }
        } catch (err) {
          dbg(`[waitForBackendJoin] last-join poll error ${label}`, err?.message || err);
        }
        return false;
      }, { timeout: 180000 }).toBe(true);
      dbg(`[waitForBackendJoin] success ${label}`);
    };

    // Core Flow 3: Pay-to-join (priest wallet via UI)
    console.log('Core Flow 3: Pay-to-join (priest)');
    await page.evaluate((address) => {
      const path = `/join?address=${address}`;
      const url = new URL(path, window.location.origin);
      window.history.pushState({}, '', url.toString());
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, templAddress);
    dbg('[priest join] switched route to /join');
    try { await page.click('button:has-text("Connect Wallet")', { timeout: 5000 }); } catch {}
    await waitForUiReady('priest join');
    await expect.poll(async () => await page.evaluate(() => typeof window.__templTrigger === 'function')).toBe(true);
    await page.evaluate(() => {
      console.log('trigger type (priest)', typeof window.__templTrigger);
    });
    await page.fill('input[placeholder*="Contract address"]', templAddress);
    dbg('[priest join] filled contract address');
    // Ensure trigger still bound after readiness wait
    await expect.poll(async () => await page.evaluate(() => typeof window.__templTrigger === 'function')).toBe(true);
    const priestJoinResponse = page.waitForResponse((res) => {
      const ok = res.url().endsWith('/join') && res.request().method() === 'POST';
      if (ok) dbg('[priest join] observed /join request', { status: res.status() });
      return ok;
    });
    await page.evaluate(() => {
      // @ts-ignore
      window.__templTrigger?.('join');
    });
    const priestJoin = await priestJoinResponse;
    dbg('[priest join] response status', priestJoin.status());
    expect(priestJoin.ok()).toBeTruthy();
    try {
      await waitForBackendJoin(templAddress, priestInboxId, 'priest');
    } catch (err) {
      console.warn('[e2e] priest join backend confirmation timed out', err?.message || err);
    }
    
    // Now join as a separate member to better mirror real usage
    dbg('Core Flow 3b: Switch to member wallet and join');
    await page.goto(`./join?address=${templAddress}`, { waitUntil: 'domcontentloaded' });
    dbg('[member join] navigated to join route with query');
    {
      const w = wallets.member;
      const addr = await w.getAddress();
      // capture member inboxId once and reuse outside this block
      // Bridge sign and send for member
      await page.exposeFunction('e2e_member_sign', async ({ message }) => {
        if (typeof message === 'string' && message.startsWith('0x')) {
          return await w.signMessage(ethers.getBytes(message));
        }
        return await w.signMessage(message);
      });
      await page.exposeFunction('e2e_member_signTyped', async ({ domain, types, message }) => {
        try {
          const sanitizedTypes = { ...(types || {}) };
          if (sanitizedTypes.EIP712Domain) delete sanitizedTypes.EIP712Domain;
          return await w.signTypedData(domain, sanitizedTypes, message);
        } catch (e) { throw new Error(`signTyped failed: ${e?.message||e}`); }
      });
      let memberNextNonce = null;
      await page.exposeFunction('e2e_member_send', async (tx) => {
        const req = {
          to: tx.to || undefined,
          data: tx.data || undefined,
          value: tx.value ? BigInt(tx.value) : undefined,
          gasPrice: tx.gasPrice ? BigInt(tx.gasPrice) : undefined,
          gasLimit: tx.gas || tx.gasLimit ? BigInt(tx.gas || tx.gasLimit) : undefined,
        };
        const provider = w.provider;
        let pendingNonce = await provider.getTransactionCount(addr, 'pending');
        if (memberNextNonce !== null && pendingNonce < memberNextNonce) {
          pendingNonce = memberNextNonce;
        }
        req.nonce = pendingNonce;
        const resp = await w.sendTransaction(req);
        const usedNonce = typeof resp.nonce === 'bigint' ? Number(resp.nonce) : resp.nonce;
        if (Number.isFinite(usedNonce)) {
          memberNextNonce = usedNonce + 1;
        }
        return resp.hash;
      });
      await page.evaluate(async ({ address }) => {
        window.ethereum = {
          isMetaMask: true,
          selectedAddress: address,
          request: async ({ method, params }) => {
            if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [address];
            if (method === 'eth_chainId') return '0x7a69';
            if (method === 'personal_sign' || method === 'eth_sign') {
              const data = (params && params[0]) || '';
              // @ts-ignore
              return await window.e2e_member_sign({ message: data });
            }
            if (method === 'eth_signTypedData' || method === 'eth_signTypedData_v4') {
              const [_addr, typed] = params || [];
              const payload = typeof typed === 'string' ? JSON.parse(typed) : typed;
              // @ts-ignore
              return await window.e2e_member_signTyped(payload);
            }
            if (method === 'eth_sendTransaction') {
              const [tx] = params || [];
              // @ts-ignore
              return await window.e2e_member_send(tx);
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
      }, { address: addr });
      // Reconnect as member and navigate to Join route
      await page.click('button:has-text("Connect Wallet")');
      await waitForUiReady('member join');
      dbg('[member join] XMTP inbox ready');
      await expect.poll(async () => await page.evaluate(() => typeof window.__templTrigger === 'function')).toBe(true);
      await page.evaluate(() => {
        console.log('trigger type (member)', typeof window.__templTrigger);
      });
      // Ensure browser installation is visible on XMTP infra before join (linearize readiness)
      try {
        const inboxId = await page.evaluate(() => window.__XMTP?.inboxId || null);
        memberInboxId = String(inboxId || '');
        dbg('DEBUG member browser inboxId before join:', inboxId);
        const env = process.env.E2E_XMTP_LOCAL === '1' ? 'local' : 'dev';
        for (let i = 0; i < 3; i++) {
          try {
            const resp = await fetch(`http://localhost:3001/debug/inbox-state?inboxId=${inboxId}&env=${env}`).then(r => r.json());
            dbg('DEBUG /debug/inbox-state:', resp);
            if (resp && Array.isArray(resp.states) && resp.states.length > 0) break;
          } catch (err) {
            dbg('DEBUG /debug/inbox-state error', err?.message || err);
          }
          await page.waitForTimeout(250);
        }
      } catch {}
      // Execute production flow via UI: approve + purchase + join
      await expect(page.locator('h2:has-text("Join Existing Templ")')).toBeVisible({ timeout: 5000 });
      await page.fill('input[placeholder*="Contract address"]', templAddress);
      const memberStatus = await page.evaluate(() => document.querySelector('.status')?.textContent || '');
      dbg('[member join] status area before trigger', memberStatus);
      const memberJoinResponse = page.waitForResponse((res) => {
        const ok = res.url().endsWith('/join') && res.request().method() === 'POST';
        if (ok) dbg('[member join] observed /join request', { status: res.status() });
        return ok;
      });
      await page.evaluate(() => {
        // @ts-ignore
        window.__templTrigger?.('join');
      });
      const memberJoin = await memberJoinResponse;
      dbg('[member join] response status', memberJoin.status());
      expect(memberJoin.ok()).toBeTruthy();
      try {
        await waitForBackendJoin(templAddress, memberInboxId, 'member');
      } catch (err) {
        console.warn('[e2e] member join backend confirmation timed out', err?.message || err);
      }
    }
    // Resolve groupId robustly from backend debug if UI hasn't populated yet
    let groupId = '';
    for (let i = 0; i < 3 && !groupId; i++) {
      try {
        const dbgJoin = await fetch(`http://localhost:3001/debug/group?contractAddress=${templAddress}&refresh=1`).then(r => r.json());
        dbg('DEBUG after join (pre-UI):', dbgJoin);
        groupId = dbgJoin.resolvedGroupId || dbgJoin.storedGroupId || '';
        if (groupId && groupId.startsWith('0x')) groupId = groupId.slice(2);
      } catch {}
      if (!groupId) await new Promise(r => setTimeout(r, 1000));
    }
    // Also try reading from UI if available
    if (!groupId) {
      const gidEl = page.locator('.deploy-info >> text=Group ID:').first();
      await expect(gidEl).toBeVisible({ timeout: 60000 });
      const gidText = (await gidEl.textContent()) || '';
      groupId = gidText.split(':').pop().trim();
    }
    expect(groupId && groupId.length > 0).toBe(true);
    dbg('Resolved groupId for discovery:', groupId);
    // Debug server-side view of group and conversations after join
    try {
      const dbg1 = await fetch(`http://localhost:3001/debug/group?contractAddress=${templAddress}`).then(r => r.json());
      dbg('DEBUG /debug/group after join:', dbg1);
    } catch {}
    try {
      const dbg2 = await fetch('http://localhost:3001/debug/conversations').then(r => r.json());
      dbg('DEBUG /debug/conversations after join:', dbg2);
    } catch {}
    try {
      const inboxId = await page.evaluate(() => window.__XMTP?.inboxId || null);
      const dbg3 = await fetch(`http://localhost:3001/debug/membership?contractAddress=${templAddress}&inboxId=${inboxId}`).then(r => r.json());
      dbg('DEBUG /debug/membership after join:', dbg3);
      // Wait until backend records a successful join (last-join payload) to linearize addMembers completion
      let dbg4;
      for (let i = 0; i < 3; i++) {
        try {
          dbg4 = await fetch('http://localhost:3001/debug/last-join').then(r => r.json());
          dbg('DEBUG /debug/last-join:', dbg4);
          if (dbg4 && dbg4.payload && dbg4.payload.joinMeta && dbg4.payload.joinMeta.groupId) break;
        } catch {}
        await new Promise(r => setTimeout(r, 1000));
      }
      dbg('DEBUG /debug/last-join final:', dbg4);
    } catch {}
    
    console.log('[e2e] Backend join responses received');
    // Landing page should list created templs
    await page.click('button:has-text("Home")');
    await expect(page.locator('[data-testid="templ-list"]')).toBeVisible();
    const templAddressLower = templAddress.toLowerCase();
    await expect(page.locator(`[data-testid="templ-list"] [data-address="${templAddressLower}"]`)).toBeVisible();
    // Muting controls should not be visible for non-priests
    await expect(page.locator('[data-testid="moderation-controls"]')).toHaveCount(0);
    // Extra diagnostics right before messaging
    try {
      const dbg3 = await fetch(`http://localhost:3001/debug/group?contractAddress=${templAddress}`).then(r => r.json());
      dbg('DEBUG /debug/group before messaging:', dbg3);
    } catch {}
    try {
      const dbg4 = await fetch('http://localhost:3001/debug/conversations').then(r => r.json());
      dbg('DEBUG /debug/conversations before messaging:', dbg4);
    } catch {}
    try {
      const agg = await page.evaluate(async () => {
        if (!window.__XMTP?.debugInformation?.apiAggregateStatistics) return null;
        return await window.__XMTP.debugInformation.apiAggregateStatistics();
      });
      if (agg) dbg('Browser XMTP aggregate stats post-discovery:\n' + agg);
    } catch {}

    // Memberships are handled by the UI flows; avoid duplicate purchase.
    // Optionally assert membership via backend debug
    // Confirm membership via backend using the stored member inboxId; avoid browser.evaluate in recovery.
    await expect.poll(async () => {
      try {
        const dbg = await fetch(`http://localhost:3001/debug/membership?contractAddress=${templAddress}&inboxId=${memberInboxId}`).then(r => r.json());
        return Boolean(dbg && dbg.contains === true);
      } catch { return false; }
    }, { timeout: 180000 }).toBe(true);

    // Core Flow 4: Messaging — wait until connected, send, and assert render
    dbg('Core Flow 4: Messaging');
    await page.click('button:has-text("Chat")');
    const sendBtn = page.locator('[data-testid="chat-send"]');
    await expect(sendBtn).toBeEnabled({ timeout: 15000 });
    const messageInput = page.locator('[data-testid="chat-input"]');
    const memberMessage = 'Hello TEMPL! ' + Date.now();
    await messageInput.fill(memberMessage);
    await expect(messageInput).toHaveValue(memberMessage);
    await sendBtn.click();
    dbg('Sent via UI');
    let sentOk = false;
    try { await expect(page.locator('.chat-list')).toContainText(memberMessage, { timeout: 15000 }); sentOk = true; } catch {}
    if (!sentOk) {
      try { await expect(page.locator('.status')).toContainText('Message sent', { timeout: 5000 }); sentOk = true; } catch {}
    }
    expect(sentOk, 'Message did not confirm in UI').toBeTruthy();

    // Core Flow 5–7: Proposal create and vote via UI; execute via priest (protocol)
    dbg('Core Flow 5–7: Proposal lifecycle via UI + protocol');
    // Switch back to the original UI wallet to avoid join-time equality edge cases
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    const uiTxCache = new Map();
    await page.exposeFunction('e2e_ui_sign', async ({ message }) => {
      if (typeof message === 'string' && message.startsWith('0x')) {
        return await testWallet.signMessage(ethers.getBytes(message));
      }
      return await testWallet.signMessage(message);
    });
    await page.exposeFunction('e2e_ui_signTyped', async ({ domain, types, message }) => {
      try { return await testWallet.signTypedData(domain, types, message); } catch (e) { throw new Error(`signTyped failed: ${e?.message||e}`); }
    });
    await page.exposeFunction('e2e_ui_send', async (tx) => {
      const req = {
        to: tx.to || undefined,
        data: tx.data || undefined,
        value: tx.value ? BigInt(tx.value) : undefined,
        gasPrice: tx.gasPrice ? BigInt(tx.gasPrice) : undefined,
        gasLimit: tx.gas || tx.gasLimit ? BigInt(tx.gas || tx.gasLimit) : undefined,
      };
      const key = JSON.stringify({ to: req.to?.toLowerCase?.() || req.to, data: req.data, value: req.value?.toString?.() || null });
      if (uiTxCache.has(key)) {
        return uiTxCache.get(key);
      }
      const provider = testWallet.provider;
      const addr = await testWallet.getAddress();
      let nextNonce = await provider.getTransactionCount(addr, 'pending');
      req.nonce = nextNonce;
      const resp = await testWallet.sendTransaction(req);
      const hash = resp.hash;
      uiTxCache.set(key, hash);
      const usedNonce = typeof resp.nonce === 'bigint' ? Number(resp.nonce) : resp.nonce;
      if (Number.isFinite(usedNonce)) {
        nextNonce = usedNonce + 1;
      }
      return hash;
    });
    await page.evaluate(async ({ address }) => {
      window.ethereum = {
        isMetaMask: true,
        selectedAddress: address,
        request: async ({ method, params }) => {
          if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [address];
          if (method === 'eth_chainId') return '0x7a69';
          if (method === 'personal_sign' || method === 'eth_sign') {
            const data = (params && params[0]) || '';
            // @ts-ignore
            return await window.e2e_ui_sign({ message: data });
          }
          if (method === 'eth_signTypedData' || method === 'eth_signTypedData_v4') {
            const [_addr, typed] = params || [];
            const payload = typeof typed === 'string' ? JSON.parse(typed) : typed;
            // @ts-ignore
            return await window.e2e_ui_signTyped(payload);
          }
          if (method === 'eth_sendTransaction') {
            const [tx] = params || [];
            // @ts-ignore
            return await window.e2e_ui_send(tx);
          }
          // passthrough
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
    }, { address: testAddress });
    await page.click('button:has-text("Connect Wallet")');
    await expect.poll(async () => await page.evaluate(() => Boolean(window.__XMTP?.inboxId)), { timeout: 15000 }).toBe(true);
    await page.click('button:has-text("Chat")');
    // Ensure proposal is created in a later block than the member purchase to avoid equality edge case
    await fetch('http://localhost:8545', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'evm_increaseTime', params: [1] }) });
    await fetch('http://localhost:8545', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'evm_mine', params: [] }) });
    await page.click('button:has-text("Propose vote")');
    await page.fill('input[placeholder="Title"]', 'Pause DAO');
    await page.click('button:has-text("Pause DAO")');
    await page.click('button:has-text("Submit Proposal")');
    // Wait for poll item to appear in chat
    await expect(page.locator('.chat-item--poll')).toBeVisible({ timeout: 60000 });
    // Vote yes via UI
    await page.click('.chat-item--poll >> text=Vote Yes');
    dbg('Clicked Vote Yes via UI');
    // Resolve latest proposal id
      const templPriest = new ethers.Contract(templAddress, templAbi, wallets.priest);
      const lastIdBN1 = await templPriest.proposalCount();
      const lastId1 = Number(lastIdBN1) - 1;
    // Verify UI voter recorded on-chain
      await expect.poll(async () => {
        const [has, ] = await templPriest.hasVoted(lastId1, testAddress);
        return has;
      }, { timeout: 180000 }).toBe(true);
    // Advance time and execute via priest programmatically
      await fetch('http://localhost:8545', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'evm_increaseTime', params: [7 * 24 * 60 * 60] }) });
      await fetch('http://localhost:8545', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'evm_mine', params: [] }) });
      const lastIdBN = await templPriest.proposalCount();
      const lastId = Number(lastIdBN) - 1;
      const provider = templPriest.runner.provider;
      const priestAddr = await wallets.priest.getAddress();
      let executed = false;
      for (let attempt = 0; attempt < 3 && !executed; attempt++) {
        const priestNonce = await provider.getTransactionCount(priestAddr, 'pending');
        try {
          const tx = await templPriest.executeProposal(lastId, { nonce: priestNonce });
          await tx.wait();
          executed = true;
        } catch (err) {
          if (err?.code !== 'NONCE_EXPIRED' || attempt === 2) throw err;
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      }
      const templFinal = new ethers.Contract(templAddress, templAbi, wallets.priest);
      expect(await templFinal.paused()).toBe(true);

      // (extra actions such as reprice and disband are covered in contract/integration tests)
      
      // Core Flow 8: Priest Moderation Controls (mute + delegate)
      console.log('Core Flow 8: Priest Moderation Controls');
      const priestWallet = wallets.priest;
      const priestAddress = await priestWallet.getAddress();
      await page.exposeFunction('e2e_priest_sign', async ({ message }) => {
        if (typeof message === 'string' && message.startsWith('0x')) {
          return await priestWallet.signMessage(ethers.getBytes(message));
        }
        return await priestWallet.signMessage(message);
      });
      await page.exposeFunction('e2e_priest_signTyped', async ({ domain, types, message }) => {
        const sanitizedTypes = { ...(types || {}) };
        if (sanitizedTypes.EIP712Domain) delete sanitizedTypes.EIP712Domain;
        return await priestWallet.signTypedData(domain, sanitizedTypes, message);
      });
      let priestNextNonce = null;
      await page.exposeFunction('e2e_priest_send', async (tx) => {
        const req = {
          to: tx.to || undefined,
          data: tx.data || undefined,
          value: tx.value ? BigInt(tx.value) : undefined,
          gasPrice: tx.gasPrice ? BigInt(tx.gasPrice) : undefined,
          gasLimit: tx.gas || tx.gasLimit ? BigInt(tx.gas || tx.gasLimit) : undefined,
        };
        const provider = priestWallet.provider;
        let pendingNonce = await provider.getTransactionCount(priestAddress, 'pending');
        if (priestNextNonce !== null && pendingNonce < priestNextNonce) {
          pendingNonce = priestNextNonce;
        }
        req.nonce = pendingNonce;
        const resp = await priestWallet.sendTransaction(req);
        const usedNonce = typeof resp.nonce === 'bigint' ? Number(resp.nonce) : resp.nonce;
        if (Number.isFinite(usedNonce)) priestNextNonce = usedNonce + 1;
        return resp.hash;
      });
      await page.evaluate(async ({ address }) => {
        window.ethereum = {
          isMetaMask: true,
          selectedAddress: address,
          request: async ({ method, params }) => {
            if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [address];
            if (method === 'eth_chainId') return '0x7a69';
            if (method === 'personal_sign' || method === 'eth_sign') {
              const data = (params && params[0]) || '';
              // @ts-ignore
              return await window.e2e_priest_sign({ message: data });
            }
            if (method === 'eth_signTypedData' || method === 'eth_signTypedData_v4') {
              const [_addr, typed] = params || [];
              const payload = typeof typed === 'string' ? JSON.parse(typed) : typed;
              // @ts-ignore
              return await window.e2e_priest_signTyped(payload);
            }
            if (method === 'eth_sendTransaction') {
              const [tx] = params || [];
              // @ts-ignore
              return await window.e2e_priest_send(tx);
            }
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
      }, { address: priestAddress });
      await page.click('button:has-text("Connect Wallet")');
      await page.click('button:has-text("Chat")');
      const memberAddress = (await wallets.member.getAddress()).toLowerCase();
      const moderationControls = page.locator(`[data-testid="moderation-controls"][data-address="${memberAddress}"]`);
      await expect(moderationControls).toBeVisible({ timeout: 15000 });
      const delegateButton = moderationControls.locator('[data-testid="delegate-button"]');
      if (await delegateButton.count()) {
        await delegateButton.first().click();
      }
      const muteButton = moderationControls.locator('[data-testid="mute-button"]');
      await muteButton.first().click();
      await expect(moderationControls).toHaveCount(0);
      console.log('✅ Priest moderation controls muted the member');
      
    console.log('✅ All 7 Core Flows Tested Successfully!');
    const screenshotPath = path.resolve(process.cwd(), '..', 'pw-results', 'e2e', 'all-flows-complete.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
  });
});
