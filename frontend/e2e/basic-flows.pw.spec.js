import { test, expect, TestToken, TemplFactory } from './fixtures.js';
import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import path from 'path';
import { buildCreateTypedData, buildJoinTypedData } from '../../shared/signing.js';

const templArtifact = JSON.parse(readFileSync(path.join(process.cwd(), 'src/contracts/TEMPL.json'), 'utf8'));

const TELEGRAM_CHAT_ID = '-100999888777';

function extractTemplAddress(receipt, factoryInterface) {
  for (const log of receipt.logs || []) {
    try {
      const parsed = factoryInterface.parseLog(log);
      if (parsed?.name === 'TemplCreated') {
        return parsed.args?.templ?.toLowerCase();
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

test.describe('Telegram pivot basic flows', () => {
  test('register templ, verify membership, and navigate SPA routes', async ({ page, provider, wallets }) => {
    const protocolRecipient = await wallets.priest.getAddress();
    const deployer = await provider.getSigner(2);
    let deployerNonce = await deployer.getNonce();
    const mine = async () => provider.send('hardhat_mine', ['0x1']);

    const factoryFactory = new ethers.ContractFactory(TemplFactory.abi, TemplFactory.bytecode, deployer);
    const templFactory = await factoryFactory.deploy(protocolRecipient, 10, { nonce: deployerNonce++ });
    await templFactory.waitForDeployment();
    await mine();

    const tokenDeployer = await provider.getSigner(3);
    let tokenNonce = await tokenDeployer.getNonce();
    const tokenFactory = new ethers.ContractFactory(TestToken.abi, TestToken.bytecode, tokenDeployer);
    const token = await tokenFactory.deploy('Test Token', 'TEST', 18, { nonce: tokenNonce++ });
    await token.waitForDeployment();
    await mine();

    const entryFee = ethers.parseUnits('100', 18);
    const templConfig = {
      priest: protocolRecipient,
      token: await token.getAddress(),
      entryFee,
      burnPercent: 30,
      treasuryPercent: 30,
      memberPoolPercent: 30,
      quorumPercent: 33,
      executionDelaySeconds: 7 * 24 * 60 * 60,
      burnAddress: '0x000000000000000000000000000000000000dEaD',
      priestIsDictator: false,
      maxMembers: 0
    };

    let priestNonce = await wallets.priest.getNonce();
    const templFactoryForDeploy = templFactory.connect(wallets.priest);
    const deployTx = await templFactoryForDeploy.createTemplWithConfig(templConfig, { nonce: priestNonce++ });
    const deployReceipt = await deployTx.wait();
    await mine();
    const templAddress = extractTemplAddress(deployReceipt, templFactory.interface);
    expect(templAddress).toBeTruthy();

    const chainId = 1337;
    const createTyped = buildCreateTypedData({ chainId, contractAddress: templAddress });
    const createSignature = await wallets.priest.signTypedData(createTyped.domain, createTyped.types, createTyped.message);
    const registerPayload = {
      contractAddress: templAddress,
      priestAddress: protocolRecipient,
      signature: createSignature,
      chainId,
      nonce: createTyped.message.nonce,
      issuedAt: createTyped.message.issuedAt,
      expiry: createTyped.message.expiry,
      telegramChatId: TELEGRAM_CHAT_ID
    };
    const registerRes = await fetch('http://localhost:3001/templs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(registerPayload)
    });
    expect(registerRes.status).toBe(200);

    const mintTx = await token.connect(wallets.priest).mint(await wallets.member.getAddress(), entryFee, { nonce: priestNonce++ });
    await mintTx.wait();
    await mine();
    let memberNonce = await wallets.member.getNonce();
    const approveTx = await token.connect(wallets.member).approve(templAddress, entryFee, { nonce: memberNonce++ });
    await approveTx.wait();
    await mine();
    const templContract = new ethers.Contract(templAddress, templArtifact.abi, wallets.member);
    const purchaseTx = await templContract.purchaseAccess({ nonce: memberNonce++ });
    await purchaseTx.wait();
    await mine();

    const joinTyped = buildJoinTypedData({ chainId, contractAddress: templAddress });
    const joinSignature = await wallets.member.signTypedData(joinTyped.domain, joinTyped.types, joinTyped.message);
    const joinPayload = {
      contractAddress: templAddress,
      memberAddress: await wallets.member.getAddress(),
      signature: joinSignature,
      chainId,
      nonce: joinTyped.message.nonce,
      issuedAt: joinTyped.message.issuedAt,
      expiry: joinTyped.message.expiry
    };
    const joinRes = await fetch('http://localhost:3001/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(joinPayload)
    });
    expect(joinRes.status).toBe(200);
    const joinJson = await joinRes.json();
    expect(joinJson.templ.telegramChatId).toBe(TELEGRAM_CHAT_ID);

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'TEMPL Control Center' })).toBeVisible();
    const row = page.locator('table.templs-table tbody tr').filter({ hasText: templAddress.slice(0, 8) });
    await expect(row).toBeVisible();
    const priestSnippet = protocolRecipient.slice(2, 10);
    await expect(row).toContainText(new RegExp(priestSnippet, 'i'));
    await expect(row).toContainText(TELEGRAM_CHAT_ID);

    await row.getByRole('button', { name: 'View' }).click();
    await expect(page).toHaveURL(new RegExp(`/templs/${templAddress}`));
    await expect(page.getByRole('button', { name: 'Create proposal' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Claim rewards' })).toBeVisible();

    await page.getByRole('button', { name: 'Create proposal' }).click();
    await expect(page).toHaveURL(new RegExp(`/templs/${templAddress}/proposals/new`));
    await expect(page.getByLabel('Title')).toBeVisible();
    await expect(page.getByLabel('Description')).toBeVisible();

    await page.goto(`/templs/join?address=${templAddress}`);
    await expect(page.getByLabel('Templ address')).toHaveValue(templAddress);
    await expect(page.getByRole('button', { name: 'Verify Membership' })).toBeVisible();

    await page.goto(`/templs/${templAddress}/proposals/0/vote`);
    await expect(page.getByText('Proposal #0')).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Yes' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'No' })).toBeVisible();

    await page.goto(`/templs/${templAddress}/claim`);
    await expect(page.getByText('Claim Member Rewards')).toBeVisible();
  });
});
