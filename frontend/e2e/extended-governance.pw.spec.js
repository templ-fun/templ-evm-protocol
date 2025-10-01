import { test, expect, TestToken, TemplFactory } from './fixtures.js';
import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import path from 'path';
import { setupWalletBridge } from './helpers.js';

const templArtifact = JSON.parse(
  readFileSync(path.join(process.cwd(), 'src/contracts/TEMPL.json'), 'utf8')
);

const WEEK_IN_SECONDS = 7 * 24 * 60 * 60;

async function bootstrapTempl({ page, provider, wallets, extraWallets = [], entryFee = ethers.parseUnits('1', 18) }) {
  const protocolRecipient = await wallets.priest.getAddress();
  const factoryDeployer = await provider.getSigner(1);
  const factoryFactory = new ethers.ContractFactory(TemplFactory.abi, TemplFactory.bytecode, factoryDeployer);
  const templFactory = await factoryFactory.deploy(protocolRecipient, 1000);
  await templFactory.waitForDeployment();
  const templFactoryAddress = await templFactory.getAddress();
  await templFactory.connect(factoryDeployer).setPermissionless(true);

  const tokenDeployer = await provider.getSigner(2);
  const tokenFactory = new ethers.ContractFactory(TestToken.abi, TestToken.bytecode, tokenDeployer);
  const token = await tokenFactory.deploy('Test Token', 'TEST', 18);
  await token.waitForDeployment();

  const mintTargets = new Map();
  const enqueueMint = async (wallet) => {
    if (!wallet) return;
    const address = (await wallet.getAddress()).toLowerCase();
    if (mintTargets.has(address)) return;
    mintTargets.set(address, true);
    const mintTx = await token.connect(tokenDeployer).mint(address, entryFee * 20n);
    await mintTx.wait();
  };

  await enqueueMint(wallets.priest);
  await enqueueMint(wallets.member);
  for (const entry of extraWallets) {
    if (!entry?.wallet) continue;
    await enqueueMint(entry.wallet);
  }

  const walletBridge = await setupWalletBridge({ page, provider, wallets, extraWallets });

  await page.addInitScript((factoryAddress) => {
    window.TEMPL_FACTORY_ADDRESS = factoryAddress;
  }, templFactoryAddress);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'TEMPL Control Center' })).toBeVisible();

  const connectButton = page.getByRole('navigation').getByRole('button', { name: 'Connect Wallet' });
  await connectButton.click();
  await expect(page.getByText(/Wallet connected:/)).toBeVisible();

  await page.getByRole('button', { name: 'Create a Templ' }).click();
  await expect(page).toHaveURL(/\/templs\/create$/);

  const tokenAddress = await token.getAddress();
  const entryFeeTokenAmount = ethers.formatUnits(entryFee, 18);

  const advancedToggle = page.getByRole('button', { name: /Advanced mode/i });
  await advancedToggle.click();

  await expect(page.getByLabel('Factory address')).toHaveValue(templFactoryAddress);
  await page.getByLabel('Access token address').fill(tokenAddress);
  await page.getByLabel('Entry fee (token amount)').fill(entryFeeTokenAmount);
  await page.getByLabel('Quorum %').fill('33');
  await page.getByLabel('Templ home link').fill('https://t.me/templ-governance-e2e');

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

  await page.getByRole('button', { name: 'Open templ overview' }).click();
  await expect(page).toHaveURL(new RegExp(`/templs/${templAddress}`, 'i'));
  await expect(page.getByRole('heading', { name: 'Templ Overview' })).toBeVisible();

  const templForPriest = new ethers.Contract(templAddress, templArtifact.abi, wallets.priest);
  const templReadOnly = new ethers.Contract(templAddress, templArtifact.abi, provider);

  return {
    templAddress,
    templFactory,
    templFactoryAddress,
    token,
    entryFee,
    walletBridge,
    templForPriest,
    templReadOnly
  };
}

async function createProposalThroughUI({ page, templAddress, type, title, description, fillForm }) {
  await page.goto(`/templs/${templAddress}`);
  await expect(page.getByRole('heading', { name: 'Templ Overview' })).toBeVisible();
  await page.getByRole('button', { name: 'New proposal' }).click();
  await expect(page).toHaveURL(new RegExp(`/templs/${templAddress}/proposals/new`, 'i'));

  await page.getByLabel('Title').fill(title);
  await page.getByLabel('Description').fill(description);
  await page.getByLabel('Proposal type').selectOption(type);
  if (fillForm) {
    await fillForm(page);
  }
  await page.getByRole('button', { name: 'Create proposal' }).click();
  await expect(page.getByText(/Proposal created/)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/templs/${templAddress}/proposals/\\d+/vote`, 'i'));
  const match = page.url().match(/proposals\/(\d+)/i);
  const proposalId = match ? Number(match[1]) : 0;
  return proposalId;
}

async function executeProposal({ provider, templContract, proposalId }) {
  await provider.send('evm_increaseTime', [WEEK_IN_SECONDS + 60]);
  await provider.send('evm_mine', []);
  const tx = await templContract.executeProposal(proposalId);
  await tx.wait();
  await provider.send('evm_mine', []);
}
async function approveEntryFeeWithRetry(page) {
  const approveButton = page.getByRole('button', { name: 'Approve entry fee' });
  const approvingMessage = page.getByText(/Approving entry fee/);
  const allowanceMessage = page.getByText(/Allowance approved/);
  const missingMessage = page.getByText('Templ configuration missing token or entry fee.');
  for (let attempt = 0; attempt < 3; attempt++) {
    await expect(approveButton).toBeEnabled();
    await approveButton.click();
    const missingVisible = await missingMessage.waitFor({ state: 'visible', timeout: 500 }).then(() => true).catch(() => false);
    if (missingVisible) {
      await missingMessage.waitFor({ state: 'hidden', timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(100);
      continue;
    }
    await expect(approvingMessage).toBeVisible();
    await expect(allowanceMessage).toBeVisible();
    return;
  }
  throw new Error('Failed to approve entry fee after retries');
}


test.describe('Extended governance flows', () => {
  test('pause/unpause and membership cap gating operate end-to-end', async ({ page, provider, wallets }) => {
    const guestWallet = ethers.Wallet.createRandom().connect(provider);
    const funder = await provider.getSigner(0);
    await funder.sendTransaction({ to: await guestWallet.getAddress(), value: ethers.parseEther('10') });

    const { templAddress, walletBridge, templForPriest, templReadOnly } = await bootstrapTempl({
      page,
      provider,
      wallets,
      extraWallets: [{ key: 'guest', wallet: guestWallet }]
    });

    const guestAddress = await guestWallet.getAddress();
    const memberAddress = await wallets.member.getAddress();

    const pauseProposalId = await createProposalThroughUI({
      page,
      templAddress,
      type: 'pause',
      title: 'Emergency pause',
      description: 'Pause joins while treasury is audited.'
    });
    await page.getByRole('button', { name: 'Submit vote' }).click();
    await expect(page.getByText(/Vote submitted/)).toBeVisible();
    await executeProposal({ provider, templContract: templForPriest, proposalId: pauseProposalId });
    await expect(await templReadOnly.joinPaused()).toBe(true);

    await walletBridge.switchAccount('member');
    await page.goto(`/templs/join?address=${templAddress}`);
    await expect(page.getByRole('heading', { name: 'Join a Templ' })).toBeVisible();
    await approveEntryFeeWithRetry(page);
    await page.getByRole('button', { name: 'Join templ' }).click();
    await expect(page.getByText(/Join failed: Access token transfer failed/i)).toBeVisible();

    await walletBridge.switchAccount('priest');
    const unpauseProposalId = await createProposalThroughUI({
      page,
      templAddress,
      type: 'unpause',
      title: 'Resume templ operations',
      description: 'Resume joins after completing the audit.'
    });
    await page.getByRole('button', { name: 'Submit vote' }).click();
    await expect(page.getByText(/Vote submitted/)).toBeVisible();
    await executeProposal({ provider, templContract: templForPriest, proposalId: unpauseProposalId });
    await expect(await templReadOnly.joinPaused()).toBe(false);

    await walletBridge.switchAccount('member');
    await page.goto(`/templs/join?address=${templAddress}`);
    await expect(page.getByRole('button', { name: 'Join templ' })).toBeEnabled();
    await page.getByRole('button', { name: 'Join templ' }).click();
    await expect(page.getByText(/Joining templ/)).toBeVisible();
    await expect(page.getByText(/Join complete/)).toBeVisible();

    const setCapProposalId = await createProposalThroughUI({
      page,
      templAddress,
      type: 'setMaxMembers',
      title: 'Lock membership at current size',
      description: 'Hold steady at two members while we stabilize.',
      fillForm: async (formPage) => {
        await formPage.getByPlaceholder('0 for unlimited').fill('2');
      }
    });
    await page.getByRole('button', { name: 'Submit vote' }).click();
    await expect(page.getByText(/Vote submitted/)).toBeVisible();
    await executeProposal({ provider, templContract: templForPriest, proposalId: setCapProposalId });

    const resumeAfterCapProposalId = await createProposalThroughUI({
      page,
      templAddress,
      type: 'unpause',
      title: 'Resume templ after reaching cap',
      description: 'Unpause so we can check capped join behavior.'
    });
    await page.getByRole('button', { name: 'Submit vote' }).click();
    await expect(page.getByText(/Vote submitted/)).toBeVisible();
    await executeProposal({ provider, templContract: templForPriest, proposalId: resumeAfterCapProposalId });
    await expect(await templReadOnly.joinPaused()).toBe(false);

    await walletBridge.switchAccount('guest');
    await page.goto(`/templs/join?address=${templAddress}`);
    await expect(page.getByRole('heading', { name: 'Join a Templ' })).toBeVisible();
    await approveEntryFeeWithRetry(page);
    await page.getByRole('button', { name: 'Join templ' }).click();
    await expect(page.getByText(/Join failed: Access token transfer failed/i)).toBeVisible();

    await walletBridge.switchAccount('priest');
    const raiseCapProposalId = await createProposalThroughUI({
      page,
      templAddress,
      type: 'setMaxMembers',
      title: 'Expand member list',
      description: 'Increase cap to welcome new members.',
      fillForm: async (formPage) => {
        await formPage.getByPlaceholder('0 for unlimited').fill('3');
      }
    });
    await page.getByRole('button', { name: 'Submit vote' }).click();
    await expect(page.getByText(/Vote submitted/)).toBeVisible();
    await executeProposal({ provider, templContract: templForPriest, proposalId: raiseCapProposalId });

    await walletBridge.switchAccount('guest');
    await page.goto(`/templs/join?address=${templAddress}`);
    await page.getByRole('button', { name: 'Join templ' }).click();
    await expect(page.getByText(/Joining templ/)).toBeVisible();
    await expect(page.getByText(/Join complete/)).toBeVisible();

    const templForMember = new ethers.Contract(templAddress, templArtifact.abi, wallets.member);
    await expect(await templForMember.isMember(memberAddress)).toBe(true);
    const templForGuest = new ethers.Contract(templAddress, templArtifact.abi, guestWallet);
    await expect(await templForGuest.isMember(guestAddress)).toBe(true);

    await page.getByRole('navigation').getByRole('button', { name: 'Disconnect' }).click();
    await expect(page.getByRole('navigation').getByRole('button', { name: 'Connect Wallet' })).toBeVisible();
  });

  test('priest rotation, dictatorship, treasury, and disband flows succeed', async ({ page, provider, wallets }) => {
    const candidatePriest = ethers.Wallet.createRandom().connect(provider);
    const latecomerWallet = ethers.Wallet.createRandom().connect(provider);
    const postDisbandWallet = ethers.Wallet.createRandom().connect(provider);
    const funder = await provider.getSigner(0);
    for (const wallet of [candidatePriest, latecomerWallet, postDisbandWallet]) {
      await funder.sendTransaction({ to: await wallet.getAddress(), value: ethers.parseEther('10') });
    }

    const { templAddress, token, walletBridge, templForPriest, templReadOnly } = await bootstrapTempl({
      page,
      provider,
      wallets,
      extraWallets: [
        { key: 'candidatePriest', wallet: candidatePriest },
        { key: 'latecomer', wallet: latecomerWallet },
        { key: 'postDisband', wallet: postDisbandWallet }
      ]
    });

    const tokenAddress = await token.getAddress();
    const candidateAddress = await candidatePriest.getAddress();
    const latecomerAddress = await latecomerWallet.getAddress();
    const postDisbandAddress = await postDisbandWallet.getAddress();
    const memberAddress = await wallets.member.getAddress();

    await walletBridge.switchAccount('member');
    await page.goto(`/templs/join?address=${templAddress}`);
    await approveEntryFeeWithRetry(page);
    await page.getByRole('button', { name: 'Join templ' }).click();
    await expect(page.getByText(/Joining templ/)).toBeVisible();
    await expect(page.getByText(/Join complete/)).toBeVisible();

    await walletBridge.switchAccount('candidatePriest');
    await page.goto(`/templs/join?address=${templAddress}`);
    await expect(page.getByText('0.0 TEST', { exact: true })).toBeVisible();
    await approveEntryFeeWithRetry(page);
    await page.getByRole('button', { name: 'Join templ' }).click();
    await expect(page.getByText(/Joining templ/)).toBeVisible();
    await expect(page.getByText(/Join complete/)).toBeVisible();

        const templForCandidate = new ethers.Contract(templAddress, templArtifact.abi, candidatePriest);

    const treasurySeed = await templReadOnly.treasuryBalance();
    await expect(treasurySeed).not.toBe(0n);

    await walletBridge.switchAccount('priest');
    const changePriestProposalId = await createProposalThroughUI({
      page,
      templAddress,
      type: 'changePriest',
      title: 'Rotate priest leadership',
      description: 'Nominate a new steward for the templ.',
      fillForm: async (formPage) => {
        await formPage.getByLabel('New priest address').fill(candidateAddress);
      }
    });
    await page.getByRole('button', { name: 'Submit vote' }).click();
    await expect(page.getByText(/Vote submitted/)).toBeVisible();
    await executeProposal({ provider, templContract: templForPriest, proposalId: changePriestProposalId });
    await expect(await templReadOnly.priest()).toBe(candidateAddress);

    await walletBridge.switchAccount('candidatePriest');
    const enableDictProposalId = await createProposalThroughUI({
      page,
      templAddress,
      type: 'enableDictatorship',
      title: 'Enable dictatorship mode',
      description: 'Limit governance to the priest temporarily.'
    });
    await page.getByRole('button', { name: 'Submit vote' }).click();
    await expect(page.getByText(/Vote submitted/)).toBeVisible();
    await executeProposal({ provider, templContract: templForCandidate, proposalId: enableDictProposalId });
    await expect(await templReadOnly.priestIsDictator()).toBe(true);

    await walletBridge.switchAccount('member');
    await page.goto(`/templs/${templAddress}/proposals/new`);
    await expect(page.getByRole('heading', { name: 'New Proposal' })).toBeVisible();
    await page.getByLabel('Title').fill('Member attempt during dictatorship');
    await page.getByLabel('Description').fill('This should fail while dictatorship is enabled.');
    await page.getByLabel('Proposal type').selectOption('updateHomeLink');
    await page.getByLabel('New home link').fill('https://t.me/should-not-post');
    await page.getByRole('button', { name: 'Create proposal' }).click();
    await expect(page.getByText(/Proposal failed:/i)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/templs/${templAddress}/proposals/new`, 'i'));

    await walletBridge.switchAccount('candidatePriest');
    const disableDictProposalId = await createProposalThroughUI({
      page,
      templAddress,
      type: 'disableDictatorship',
      title: 'Restore member governance',
      description: 'Return proposal powers to all members.'
    });
    await page.getByRole('button', { name: 'Submit vote' }).click();
    await expect(page.getByText(/Vote submitted/)).toBeVisible();
    await executeProposal({ provider, templContract: templForCandidate, proposalId: disableDictProposalId });
    await expect(await templReadOnly.priestIsDictator()).toBe(false);

    const updatedHomeLink = 'https://t.me/templ-home-updated';
    const homeLinkProposalId = await createProposalThroughUI({
      page,
      templAddress,
      type: 'updateHomeLink',
      title: 'Refresh templ home link',
      description: 'Point to the new canonical Telegram channel.',
      fillForm: async (formPage) => {
        await formPage.getByLabel('New home link').fill(updatedHomeLink);
      }
    });
    await page.getByRole('button', { name: 'Submit vote' }).click();
    await expect(page.getByText(/Vote submitted/)).toBeVisible();
    await executeProposal({ provider, templContract: templForCandidate, proposalId: homeLinkProposalId });
    await expect(await templReadOnly.templHomeLink()).toBe(updatedHomeLink);

    const treasuryBeforeWithdraw = await templReadOnly.treasuryBalance();
    await expect(treasuryBeforeWithdraw).not.toBe(0n);
    const withdrawAmount = treasuryBeforeWithdraw > 1n ? treasuryBeforeWithdraw / 2n : treasuryBeforeWithdraw;
    const memberBalanceBefore = await token.balanceOf(memberAddress);

    const withdrawProposalId = await createProposalThroughUI({
      page,
      templAddress,
      type: 'withdrawTreasury',
      title: 'Disburse treasury rewards',
      description: 'Route half of the treasury to the founding member.',
      fillForm: async (formPage) => {
        await formPage.getByLabel('Withdrawal token (address or "ETH")').fill(tokenAddress);
        await formPage.getByLabel('Withdrawal recipient').fill(memberAddress);
        await formPage.getByLabel('Withdrawal amount (wei)').fill(withdrawAmount.toString());
        await formPage.getByLabel('Withdrawal reason').fill('Reward early community work.');
      }
    });
    await page.getByRole('button', { name: 'Submit vote' }).click();
    await expect(page.getByText(/Vote submitted/)).toBeVisible();
    await executeProposal({ provider, templContract: templForCandidate, proposalId: withdrawProposalId });

    const memberBalanceAfter = await token.balanceOf(memberAddress);
    await expect(memberBalanceAfter - memberBalanceBefore).toBe(withdrawAmount);
    const treasuryAfterWithdraw = await templReadOnly.treasuryBalance();
    await expect(treasuryAfterWithdraw).toBe(treasuryBeforeWithdraw - withdrawAmount);

    const disbandProposalId = await createProposalThroughUI({
      page,
      templAddress,
      type: 'disbandTreasury',
      title: 'Disband remaining treasury',
      description: 'Convert remaining funds into member rewards.'
    });

    await walletBridge.switchAccount('latecomer');
    await page.goto(`/templs/join?address=${templAddress}`);
    await expect(page.getByText('0.0 TEST', { exact: true })).toBeVisible();
    await approveEntryFeeWithRetry(page);
    await page.getByRole('button', { name: 'Join templ' }).click();
    await expect(page.getByText(/Joining templ/)).toBeVisible();
    await expect(page.getByText(/Join complete/)).toBeVisible();
    await expect(await templReadOnly.isMember(latecomerAddress)).toBe(true);

    await walletBridge.switchAccount('candidatePriest');
    await page.goto(`/templs/${templAddress}/proposals/${disbandProposalId}/vote`);
    await page.getByRole('button', { name: 'Submit vote' }).click();
    await expect(page.getByText(/Vote submitted/)).toBeVisible();
    await executeProposal({ provider, templContract: templForCandidate, proposalId: disbandProposalId });
    await expect(await templReadOnly.treasuryBalance()).toBe(0n);

    await walletBridge.switchAccount('postDisband');
    await page.goto(`/templs/join?address=${templAddress}`);
    await approveEntryFeeWithRetry(page);
    await page.getByRole('button', { name: 'Join templ' }).click();
    await expect(page.getByText(/Joining templ/)).toBeVisible();
    await expect(page.getByText(/Join complete/)).toBeVisible();

    const latecomerTempl = new ethers.Contract(templAddress, templArtifact.abi, latecomerWallet);
    await expect(await latecomerTempl.isMember(latecomerAddress)).toBe(true);
    const postDisbandTempl = new ethers.Contract(templAddress, templArtifact.abi, postDisbandWallet);
    await expect(await postDisbandTempl.isMember(postDisbandAddress)).toBe(true);
    const finalMemberCount = await templReadOnly.getMemberCount();
    await expect(Number(finalMemberCount)).toBeGreaterThan(4);

    await page.getByRole('navigation').getByRole('button', { name: 'Disconnect' }).click();
    await expect(page.getByRole('navigation').getByRole('button', { name: 'Connect Wallet' })).toBeVisible();
  });
});
