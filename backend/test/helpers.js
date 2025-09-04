import { Wallet } from 'ethers';
import { createApp } from '../src/server.js';

export const wallets = {
  priest: new Wallet('0x' + '2'.repeat(64)),
  member: new Wallet('0x' + '3'.repeat(64)),
  stranger: new Wallet('0x' + '4'.repeat(64)),
  delegate: new Wallet('0x' + '5'.repeat(64))
};

export const makeApp = (opts = {}) => createApp({ dbPath: ':memory:', ...opts });
