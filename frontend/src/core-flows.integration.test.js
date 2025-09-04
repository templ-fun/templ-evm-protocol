/* eslint-env node */
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import { setTimeout as wait } from 'timers/promises';
import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import {
  deployTempl,
  purchaseAndJoin,
  sendMessage,
  delegateMute,
  muteMember,
  fetchActiveMutes,
  proposeVote,
  voteOnProposal,
  executeProposal
} from './flows.js';
import { createApp, createXmtpWithRotation } from '../../backend/src/server.js';

let templArtifact;
let tokenArtifact;
let priestNonce;
let memberNonce;

describe('core flows e2e', () => {
  let hardhat;
  let provider;
  let priestSigner;
  let memberSigner;
  let delegateSigner;
  let xmtpPriest;
  let xmtpMember;
  let xmtpServer;
  let server;
  let templAddress;
  let tokenAddress;
  let group;

  beforeAll(async () => {
    console.log('[setup] starting beforeAll: compiling, hardhat, XMTP, backend');
    const repoRoot = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));

    // Compile contracts to ensure artifacts exist
    await new Promise((resolve, reject) => {
      const compile = spawn('npx', ['hardhat', 'compile'], {
        cwd: repoRoot,
        stdio: 'inherit'
      });
      compile.on('exit', code => (code === 0 ? resolve() : reject(new Error('compile failed'))));
    });

    templArtifact = JSON.parse(
      readFileSync(
        new URL('../../artifacts/contracts/TEMPL.sol/TEMPL.json', import.meta.url)
      )
    );
    tokenArtifact = JSON.parse(
      readFileSync(
        new URL('../../artifacts/contracts/TestToken.sol/TestToken.json', import.meta.url)
      )
    );

    hardhat = spawn('npx', ['hardhat', 'node'], {
      cwd: repoRoot,
      stdio: 'inherit'
    });
    console.log('[setup] launched hardhat node, waiting for JSON-RPC...');
    await wait(5000);
    provider = new ethers.JsonRpcProvider('http://127.0.0.1:8545');
    const funder = new ethers.Wallet(
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
      provider
    );
    priestSigner = ethers.Wallet.createRandom().connect(provider);
    memberSigner = ethers.Wallet.createRandom().connect(provider);
    // Use a fresh delegate each run to avoid XMTP dev installation limits
    delegateSigner = ethers.Wallet.createRandom().connect(provider);

    // fund all signers with ETH for gas
    let nonce = await funder.getNonce();
    for (const wallet of [priestSigner, memberSigner, delegateSigner]) {
      const tx = await funder.sendTransaction({
        to: await wallet.getAddress(),
        value: ethers.parseEther('1'),
        nonce: nonce++
      });
      await tx.wait();
    }

    xmtpServer = await createXmtpWithRotation(delegateSigner, 20);
    xmtpPriest = await createXmtpWithRotation(priestSigner, 20);
    xmtpMember = await createXmtpWithRotation(memberSigner, 20);

    console.log('XMTP clients created:', {
      server: xmtpServer.inboxId,
      priest: xmtpPriest.inboxId,
      member: xmtpMember.inboxId
    });

    console.log('[setup] syncing conversations for all clients...');
    await xmtpServer.conversations.sync();
    await xmtpPriest.conversations.sync();
    await xmtpMember.conversations.sync();

    const app = createApp({
      xmtp: xmtpServer,
      hasPurchased: async (contractAddr, memberAddr) => {
        const c = new ethers.Contract(contractAddr, templArtifact.abi, provider);
        return c.hasAccess(memberAddr);
      },
      connectContract: (addr) => new ethers.Contract(addr, templArtifact.abi, provider)
    });
    console.log('[setup] starting backend on :3001');
    server = app.listen(3001);

    const tokenFactory = new ethers.ContractFactory(
      tokenArtifact.abi,
      tokenArtifact.bytecode,
      priestSigner
    );
    const token = await tokenFactory.deploy('Test', 'TEST', 18);
    await token.waitForDeployment();
    tokenAddress = await token.getAddress();
    priestNonce = await priestSigner.getNonce();
    let tx = await token.mint(await priestSigner.getAddress(), 1000n, {
      nonce: priestNonce++
    });
    await tx.wait();
    tx = await token.mint(await memberSigner.getAddress(), 1000n, {
      nonce: priestNonce++
    });
    await tx.wait();
    memberNonce = await memberSigner.getNonce();
  }, 180000);

  afterAll(async () => {
    server?.close();
    xmtpServer?.close?.();
    xmtpPriest?.close?.();
    xmtpMember?.close?.();
    hardhat?.kill();
  });

  it('runs through all core flows', async () => {
    const deployResult = await deployTempl({
      ethers,
      xmtp: xmtpPriest,
      signer: priestSigner,
      walletAddress: await priestSigner.getAddress(),
      tokenAddress,
      protocolFeeRecipient: await delegateSigner.getAddress(),
      entryFee: 100,
      templArtifact,
      txOptions: { nonce: priestNonce++ }
    });
    templAddress = deployResult.contractAddress;
    group = deployResult.group;
    // Verify deployment results
    expect(templAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(deployResult.groupId).toBeTypeOf('string');
    const templ = new ethers.Contract(templAddress, templArtifact.abi, provider);
    expect(await templ.accessToken()).toBe(tokenAddress);
    expect(await templ.protocolFeeRecipient()).toBe(await delegateSigner.getAddress());
    expect(await templ.entryFee()).toBe(100n);

    const tokenMember = new ethers.Contract(
      tokenAddress,
      tokenArtifact.abi,
      memberSigner
    );
    let tx = await tokenMember.approve(templAddress, 100n, {
      nonce: memberNonce++
    });
    await tx.wait();
    expect(await tokenMember.allowance(await memberSigner.getAddress(), templAddress)).toBe(100n);

    const pj = await purchaseAndJoin({
      ethers,
      xmtp: xmtpMember,
      signer: memberSigner,
      walletAddress: await memberSigner.getAddress(),
      templAddress,
      templArtifact,
      txOptions: { nonce: memberNonce++ }
    });
    expect(pj.groupId).toBeDefined();
    expect(await templ.hasAccess(await memberSigner.getAddress())).toBe(true);

    await sendMessage({ group, content: 'hello' });
    // Give the network a beat and confirm server can still see the group
    await wait(500);

    const delegated = await delegateMute({
      signer: priestSigner,
      contractAddress: templAddress,
      priestAddress: await priestSigner.getAddress(),
      delegateAddress: await delegateSigner.getAddress()
    });
    expect(delegated).toBe(true);

    const mutedUntil = await muteMember({
      signer: delegateSigner,
      contractAddress: templAddress,
      moderatorAddress: await delegateSigner.getAddress(),
      targetAddress: await memberSigner.getAddress()
    });
    expect(mutedUntil).toBeGreaterThan(0);

    const mutes = await fetchActiveMutes({ contractAddress: templAddress });
    expect(mutes.map(m => m.address.toLowerCase())).toContain((await memberSigner.getAddress()).toLowerCase());

    const iface = new ethers.Interface(templArtifact.abi);
    const callData = iface.encodeFunctionData('setPausedDAO', [true]);

    await proposeVote({
      ethers,
      signer: memberSigner, // Use member who has purchased access
      templAddress,
      templArtifact,
      title: 't',
      description: 'd',
      callData,
      votingPeriod: 7 * 24 * 60 * 60,
      txOptions: { nonce: memberNonce++ }
    });
    // Verify proposal created
    const [proposer, title,, yesVotes, noVotes] = await templ.getProposal(0);
    expect(proposer.toLowerCase()).toBe((await memberSigner.getAddress()).toLowerCase());
    expect(title).toBe('t');
    expect(yesVotes).toBe(0n);
    expect(noVotes).toBe(0n);

    await voteOnProposal({
      ethers,
      signer: memberSigner,
      templAddress,
      templArtifact,
      proposalId: 0,
      support: true,
      txOptions: { nonce: memberNonce++ }
    });
    const voted = await templ.hasVoted(0, await memberSigner.getAddress());
    expect(voted[0]).toBe(true);

    await provider.send('evm_increaseTime', [7 * 24 * 60 * 60]);
    await provider.send('evm_mine', []);

    await executeProposal({
      ethers,
      signer: priestSigner,
      templAddress,
      templArtifact,
      proposalId: 0,
      txOptions: { nonce: priestNonce++ }
    });
    expect(await templ.paused()).toBe(true);
  }, 120000);
});
