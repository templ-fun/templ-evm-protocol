import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { Wallet } from 'ethers';
import { Client } from '@xmtp/node-sdk';
import { createXmtpWithRotation } from '../src/server.js';

test('createXmtpWithRotation respects maxAttempts', async () => {
  const wallet = new Wallet('0x' + '1'.repeat(64));
  const origCreate = Client.create;
  const spy = mock.fn(async () => {
    throw new Error('already registered 10/10 installations');
  });
  Client.create = spy;
  await assert.rejects(
    () => createXmtpWithRotation(wallet, 2),
    /Unable to register XMTP client after nonce rotation/
  );
  assert.equal(spy.mock.callCount(), 2);
  Client.create = origCreate;
});
