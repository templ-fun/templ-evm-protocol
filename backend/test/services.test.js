import test from 'node:test';
import assert from 'node:assert/strict';

import { registerTempl } from '../src/services/registerTempl.js';
import { joinTempl } from '../src/services/joinTempl.js';
import { requestTemplRebind } from '../src/services/requestTemplRebind.js';

const noopContext = {
  templs: new Map(),
  persist: () => {},
  logger: { info: () => {}, warn: () => {}, error: () => {} }
};

function expectStatus(err, code) {
  assert.equal(err?.statusCode, code);
  return true;
}

test('registerTempl rejects malformed addresses', async () => {
  await assert.rejects(
    () => registerTempl({ contractAddress: '0x123', priestAddress: '0x123' }, noopContext),
    (err) => expectStatus(err, 400)
  );
});

test('registerTempl rejects invalid telegram chat ids', async () => {
  const templs = new Map();
  const context = {
    templs,
    persist: async () => {},
    watchContract: async () => {},
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  };

  await assert.rejects(
    () => registerTempl(
      {
        contractAddress: '0x1111111111111111111111111111111111111111',
        priestAddress: '0x2222222222222222222222222222222222222222',
        telegramChatId: 'group-1234'
      },
      context
    ),
    (err) => expectStatus(err, 400)
  );
});

test('registerTempl accepts numeric telegram chat ids', async () => {
  const templs = new Map();
  const context = {
    templs,
    persist: async () => {},
    watchContract: async () => {},
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  };

  await registerTempl(
    {
      contractAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      priestAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      telegramChatId: '-1001234567890'
    },
    context
  );

  assert.equal(templs.size, 1);
  const record = templs.get('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(record.telegramChatId, '-1001234567890');
});

test('joinTempl rejects malformed addresses', async () => {
  await assert.rejects(
    () => joinTempl({ contractAddress: '0x123', memberAddress: '0x123' }, { ...noopContext, hasJoined: async () => true }),
    (err) => expectStatus(err, 400)
  );
});

test('requestTemplRebind rejects malformed addresses', async () => {
  await assert.rejects(
    () => requestTemplRebind({ contractAddress: '0x123', priestAddress: '0x123' }, { ...noopContext, templs: new Map(), findBinding: () => null }),
    (err) => expectStatus(err, 400)
  );
});

test('registerTempl seeds lastDigestAt to zero for new templs', async () => {
  const templs = new Map();
  const context = {
    templs,
    persist: async () => {},
    watchContract: async () => {},
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  };

  await registerTempl(
    {
      contractAddress: '0x1111111111111111111111111111111111111111',
      priestAddress: '0x2222222222222222222222222222222222222222'
    },
    context
  );

  const record = templs.get('0x1111111111111111111111111111111111111111');
  assert(record, 'templ record should be stored');
  assert.equal(record.lastDigestAt, 0);
});

test('requestTemplRebind restores templs with zeroed lastDigestAt by default', async () => {
  const templs = new Map();
  const contract = '0x3333333333333333333333333333333333333333';
  const priest = '0x4444444444444444444444444444444444444444';
  const context = {
    templs,
    findBinding: async (addr) => {
      if (addr !== contract) return null;
      return { contract, priest, telegramChatId: null, bindingCode: null };
    },
    persist: async () => {},
    logger: { info: () => {}, warn: () => {}, error: () => {} }
  };

  await requestTemplRebind(
    {
      contractAddress: contract,
      priestAddress: priest
    },
    context
  );

  const record = templs.get(contract);
  assert(record, 'templ record should be cached during rebind');
  assert.equal(record.lastDigestAt, 0);
});
