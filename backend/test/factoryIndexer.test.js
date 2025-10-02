import test from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';

import { createFactoryIndexer } from '../src/services/factoryIndexer.js';

const FACTORY_EVENT_ABI = [
  'event TemplCreated(address indexed templ, address indexed creator, address indexed priest, address token, uint256 entryFee, uint256 burnPercent, uint256 treasuryPercent, uint256 memberPoolPercent, uint256 quorumPercent, uint256 executionDelaySeconds, address burnAddress, bool priestIsDictator, uint256 maxMembers, string homeLink)'
];

const iface = new ethers.Interface(FACTORY_EVENT_ABI);

class MockProvider {
  constructor({ logs = [], blockNumber = 10 } = {}) {
    this.logs = logs;
    this.blockNumber = blockNumber;
    this.listeners = new Set();
  }

  async getBlockNumber() {
    return this.blockNumber;
  }

  async getLogs(filter) {
    return this.logs.filter((log) => this.#matches(filter, log));
  }

  async getNetwork() {
    return { chainId: 1337n }; // only used for caching in server context
  }

  on(filter, listener) {
    this.listeners.add({ filter, listener });
  }

  off(filter, listener) {
    for (const entry of Array.from(this.listeners)) {
      if (this.#isSameFilter(entry.filter, filter) && entry.listener === listener) {
        this.listeners.delete(entry);
      }
    }
  }

  emitLog(log) {
    this.logs.push(log);
    for (const entry of this.listeners) {
      if (this.#matches(entry.filter, log)) {
        entry.listener(log);
      }
    }
  }

  #isSameFilter(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    const addrA = a.address ? String(a.address).toLowerCase() : '';
    const addrB = b.address ? String(b.address).toLowerCase() : '';
    if (addrA !== addrB) return false;
    const topicsA = Array.isArray(a.topics) ? a.topics.map((topic) => (topic ? topic.toString().toLowerCase() : null)) : [];
    const topicsB = Array.isArray(b.topics) ? b.topics.map((topic) => (topic ? topic.toString().toLowerCase() : null)) : [];
    if (topicsA.length !== topicsB.length) return false;
    for (let i = 0; i < topicsA.length; i += 1) {
      const valueA = topicsA[i];
      const valueB = topicsB[i];
      if (valueA !== valueB) return false;
    }
    return true;
  }

  #matches(filter, log) {
    if (!filter) return true;
    if (filter.address) {
      const addresses = Array.isArray(filter.address) ? filter.address : [filter.address];
      const lower = addresses.filter(Boolean).map((value) => String(value).toLowerCase());
      if (!lower.includes(String(log.address || '').toLowerCase())) {
        return false;
      }
    }
    if (filter.topics) {
      const topics = Array.isArray(filter.topics) ? filter.topics : [filter.topics];
      for (let i = 0; i < topics.length; i += 1) {
        const expected = topics[i];
        if (!expected) continue;
        const actual = String(log.topics?.[i] || '').toLowerCase();
        if (Array.isArray(expected)) {
          const variants = expected.filter(Boolean).map((topic) => String(topic).toLowerCase());
          if (!variants.includes(actual)) {
            return false;
          }
        } else if (actual !== String(expected).toLowerCase()) {
          return false;
        }
      }
    }
    return true;
  }
}

function buildTemplCreatedLog({
  factoryAddress,
  templAddress,
  creator,
  priest,
  token,
  homeLink = ''
}) {
  const canonicalFactory = ethers.getAddress(factoryAddress);
  const canonicalTempl = ethers.getAddress(templAddress);
  const canonicalCreator = ethers.getAddress(creator);
  const canonicalPriest = ethers.getAddress(priest);
  const canonicalToken = ethers.getAddress(token);
  const entryFee = 1000n;
  const burnPercent = 3000n;
  const treasuryPercent = 3000n;
  const memberPoolPercent = 3000n;
  const quorumPercent = 3300n;
  const executionDelay = 604800n;
  const burnAddress = '0x000000000000000000000000000000000000dEaD';
  const priestIsDictator = false;
  const maxMembers = 0n;

  const { topics, data } = iface.encodeEventLog('TemplCreated', [
    canonicalTempl,
    canonicalCreator,
    canonicalPriest,
    canonicalToken,
    entryFee,
    burnPercent,
    treasuryPercent,
    memberPoolPercent,
    quorumPercent,
    executionDelay,
    burnAddress,
    priestIsDictator,
    maxMembers,
    homeLink
  ]);

  return {
    address: canonicalFactory,
    topics,
    data,
    blockNumber: 5,
    blockHash: ethers.ZeroHash,
    transactionHash: ethers.hashMessage(canonicalTempl),
    logIndex: 0
  };
}

test('factory indexer registers historical templ logs', async () => {
  const factoryAddress = ethers.getAddress('0x1234567890abcdef1234567890abcdef12345678');
  process.env.TRUSTED_FACTORY_ADDRESS = factoryAddress;
  const templAddress = ethers.getAddress('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  const priest = ethers.getAddress('0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  const log = buildTemplCreatedLog({
    factoryAddress,
    templAddress,
    creator: priest,
    priest,
    token: '0xcccccccccccccccccccccccccccccccccccccccc'
  });

  const provider = new MockProvider({ logs: [log] });
  const templs = new Map();
  const calls = [];

  const indexer = createFactoryIndexer({
    provider,
    templs,
    logger: null,
    fromBlock: 0,
    onTemplDiscovered: async ({ templAddress: address, priestAddress, homeLink }) => {
      calls.push({ address, priestAddress, homeLink });
      templs.set(address.toLowerCase(), { contractAddress: address.toLowerCase() });
    }
  });

  await indexer.start();
  await indexer.stop();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].address, templAddress);
  assert.equal(calls[0].priestAddress, priest);

  delete process.env.TRUSTED_FACTORY_ADDRESS;
});

test('factory indexer processes live events and ignores duplicates', async () => {
  const factoryAddress = ethers.getAddress('0x1234567890abcdef1234567890abcdef12345678');
  process.env.TRUSTED_FACTORY_ADDRESS = factoryAddress;
  const firstTempl = ethers.getAddress('0x1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f');
  const secondTempl = ethers.getAddress('0x2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f');
  const priest = ethers.getAddress('0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');

  const provider = new MockProvider();
  const templs = new Map();
  const calls = [];

  const indexer = createFactoryIndexer({
    provider,
    templs,
    logger: null,
    onTemplDiscovered: async ({ templAddress: address }) => {
      calls.push(address);
      templs.set(address.toLowerCase(), { contractAddress: address.toLowerCase() });
    }
  });

  await indexer.start();

  provider.emitLog(
    buildTemplCreatedLog({
      factoryAddress,
      templAddress: firstTempl,
      creator: priest,
      priest,
      token: '0xcccccccccccccccccccccccccccccccccccccccc'
    })
  );
  provider.emitLog(
    buildTemplCreatedLog({
      factoryAddress,
      templAddress: firstTempl,
      creator: priest,
      priest,
      token: '0xcccccccccccccccccccccccccccccccccccccccc'
    })
  );
  provider.emitLog(
    buildTemplCreatedLog({
      factoryAddress,
      templAddress: secondTempl,
      creator: priest,
      priest,
      token: '0xdddddddddddddddddddddddddddddddddddddddd'
    })
  );

  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(calls, [firstTempl, secondTempl]);

  await indexer.stop();

  provider.emitLog(
    buildTemplCreatedLog({
      factoryAddress,
      templAddress: '0x3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f3f',
      creator: priest,
      priest,
      token: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
    })
  );

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls.length, 2, 'stop should remove listeners');

  delete process.env.TRUSTED_FACTORY_ADDRESS;
});
