import test from 'node:test';
import assert from 'node:assert/strict';

import { ensureTemplFromFactory } from '../src/services/contractValidation.js';

test('ensureTemplFromFactory paginates log lookups', async () => {
  const contractAddress = '0x0000000000000000000000000000000000000001';
  const factoryAddress = '0x0000000000000000000000000000000000000002';
  const calls = [];
  const provider = {
    async getBlockNumber() {
      return 1000;
    },
    async getLogs(filter) {
      calls.push(filter);
      if (filter.fromBlock === undefined || filter.toBlock === undefined) {
        throw new Error('missing range');
      }
      if (filter.toBlock >= 400) {
        return [{ blockNumber: 400 }];
      }
      return [];
    }
  };

  await ensureTemplFromFactory({ provider, contractAddress, factoryAddress });

  assert.equal(calls.length > 0, true);
  for (const call of calls) {
    assert.equal(typeof call.fromBlock, 'number');
    assert.equal(typeof call.toBlock, 'number');
    assert.ok(call.toBlock >= call.fromBlock);
  }
});

test('ensureTemplFromFactory respects configured deployment block', async () => {
  const contractAddress = '0x0000000000000000000000000000000000000003';
  const factoryAddress = '0x0000000000000000000000000000000000000004';
  const calls = [];
  const provider = {
    async getBlockNumber() {
      return 1000;
    },
    async getLogs(filter) {
      calls.push(filter);
      if (filter.fromBlock < 900) {
        throw new Error('range too low');
      }
      return [{ blockNumber: 950 }];
    }
  };

  process.env.TRUSTED_FACTORY_DEPLOYMENT_BLOCK = '900';

  try {
    await ensureTemplFromFactory({ provider, contractAddress, factoryAddress });
    assert.equal(calls[0].fromBlock, 900);
    assert.equal(calls[0].toBlock >= 900, true);
  } finally {
    delete process.env.TRUSTED_FACTORY_DEPLOYMENT_BLOCK;
  }
});
