import test from 'node:test';
import assert from 'node:assert/strict';
import { Wallet, ethers } from 'ethers';

import { ensureTemplFromFactory } from '../src/services/contractValidation.js';
import { TEMPL_CREATED_TOPICS } from '../src/constants/templFactoryEvents.js';

test('ensureTemplFromFactory paginates log lookups on provider errors', async () => {
  const factoryAddress = Wallet.createRandom().address;
  const templAddress = Wallet.createRandom().address;
  const templTopic = ethers.zeroPadValue(templAddress, 32);
  let attempts = 0;
  const provider = {
    async getBlockNumber() {
      return 500;
    },
    async getLogs({ address, topics, fromBlock, toBlock }) {
      attempts += 1;
      assert.equal(address, factoryAddress);
      assert.deepEqual(topics?.[0], TEMPL_CREATED_TOPICS);
      assert.equal(topics?.[1], templTopic);
      if (toBlock - fromBlock > 100) {
        const err = new Error('block range too large');
        err.code = 'RANGE';
        throw err;
      }
      if (fromBlock <= 12 && toBlock >= 12) {
        return [{ blockNumber: 12 }];
      }
      return [];
    }
  };

  await ensureTemplFromFactory({ provider, contractAddress: templAddress, factoryAddress });
  assert.ok(attempts > 1, 'expected multiple attempts due to pagination');

  const before = attempts;
  await ensureTemplFromFactory({ provider, contractAddress: templAddress, factoryAddress });
  assert.equal(attempts, before, 'cached validation should not re-query logs');
});

test('ensureTemplFromFactory rejects when templ not created by factory', async () => {
  const factoryAddress = Wallet.createRandom().address;
  const templAddress = Wallet.createRandom().address;
  const templTopic = ethers.zeroPadValue(templAddress, 32);
  const provider = {
    async getBlockNumber() {
      return 10;
    },
    async getLogs({ address, topics }) {
      assert.equal(address, factoryAddress);
      assert.deepEqual(topics?.[0], TEMPL_CREATED_TOPICS);
      assert.equal(topics?.[1], templTopic);
      return [];
    }
  };

  await assert.rejects(
    () => ensureTemplFromFactory({ provider, contractAddress: templAddress, factoryAddress }),
    (err) => {
      assert.equal(err?.statusCode, 403);
      return true;
    }
  );
});
