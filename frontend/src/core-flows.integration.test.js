/* eslint-env node */
import { beforeAll, afterAll, describe, it } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import { setTimeout as wait } from 'timers/promises';
import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { Client } from '@xmtp/node-sdk';
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
import { createApp } from '../../backend/src/server.js';

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
    await wait(5000);
    provider = new ethers.JsonRpcProvider('http://127.0.0.1:8545');
    const funder = new ethers.Wallet(
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
      provider
    );
    priestSigner = ethers.Wallet.createRandom().connect(provider);
    memberSigner = ethers.Wallet.createRandom().connect(provider);
    delegateSigner = new ethers.Wallet(
      '0x69ececf360048c98256e21505b1bdb79ffc09d039cd667b66f85d335ef183088',
      provider
    );

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

    const dbEncryptionKey = new Uint8Array(32);

    const createXmtpClient = async (wallet) => {
      let nonce = 0;
      while (nonce < 20) {
        try {
          return await Client.create(
            {
              type: 'EOA',
              getIdentifier: () => ({
                identifier: wallet.address.toLowerCase(),
                identifierKind: 0,
                nonce: ++nonce
              }),
              signMessage: async (message) => {
                const signature = await wallet.signMessage(message);
                return ethers.getBytes(signature);
              }
            },
            { dbEncryptionKey, env: 'dev', loggingLevel: 'off' }
          );
        } catch (err) {
          if (!String(err.message).includes('already registered 10/10 installations')) {
            throw err;
          }
        }
      }
      throw new Error('Unable to register XMTP client');
    };

    xmtpServer = await createXmtpClient(delegateSigner);
    xmtpPriest = await createXmtpClient(priestSigner);
    xmtpMember = await createXmtpClient(memberSigner);

    console.log('XMTP clients created:', {
      server: xmtpServer.inboxId,
      priest: xmtpPriest.inboxId,
      member: xmtpMember.inboxId
    });

    await xmtpServer.conversations.sync();
    await xmtpPriest.conversations.sync();
    await xmtpMember.conversations.sync();

    const app = createApp({
      xmtp: xmtpServer,
      hasPurchased: async (contractAddr, memberAddr) => {
        const c = new ethers.Contract(contractAddr, templArtifact.abi, provider);
        return c.hasPurchased(memberAddr);
      },
      connectContract: (addr) => new ethers.Contract(addr, templArtifact.abi, provider)
    });
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
  }, 30000);

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

    const tokenMember = new ethers.Contract(
      tokenAddress,
      tokenArtifact.abi,
      memberSigner
    );
    let tx = await tokenMember.approve(templAddress, 100n, {
      nonce: memberNonce++
    });
    await tx.wait();

    await purchaseAndJoin({
      ethers,
      xmtp: xmtpMember,
      signer: memberSigner,
      walletAddress: await memberSigner.getAddress(),
      templAddress,
      templArtifact,
      txOptions: { nonce: memberNonce++ }
    });

    await sendMessage({ group, content: 'hello' });

    await delegateMute({
      signer: priestSigner,
      contractAddress: templAddress,
      priestAddress: await priestSigner.getAddress(),
      delegateAddress: await delegateSigner.getAddress()
    });

    await muteMember({
      signer: delegateSigner,
      contractAddress: templAddress,
      moderatorAddress: await delegateSigner.getAddress(),
      targetAddress: await memberSigner.getAddress()
    });

    await fetchActiveMutes({ contractAddress: templAddress });

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

    await voteOnProposal({
      ethers,
      signer: memberSigner,
      templAddress,
      templArtifact,
      proposalId: 0,
      support: true,
      txOptions: { nonce: memberNonce++ }
    });

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
  }, 120000);
});

