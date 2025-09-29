import { test, expect, TestToken, TemplFactory } from './fixtures.js';
import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import path from 'path';
import { setupWalletBridge } from './helpers.js';

const templArtifact = JSON.parse(
  readFileSync(path.join(process.cwd(), 'src/contracts/TEMPL.json'), 'utf8')
);

const WEEK_IN_SECONDS = 7 * 24 * 60 * 60;

test.describe('Templ core workflows', () => {
  test('create, join, claim, govern, and execute via UI flows', async ({ page, provider, wallets }) => {
    const protocolRecipient = await wallets.priest.getAddress();
    const factoryDeployer = await provider.getSigner(1);
    const factoryFactory = new ethers.ContractFactory(TemplFactory.abi, TemplFactory.bytecode, factoryDeployer);
    const templFactory = await factoryFactory.deploy(protocolRecipient, 10);
    await templFactory.waitForDeployment();
    const templFactoryAddress = await templFactory.getAddress();

    const tokenDeployer = await provider.getSigner(2);
    const tokenFactory = new ethers.ContractFactory(TestToken.abi, TestToken.bytecode, tokenDeployer);
    const token = await tokenFactory.deploy('Test Token', 'TEST', 18);
    await token.waitForDeployment();
    const tokenAddress = await token.getAddress();

    const entryFee = ethers.parseUnits('1', 18);
    const updatedEntryFee = ethers.parseUnits('2', 18);
    const memberAddress = await wallets.member.getAddress();
    const secondMember = await provider.getSigner(4);
    const secondMemberAddress = await secondMember.getAddress();
    const mintMemberTx = await token.connect(tokenDeployer).mint(memberAddress, entryFee * 10n);
    await mintMemberTx.wait();
    const mintSecondTx = await token.connect(tokenDeployer).mint(secondMemberAddress, entryFee * 10n);
    await mintSecondTx.wait();

    const walletBridge = await setupWalletBridge({ page, provider, wallets });

    await page.addInitScript((factoryAddress) => {
      window.TEMPL_FACTORY_ADDRESS = factoryAddress;
    }, templFactoryAddress);

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'TEMPL Control Center' })).toBeVisible();

    const connectButton = page.getByRole('button', { name: 'Connect Wallet' });
    await expect(connectButton).toBeVisible();
    await connectButton.click();
    await expect(page.getByText(/Wallet connected:/)).toBeVisible();

    await page.getByRole('button', { name: 'Create a Templ' }).click();
    await expect(page).toHaveURL(/\/templs\/create$/);
    await expect(page.getByRole('heading', { name: 'Create a Templ' })).toBeVisible();

    const factoryInput = page.getByLabel('Factory address');
    await expect(factoryInput).toHaveValue(templFactoryAddress);
    await page.getByLabel('Access token address').fill(tokenAddress);
    await page.getByLabel('Entry fee (wei)').fill(entryFee.toString());
    await page.getByLabel('Quorum %').fill('33');
    await page.getByLabel('Telegram chat id').fill('-100999888777');
    await page.getByLabel('Templ home link').fill('https://t.me/templ-e2e-demo');

    await page.getByRole('button', { name: 'Deploy templ' }).click();
    await expect(page.getByText(/Deploying templ/)).toBeVisible();
    await expect(page.getByText(/Templ deployed at/)).toBeVisible();

    const templAddressHandle = await page.waitForFunction(() => {
      const raw = localStorage.getItem('templ:test:deploys');
      if (!raw) return null;
      const items = JSON.parse(raw);
      if (!Array.isArray(items) || items.length === 0) return null;
      return items[items.length - 1];
    });
    const templAddress = (await templAddressHandle.jsonValue()).toLowerCase();
    const templForMember = new ethers.Contract(templAddress, templArtifact.abi, wallets.member);
    const templReadOnly = new ethers.Contract(templAddress, templArtifact.abi, provider);

    await expect(page.getByRole('heading', { name: 'Connect Telegram notifications' })).toBeVisible();
    await page.getByRole('button', { name: 'Open templ overview' }).click();
    await expect(page).toHaveURL(new RegExp(`/templs/${templAddress}`, 'i'));
    await expect(page.getByRole('heading', { name: 'Templ Overview' })).toBeVisible();

    await walletBridge.switchAccount('member');
    await page.goto(`/templs/join?address=${templAddress}`);
    await expect(page.getByRole('heading', { name: 'Join a Templ' })).toBeVisible();
    await expect(page.getByLabel('Templ address')).toHaveValue(templAddress);

    const approveButton = page.getByRole('button', { name: 'Approve entry fee' });
    await expect(approveButton).toBeEnabled();
    await approveButton.click();
    await expect(page.getByText('Approving entry fee…')).toBeVisible();
    await expect(page.getByText(/Allowance approved/)).toBeVisible();

    const purchaseButton = page.getByRole('button', { name: 'Purchase Access' });
    await expect(purchaseButton).toBeEnabled();
    await purchaseButton.click();
    await expect(page.getByText('Purchasing access…')).toBeVisible();
    await expect(page.getByText(/Access purchase complete/)).toBeVisible();

    await page.getByRole('button', { name: 'Verify Membership' }).click();
    await expect(page.getByText(/Verifying membership/)).toBeVisible();
    await expect(page.getByText(/Membership verified/)).toBeVisible();
    await expect(await templForMember.hasAccess(memberAddress)).toBe(true);

    const secondApproveTx = await token.connect(secondMember).approve(templAddress, entryFee);
    await secondApproveTx.wait();
    const templForSecondMember = new ethers.Contract(templAddress, templArtifact.abi, secondMember);
    const secondJoinTx = await templForSecondMember.purchaseAccess();
    await secondJoinTx.wait();
    await provider.send('evm_mine', []);

    await page.goto(`/templs/${templAddress}/claim`);
    await expect(page.getByRole('heading', { name: 'Claim Member Rewards' })).toBeVisible();
    const memberBalanceBefore = await token.balanceOf(memberAddress);
    const claimableBefore = await templForMember.getClaimablePoolAmount(memberAddress);
    await expect(claimableBefore).not.toBe(0n);
    const claimButton = page.getByRole('button', { name: 'Claim rewards' });
    await claimButton.click();
    await expect(page.getByText(/Claiming member pool rewards/)).toBeVisible();
    await expect(page.getByText(/Rewards claimed successfully/)).toBeVisible();
    const memberBalanceAfter = await token.balanceOf(memberAddress);
    const claimableAfter = await templForMember.getClaimablePoolAmount(memberAddress);
    const balanceDelta = memberBalanceAfter - memberBalanceBefore;
    await expect(balanceDelta).toBe(claimableBefore);
    await expect(claimableAfter).toBe(0n);

    await page.goto(`/templs/${templAddress}`);
    await expect(page.getByRole('heading', { name: 'Templ Overview' })).toBeVisible();
    const membersRow = page.locator('div.space-y-1').filter({ has: page.locator('dt', { hasText: 'Members' }) });
    await expect(membersRow.locator('dd')).toContainText('3');

    await page.getByRole('button', { name: 'New proposal' }).click();
    await expect(page).toHaveURL(new RegExp(`/templs/${templAddress}/proposals/new`));
    await page.getByLabel('Title').fill('Raise entry fee to 2 TEST');
    await page.getByLabel('Description').fill('Increase entry fee to strengthen treasury.');
    await page.getByLabel('Proposal type').selectOption('updateConfig');
    await page.getByLabel('New entry fee (wei)').fill(updatedEntryFee.toString());
    await page.getByLabel('Voting period (seconds)').fill(String(WEEK_IN_SECONDS));
    await page.getByRole('button', { name: 'Create proposal' }).click();
    await expect(page.getByText(/Submitting proposal/)).toBeVisible();
    await expect(page.getByText(/Proposal created/)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/templs/${templAddress}/proposals/0/vote`));

    await page.getByRole('button', { name: 'Submit vote' }).click();
    await expect(page.getByText(/Casting vote/)).toBeVisible();
    await expect(page.getByText(/Vote submitted/)).toBeVisible();

    await provider.send('evm_increaseTime', [WEEK_IN_SECONDS + 60]);
    await provider.send('evm_mine', []);

    const execTx = await templForMember.executeProposal(0);
    await execTx.wait();
    await provider.send('evm_mine', []);

    await page.goto(`/templs/${templAddress}`);
    await expect(page.getByRole('heading', { name: 'Templ Overview' })).toBeVisible();
    await page.getByRole('button', { name: 'Refresh proposals' }).click();
    const proposalItem = page.locator('li').filter({ hasText: '#0' });
    await expect(proposalItem.locator('span').filter({ hasText: 'Executed' })).toBeVisible();

    const entryFeeRow = page.locator('div.space-y-1').filter({ has: page.locator('dt', { hasText: 'Entry fee' }) });
    await expect(entryFeeRow.locator('dd')).toContainText('2');
    const entryFeeOnChain = await templReadOnly.entryFee();
    await expect(entryFeeOnChain).toBe(updatedEntryFee);
  });
});
