/* eslint-disable react-hooks/rules-of-hooks */
import { test as base, expect } from '@playwright/test';
import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Load the real compiled TestToken artifact so ERC20 transferFrom works
const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const tokenArtifactPath = path.join(
  repoRoot,
  'artifacts/contracts/TestToken.sol/TestToken.json'
);
const TestToken = JSON.parse(readFileSync(tokenArtifactPath, 'utf8'));
export { TestToken };

export const test = base.extend({
  // eslint-disable-next-line no-empty-pattern
  provider: async ({}, use) => {
    const provider = new ethers.JsonRpcProvider('http://localhost:8545');
    await use(provider);
  },

  wallets: async ({ provider }, use) => {
    // Use accounts that are different from backend's BOT_PRIVATE_KEY (which uses #0)
    const accounts = [
      '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6', // Priest (Account #3)
      '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a', // Member (Account #4)
      '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba', // Delegate (Account #5)
    ];

    const wallets = {
      priest: new ethers.Wallet(accounts[0], provider),
      member: new ethers.Wallet(accounts[1], provider),
      delegate: new ethers.Wallet(accounts[2], provider)
    };

    await use(wallets);
  }
});

export { expect };
