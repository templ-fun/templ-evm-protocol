import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { ethers } from 'ethers';
import { requireAddresses, verifySignature } from '../src/middleware/validate.js';

// Positive case for address validation
test('requireAddresses allows valid addresses', async () => {
  const app = express();
  app.use(express.json());
  app.post('/', requireAddresses(['a', 'b']), (req, res) => {
    res.json({ ok: true });
  });
  const w1 = ethers.Wallet.createRandom();
  const w2 = ethers.Wallet.createRandom();
  const res = await request(app)
    .post('/')
    .send({ a: w1.address, b: w2.address });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
});

// Negative case for address validation
test('requireAddresses rejects invalid addresses', async () => {
  const app = express();
  app.use(express.json());
  app.post('/', requireAddresses(['a']), (req, res) => {
    res.json({ ok: true });
  });
  const res = await request(app).post('/').send({ a: '0x123' });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: 'Invalid addresses' });
});

// Positive case for signature verification
test('verifySignature accepts valid signature', async () => {
  const wallet = ethers.Wallet.createRandom();
  const app = express();
  app.use(express.json());
  app.post(
    '/',
    verifySignature('address', () => 'hello'),
    (req, res) => {
      res.json({ ok: true });
    }
  );
  const signature = await wallet.signMessage('hello');
  const res = await request(app)
    .post('/')
    .send({ address: wallet.address, signature });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
});

// Negative case for signature verification
test('verifySignature rejects invalid signature', async () => {
  const wallet = ethers.Wallet.createRandom();
  const other = ethers.Wallet.createRandom();
  const app = express();
  app.use(express.json());
  app.post(
    '/',
    verifySignature('address', () => 'hello'),
    (req, res) => {
      res.json({ ok: true });
    }
  );
  const signature = await other.signMessage('hello');
  const res = await request(app)
    .post('/')
    .send({ address: wallet.address, signature });
  assert.equal(res.status, 403);
  assert.deepEqual(res.body, { error: 'Bad signature' });
});
