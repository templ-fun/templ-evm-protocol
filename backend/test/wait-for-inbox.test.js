import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@xmtp/node-sdk';

const originalEnv = { ...process.env };

const loadModule = async () => {
  const waitMod = await import(`../../shared/wait.js?test=${Math.random()}`);
  const logMod = await import('../../shared/logging.js');
  return { ...waitMod, ...logMod };
};

test('waitForInboxReady returns true and logs on success', { concurrency: false }, async () => {
  process.env.NODE_ENV = 'development';
  process.env.XMTP_ENV = 'dev';
  delete process.env.DISABLE_XMTP_WAIT;
  const { waitForInboxReady, logger } = await loadModule();
  const info = mock.fn();
  const debug = mock.fn();
  const origInfo = logger.info;
  const origDebug = logger.debug;
  logger.info = info;
  logger.debug = debug;
  const orig = Client.inboxStateFromInboxIds;
  const fakeStates = [{ inboxId: 'abc', registered: true }];
  Client.inboxStateFromInboxIds = async (ids) => {
    assert.deepEqual(ids, ['abc']);
    return fakeStates;
  };
  const res = await waitForInboxReady('abc', 1, Client);
  assert.equal(res, true);
  assert.equal(info.mock.callCount(), 1);
  assert.equal(debug.mock.callCount(), 0);
  assert.deepEqual(info.mock.calls[0].arguments[0], { inboxId: 'abc', states: fakeStates });
  assert.equal(info.mock.calls[0].arguments[1], 'Inbox states (inboxStateFromInboxIds)');
  Client.inboxStateFromInboxIds = orig;
  logger.info = origInfo;
  logger.debug = origDebug;
  Object.assign(process.env, originalEnv);
});

test('waitForInboxReady logs debug on failure and returns false', { concurrency: false }, async () => {
  process.env.NODE_ENV = 'development';
  process.env.XMTP_ENV = 'dev';
  delete process.env.DISABLE_XMTP_WAIT;
  const { waitForInboxReady, logger } = await loadModule();
  const info = mock.fn();
  const debug = mock.fn();
  const origInfo = logger.info;
  const origDebug = logger.debug;
  logger.info = info;
  logger.debug = debug;
  const orig = Client.inboxStateFromInboxIds;
  Client.inboxStateFromInboxIds = async () => {
    throw new Error('fail');
  };
  const res = await waitForInboxReady('abc', 1, Client);
  assert.equal(res, false);
  assert.equal(info.mock.callCount(), 0);
  assert.equal(debug.mock.callCount(), 1);
  assert.equal(debug.mock.calls[0].arguments[1], 'Inbox state check failed');
  Client.inboxStateFromInboxIds = orig;
  logger.info = origInfo;
  logger.debug = origDebug;
  Object.assign(process.env, originalEnv);
});

test('waitForInboxReady skips network checks in test env', { concurrency: false }, async () => {
  process.env.NODE_ENV = 'test';
  process.env.XMTP_ENV = 'dev';
  delete process.env.DISABLE_XMTP_WAIT;
  const { waitForInboxReady, logger } = await loadModule();
  const info = mock.fn();
  const debug = mock.fn();
  const origInfo = logger.info;
  const origDebug = logger.debug;
  logger.info = info;
  logger.debug = debug;
  const orig = Client.inboxStateFromInboxIds;
  const spy = mock.fn(async () => []);
  Client.inboxStateFromInboxIds = spy;
  const res = await waitForInboxReady('abc', 1, Client);
  assert.equal(res, true);
  assert.equal(spy.mock.callCount(), 0);
  assert.equal(info.mock.callCount(), 0);
  assert.equal(debug.mock.callCount(), 0);
  Client.inboxStateFromInboxIds = orig;
  logger.info = origInfo;
  logger.debug = origDebug;
  Object.assign(process.env, originalEnv);
});
