import { test, expect } from '@playwright/test';
import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Client as NodeXmtpClient } from '@xmtp/node-sdk';
import { buildCreateTypedData } from '../../shared/signing.js';
import { setupWalletBridge } from './helpers.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

function logWithTimestamp(...args) {
  const now = new Date().toISOString();
  console.log(`[${now}]`, ...args);
}

function loadArtifact(relativePath) {
  const fullPath = path.join(repoRoot, relativePath);
  return JSON.parse(readFileSync(fullPath, 'utf8'));
}

const TestToken = loadArtifact('artifacts/contracts/mocks/TestToken.sol/TestToken.json');
const TemplFactory = loadArtifact('artifacts/contracts/TemplFactory.sol/TemplFactory.json');
const templArtifact = JSON.parse(readFileSync(path.join(process.cwd(), 'src/contracts/TEMPL.json'), 'utf8'));

const HARDHAT_RPC_URL = process.env.E2E_HARDHAT_RPC_URL || 'http://127.0.0.1:8545';
const BACKEND_URL = process.env.E2E_BACKEND_URL || 'http://localhost:3001';
const E2E_XMTP_ENV = process.env.E2E_XMTP_ENV || 'dev';
const WEEK_IN_SECONDS = 7 * 24 * 60 * 60;
const FUNDING_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

async function createWallets(provider) {
  const useRandom = process.env.E2E_RANDOM_WALLETS !== '0';
  if (useRandom) {
    const funder = new ethers.Wallet(FUNDING_KEY, provider);
    const priest = ethers.Wallet.createRandom().connect(provider);
    const member = ethers.Wallet.createRandom().connect(provider);
    const wallets = { priest, member };
    let nonce = await funder.getNonce();
    for (const wallet of Object.values(wallets)) {
      const tx = await funder.sendTransaction({
        to: await wallet.getAddress(),
        value: ethers.parseEther('100'),
        nonce: nonce++
      });
      await tx.wait();
    }
    return wallets;
  }
  return {
    priest: new ethers.Wallet(
      '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
      provider
    ),
    member: new ethers.Wallet(
      '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
      provider
    )
  };
}

async function registerTempl({ contractAddress, priest, backendUrl, chainId }) {
  if (E2E_XMTP_ENV === 'local') {
    const signerAddress = await priest.getAddress();
    let nonce = 0;
    const xmtpSigner = {
      type: 'EOA',
      getAddress: () => signerAddress,
      getIdentifier: () => ({
        identifier: signerAddress.toLowerCase(),
        identifierKind: 0,
        nonce: ++nonce
      }),
      signMessage: async (message) => {
        let payload = message;
        if (message instanceof Uint8Array) {
          try { payload = ethers.toUtf8String(message); }
          catch { payload = ethers.hexlify(message); }
        } else if (typeof message !== 'string') {
          payload = String(message);
        }
        const signature = await priest.signMessage(payload);
        return ethers.getBytes(signature);
      }
    };
    const client = await NodeXmtpClient.create(xmtpSigner, {
      env: 'local',
      dbEncryptionKey: new Uint8Array(32),
      appVersion: 'templ-e2e/0.0.1'
    });
    await client?.close?.();
    console.log(`[xmtp] ensured local identity for ${signerAddress}`);
  }
  const normalized = contractAddress.toLowerCase();
  const numericChainId = typeof chainId === 'bigint' ? Number(chainId) : Number(chainId);
  if (!Number.isSafeInteger(numericChainId)) {
    throw new Error(`Unsupported chainId for registration: ${chainId}`);
  }
  const typed = buildCreateTypedData({ chainId: numericChainId, contractAddress: normalized });
  const signature = await priest.signTypedData(typed.domain, typed.types, typed.message);
  const body = {
    contractAddress: normalized,
    priestAddress: await priest.getAddress(),
    signature,
    chainId: numericChainId,
    nonce: Number(typed.message.nonce),
    issuedAt: Number(typed.message.issuedAt),
    expiry: Number(typed.message.expiry)
  };
  const res = await fetch(`${backendUrl}/templs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    throw new Error(`Failed to register templ with backend (${res.status})`);
  }
  return res.json();
}

function extractTemplAddress(receipt, templFactory) {
  for (const log of receipt.logs) {
    try {
      const parsed = templFactory.interface.parseLog(log);
      if (parsed?.name === 'TemplCreated') {
        return parsed.args.templ.toLowerCase();
      }
    } catch {/* ignore */}
  }
  throw new Error('TemplCreated log missing');
}

test.describe('Chat-centric templ flow', () => {
  test('member joins and governs from chat UI', async ({ page }) => {
    page.on('console', (msg) => {
      logWithTimestamp('[browser]', msg.type(), msg.text());
    });
    page.on('pageerror', (err) => {
      logWithTimestamp('[browser-error]', err?.message || String(err));
    });
    const provider = new ethers.JsonRpcProvider(HARDHAT_RPC_URL);
    const wallets = await createWallets(provider);
    const priestAddress = await wallets.priest.getAddress();

    // Deploy factory
    const factoryDeployer = await provider.getSigner(1);
    const factoryFactory = new ethers.ContractFactory(TemplFactory.abi, TemplFactory.bytecode, factoryDeployer);
    const templFactory = await factoryFactory.deploy(priestAddress, 1000);
    await templFactory.waitForDeployment();
    const templFactoryAddress = await templFactory.getAddress();
    await templFactory.connect(factoryDeployer).setPermissionless(true);

    // Deploy access token and fund members
    const tokenDeployer = await provider.getSigner(2);
    const tokenFactory = new ethers.ContractFactory(TestToken.abi, TestToken.bytecode, tokenDeployer);
    const token = await tokenFactory.deploy('Templ Token', 'TMPL', 18);
    await token.waitForDeployment();
    const tokenAddress = await token.getAddress();

    const entryFee = ethers.parseUnits('1', 18);
    const memberAddress = await wallets.member.getAddress();
    const secondMember = await provider.getSigner(4);
    const secondMemberAddress = await secondMember.getAddress();

    await (await token.connect(tokenDeployer).mint(memberAddress, entryFee * 10n)).wait();
    await (await token.connect(tokenDeployer).mint(secondMemberAddress, entryFee * 10n)).wait();

    // Deploy templ through the factory with default config
    const templConfig = {
      priest: priestAddress,
      token: tokenAddress,
      entryFee,
      burnPercent: 3_000,
      treasuryPercent: 3_000,
      memberPoolPercent: 3_000,
      quorumPercent: 3_300,
      executionDelaySeconds: WEEK_IN_SECONDS,
      burnAddress: ethers.ZeroAddress,
      priestIsDictator: false,
      maxMembers: 249,
      curveProvided: true,
      curve: {
        primary: {
          style: 2,
          rateBps: 11_000
        }
      },
      homeLink: ''
    };

    const createTx = await templFactory.connect(wallets.priest).createTemplWithConfig(templConfig);
    const receipt = await createTx.wait();
    const templAddress = extractTemplAddress(receipt, templFactory);

    const { chainId } = await provider.getNetwork();
    const registration = await registerTempl({
      contractAddress: templAddress,
      priest: wallets.priest,
      backendUrl: BACKEND_URL,
      chainId
    });
    expect(registration?.groupId).toBeTruthy();
    let groupId = String(registration.groupId);

    const templForMember = new ethers.Contract(templAddress, templArtifact.abi, wallets.member);
    const templReadOnly = new ethers.Contract(templAddress, templArtifact.abi, provider);

    // Prepare wallet bridge (MetaMask stub)
    const walletBridge = await setupWalletBridge({ page, provider, wallets });

    // Seed factory address for the frontend
    await page.addInitScript((factoryAddress) => {
      window.TEMPL_FACTORY_ADDRESS = factoryAddress;
    }, templFactoryAddress);

    await page.goto('/');
    await walletBridge.switchAccount('member', { emit: false });
    await expect(page.getByRole('heading', { name: 'Templs', exact: true })).toBeVisible();

    const connectButton = page.getByRole('navigation').getByRole('button', { name: 'Connect Wallet' });
    await connectButton.click();
    await expect(page.getByRole('navigation').getByText(/Connected:/)).toBeVisible();

    // Templ listing shows symbol and entry fee
    const templRow = page.locator('tbody tr').filter({ hasText: templAddress.slice(2, 8) });
    await expect(templRow).toBeVisible();
    await expect(templRow.locator('td').nth(1)).toContainText('TMPL');

    await templRow.getByRole('button', { name: 'Join' }).click();
    await expect(page).toHaveURL(/\/templs\/join/);
    await expect(page.getByLabel('Templ address')).toHaveValue(templAddress);

    await page.getByRole('button', { name: 'Approve entry fee' }).click();
    await expect(page.getByText(/Approving entry fee/)).toBeVisible();
    await expect(page.getByText(/Allowance approved/)).toBeVisible();

    await page.getByRole('button', { name: 'Join templ' }).click();
    await expect(page.getByText(/Joining templ/)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/templs/${templAddress}/chat`, 'i'));

    // Chat renders and waits until the conversation bridge reports ready
    await expect(page.getByRole('heading', { name: 'Templ Chat' })).toBeVisible();
    await expect.poll(async () => templForMember.isMember(memberAddress)).toBeTruthy();
    const preDebugSteps = await page.evaluate(() => window.templTestHooks?.getDebugSteps?.() ?? []);
    logWithTimestamp('[e2e] pre-wait debug steps:', preDebugSteps);
    const preChatError = await page.evaluate(() => window.templTestHooks?.getChatError?.() ?? '');
    logWithTimestamp('[e2e] pre-wait chat error:', preChatError);
    try {
      await expect.poll(async () => {
        return page.evaluate(() => window.templTestHooks?.isConversationReady?.() ?? false);
      }, { timeout: 120_000 }).toBeTruthy();
    } catch (err) {
      const debugAfter = await page.evaluate(() => window.templTestHooks?.getDebugSteps?.() ?? []);
      const chatErrorAfter = await page.evaluate(() => window.templTestHooks?.getChatError?.() ?? '');
      logWithTimestamp('[e2e] debug steps after failure:', debugAfter);
      logWithTimestamp('[e2e] chat error after failure:', chatErrorAfter);
      throw err;
    }

    const uiGroupId = await page.evaluate(() => window.templTestHooks?.getGroupId?.() ?? '');
    if (uiGroupId) {
      groupId = uiGroupId;
    }
    expect(groupId).toBeTruthy();
    const debugSteps = await page.evaluate(() => window.templTestHooks?.getDebugSteps?.() ?? []);
    logWithTimestamp('[e2e] chat debug steps:', debugSteps);

    // Send a chat message and ensure it lands on XMTP dev
    const chatMessage = `GM templers ${Date.now()}`;
    const chatInput = page.getByPlaceholder('Message templ members…');
    await chatInput.fill(chatMessage);
    await page.getByRole('button', { name: 'Send' }).click();

    const normalize = (value) => (value || '').toString().replace(/^0x/i, '').toLowerCase();

    await expect.poll(async () => {
      const ids = await page.evaluate(async () => {
        try {
          return await window.templTestHooks?.listMemberConversations?.() ?? [];
        } catch {
          return [];
        }
      });
      return ids.some((id) => normalize(id) === normalize(groupId));
    }, { timeout: 60_000, interval: 1_000 }).toBe(true);

    await expect.poll(async () => {
      const rendered = await page.evaluate(() => {
        try {
          return window.templTestHooks?.getRenderedMessages?.() ?? [];
        } catch {
          return [];
        }
      });
      return rendered.some((entry) => entry?.text === chatMessage);
    }, { timeout: 90_000, interval: 1_000 }).toBe(true);

    // New proposal via chat composer
    await page.getByRole('button', { name: 'New proposal' }).click();
    await page.getByLabel('Title').fill('Pause joins temporarily');
    await page.getByLabel('Description').fill('Pause membership intake for maintenance.');
    await page.getByLabel('Pause joins?').selectOption('true');
    await page.getByRole('button', { name: 'Submit proposal' }).click();
    await expect(page.getByText(/Proposal submitted/)).toBeVisible();

    const proposalCards = page.locator('[data-testid^="proposal-card-"]');
    await expect.poll(async () => proposalCards.count()).toBeGreaterThan(0);
    const proposalCard = proposalCards.filter({ hasText: 'Pause joins temporarily' }).first();
    await expect(proposalCard).toBeVisible();

    const voteYesButton = proposalCard.getByRole('button', { name: 'Vote Yes' });
    const voteNoButton = proposalCard.getByRole('button', { name: 'Vote No' });

    // Proposer auto-YES is reflected immediately
    await expect(voteYesButton).toBeDisabled();
    await expect(voteNoButton).toBeEnabled();

    const expectProposalVotes = async (expectedYes, expectedNo) => {
      await expect.poll(async () => {
        try {
          const [, yesVotes, noVotes] = await templReadOnly.getProposal(0);
          return { yesVotes, noVotes };
        } catch (err) {
          console.warn('getProposal unavailable for vote tally', err);
          return { yesVotes: 0n, noVotes: 0n };
        }
      }).toEqual({ yesVotes: expectedYes, noVotes: expectedNo });
    };

    // Priest casts an additional YES vote to reach quorum margin
    const templForPriest = new ethers.Contract(templAddress, templArtifact.abi, wallets.priest);
    const priestVote = await templForPriest.vote(0, true);
    await priestVote.wait();
    await expectProposalVotes(2n, 0n);

    // Fast-forward voting period and execute
    await provider.send('evm_increaseTime', [WEEK_IN_SECONDS + 120]);
    await provider.send('evm_mine', []);
    await page.evaluate(({ fastForwardMs }) => {
      window.templTestHooks?.setChainTime?.(Date.now() + fastForwardMs);
      return window.templTestHooks?.refreshProposal?.(0);
    }, { fastForwardMs: (WEEK_IN_SECONDS + 120) * 1000 });
    await expect(proposalCard.getByRole('button', { name: 'Execute' })).toBeEnabled();
    await proposalCard.getByRole('button', { name: 'Execute' }).click();
    await expect(page.getByText(/Execution submitted/)).toBeVisible();

    await expect.poll(async () => templReadOnly.joinPaused()).toBe(true);

    // Programmatically attempt another join; governance pause should block it
    const approveSecond = await token.connect(secondMember).approve(templAddress, entryFee);
    await approveSecond.wait();
    const templForSecond = new ethers.Contract(templAddress, templArtifact.abi, secondMember);
    await expect(templForSecond.join()).rejects.toThrow();
    await expect(await templReadOnly.memberCount()).toBe(2n);
  });
});
