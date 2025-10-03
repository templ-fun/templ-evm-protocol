import test from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';

import { FACTORY_EVENT_VARIANTS } from '../src/constants/templFactoryEvents.js';

test('current templ created topic matches pivotless signature', () => {
  const current = FACTORY_EVENT_VARIANTS.find((variant) => variant.id === 'current');
  assert.ok(current, 'expected current variant');
  const expected = ethers.id(
    'TemplCreated(address,address,address,address,uint256,uint256,uint256,uint256,uint256,uint256,address,bool,uint256,uint8,uint32,string)'
  );
  assert.equal(current.topic, expected);
});

test('pivoted templ created topic matches previous curve signature', () => {
  const pivoted = FACTORY_EVENT_VARIANTS.find((variant) => variant.id === 'pivoted');
  assert.ok(pivoted, 'expected pivoted variant');
  const expected = ethers.id(
    'TemplCreated(address,address,address,address,uint256,uint256,uint256,uint256,uint256,uint256,address,bool,uint256,uint8,uint32,uint8,uint32,uint16,string)'
  );
  assert.equal(pivoted.topic, expected);
});

test('compat templ created topic matches legacy signature', () => {
  const compatVariant = FACTORY_EVENT_VARIANTS.find((variant) => variant.id === 'compat');
  assert.ok(compatVariant, 'expected compat variant');
  const expected = ethers.id(
    'TemplCreated(address,address,address,address,uint256,uint256,uint256,uint256,uint256,uint256,address,bool,uint256,string)'
  );
  assert.equal(compatVariant.topic, expected);
});
