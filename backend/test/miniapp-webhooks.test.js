import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createJsonFarcasterSignature } from '@farcaster/miniapp-node';
import { createApp } from '../src/server.js';
import { createMemoryPersistence } from '../src/persistence/index.js';

process.env.NODE_ENV = 'test';

function decodeHeader(signature) {
  const headerJson = Buffer.from(signature.header, 'base64url').toString('utf8');
  return JSON.parse(headerJson);
}

function signEvent({ event, notificationDetails }, privateKey, fid = 123) {
  const payload = Buffer.from(JSON.stringify({ event, notificationDetails }), 'utf8');
  return createJsonFarcasterSignature({ fid, type: 'app_key', privateKey, payload });
}

test('miniapp webhooks store and clear notification tokens', async () => {
  const privateKey = Uint8Array.from({ length: 32 }, (_, i) => (i + 1) % 256);
  const persistence = createMemoryPersistence();

  const addedSignature = signEvent(
    {
      event: 'miniapp_added',
      notificationDetails: {
        url: 'https://notify.templ.fun/callback',
        token: 'invite-token'
      }
    },
    privateKey,
    456
  );
  const header = decodeHeader(addedSignature);

  const verifyMiniAppAppKey = async (fid, appKey) => {
    assert.equal(fid, 456);
    assert.equal(appKey.toLowerCase(), header.key.toLowerCase());
    return { valid: true, appFid: 999 };
  };

  const app = await createApp({ persistence, verifyMiniAppAppKey });

  await request(app)
    .post('/miniapp/webhooks')
    .send(addedSignature)
    .expect(200);

  const storedAfterAdd = await persistence.listMiniAppNotifications();
  assert.equal(storedAfterAdd.length, 1);
  const stored = storedAfterAdd[0];
  assert.equal(stored.token, 'invite-token');
  assert.equal(stored.fid, 456);
  assert.equal(stored.appFid, 999);
  assert.equal(stored.url, 'https://notify.templ.fun/callback');
  assert.ok(stored.createdAt > 0);
  assert.ok(stored.updatedAt >= stored.createdAt);

  const disabledSignature = signEvent({ event: 'notifications_disabled' }, privateKey, 456);
  await request(app)
    .post('/miniapp/webhooks')
    .send(disabledSignature)
    .expect(200);

  const storedAfterDisable = await persistence.listMiniAppNotifications();
  assert.equal(storedAfterDisable.length, 0);
});

test('invalid webhook payload returns 400', async () => {
  const persistence = createMemoryPersistence();
  const app = await createApp({ persistence, verifyMiniAppAppKey: async () => ({ valid: true, appFid: 1 }) });

  await request(app)
    .post('/miniapp/webhooks')
    .send({ header: 'bad', payload: 'bad', signature: 'bad' })
    .expect(400);
});
