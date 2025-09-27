import test from 'node:test';
import assert from 'node:assert/strict';

import { joinTempl } from '../src/services/joinTempl.js';

test('joinTempl rejects malformed addresses', async () => {
  const templs = new Map();
  templs.set('0x1234567890abcdef1234567890abcdef12345678', { telegramChatId: null, priest: null, templHomeLink: '' });

  await assert.rejects(
    joinTempl(
      {
        contractAddress: '0xzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz',
        memberAddress: '0xzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz'
      },
      {
        templs,
        hasPurchased: async () => true
      }
    ),
    /Invalid contractAddress/
  );
});

test('joinTempl verifies membership for valid addresses', async () => {
  const contract = '0x0000000000000000000000000000000000000001';
  const member = '0x0000000000000000000000000000000000000002';
  const templs = new Map();
  templs.set(contract, { telegramChatId: null, priest: null, templHomeLink: '' });

  const result = await joinTempl(
    { contractAddress: contract, memberAddress: member },
    {
      templs,
      hasPurchased: async (addr, user) => addr === contract && user === member
    }
  );

  assert.equal(result.member.address, member);
  assert.equal(result.member.hasAccess, true);
});
