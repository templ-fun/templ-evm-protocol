import test from 'node:test';
import assert from 'node:assert/strict';
import { Wallet } from 'ethers';

import { verifyTypedSignature, createSignatureStore } from '../src/middleware/validate.js';
import { buildJoinTypedData } from '../../shared/signing.js';

process.env.NODE_ENV = 'test';
process.env.BACKEND_SERVER_ID = 'test-server';

function runMiddleware(middleware, body) {
  return new Promise((resolve) => {
    const req = { body };
    const res = {
      status(code) {
        return {
          json(payload) {
            resolve({ statusCode: code, body: payload });
            return this;
          }
        };
      }
    };
    const next = () => resolve({ statusCode: 200 });
    middleware(req, res, next);
  });
}

test('verifyTypedSignature treats zero expiry as expired', async () => {
  const middleware = verifyTypedSignature({
    signatureStore: createSignatureStore(),
    addressField: 'memberAddress',
    buildTyped: () => ({ message: { expiry: '0' } })
  });

  const result = await runMiddleware(middleware, {
    memberAddress: Wallet.createRandom().address,
    signature: '0x1'
  });

  assert.equal(result.statusCode, 403);
  assert.deepEqual(result.body, { error: 'Signature expired' });
});

test('createSignatureStore normalises signature casing', () => {
  const store = createSignatureStore();
  assert.equal(store.consume('0xabcdef'), true);
  assert.equal(store.consume('0xABCDEF'), false);
});

test('verifyTypedSignature treats negative expiry as expired', async () => {
  const middleware = verifyTypedSignature({
    signatureStore: createSignatureStore(),
    addressField: 'memberAddress',
    buildTyped: () => ({ message: { expiry: '-100' } })
  });

  const result = await runMiddleware(middleware, {
    memberAddress: Wallet.createRandom().address,
    signature: '0x1'
  });

  assert.equal(result.statusCode, 403);
  assert.deepEqual(result.body, { error: 'Signature expired' });
});

test('verifyTypedSignature allows future expiry', async () => {
  const signatureStore = createSignatureStore();
  const middleware = verifyTypedSignature({
    signatureStore,
    addressField: 'memberAddress',
    buildTyped: (req) => {
      return buildJoinTypedData({
        chainId: Number(req.body.chainId),
        contractAddress: req.body.contractAddress.toLowerCase(),
        nonce: Number(req.body.nonce),
        issuedAt: Number(req.body.issuedAt),
        expiry: Number(req.body.expiry)
      });
    }
  });

  const wallet = Wallet.createRandom();
  const chainId = 1337;
  const contractAddress = wallet.address.toLowerCase();
  const issuedAt = Date.now();
  const nonce = issuedAt + 123;
  const expiry = issuedAt + 60_000;
  const typed = buildJoinTypedData({ chainId, contractAddress, nonce, issuedAt, expiry });
  const signature = await wallet.signTypedData(typed.domain, typed.types, typed.message);

  const result = await runMiddleware(middleware, {
    memberAddress: wallet.address,
    signature,
    contractAddress,
    chainId,
    nonce,
    issuedAt,
    expiry
  });

  assert.equal(result.statusCode, 200);
});

test('verifyTypedSignature rejects reused signature regardless of casing', async () => {
  const signatureStore = createSignatureStore();
  const middleware = verifyTypedSignature({
    signatureStore,
    addressField: 'memberAddress',
    buildTyped: (req) => {
      return buildJoinTypedData({
        chainId: Number(req.body.chainId),
        contractAddress: req.body.contractAddress.toLowerCase(),
        nonce: Number(req.body.nonce),
        issuedAt: Number(req.body.issuedAt),
        expiry: Number(req.body.expiry)
      });
    }
  });

  const wallet = Wallet.createRandom();
  const chainId = 1337;
  const contractAddress = wallet.address.toLowerCase();
  const issuedAt = Date.now();
  const nonce = issuedAt + 456;
  const expiry = issuedAt + 60_000;
  const typed = buildJoinTypedData({ chainId, contractAddress, nonce, issuedAt, expiry });
  const signature = await wallet.signTypedData(typed.domain, typed.types, typed.message);
  const signatureUpper = `0x${signature.slice(2).toUpperCase()}`;

  const first = await runMiddleware(middleware, {
    memberAddress: wallet.address,
    signature,
    contractAddress,
    chainId,
    nonce,
    issuedAt,
    expiry
  });
  assert.equal(first.statusCode, 200);

  const second = await runMiddleware(middleware, {
    memberAddress: wallet.address,
    signature: signatureUpper,
    contractAddress,
    chainId,
    nonce,
    issuedAt,
    expiry
  });
  assert.equal(second.statusCode, 409);
  assert.deepEqual(second.body, { error: 'Signature already used' });
});
