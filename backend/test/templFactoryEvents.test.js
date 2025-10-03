import test from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';

import { FACTORY_EVENT_VARIANTS } from '../src/constants/templFactoryEvents.js';

test('compat templ created topic matches legacy signature', () => {
  const compatVariant = FACTORY_EVENT_VARIANTS.find((variant) => variant.id === 'compat');
  assert.ok(compatVariant, 'expected compat variant');
  const expected = ethers.id(
    'TemplCreated(address,address,address,address,uint256,uint256,uint256,uint256,uint256,uint256,address,bool,uint256,string)'
  );
  assert.equal(compatVariant.topic, expected);
});
