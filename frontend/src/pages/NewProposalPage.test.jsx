import { describe, expect, it } from 'vitest';
import { ethers } from 'ethers';
import { buildActionConfig } from './NewProposalPage.jsx';

describe('buildActionConfig', () => {
  it('builds withdraw treasury action with native token', () => {
    const recipient = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';
    const result = buildActionConfig('withdrawTreasury', {
      token: 'ETH',
      recipient,
      amount: '1000000000000000000',
      reason: 'Test withdrawal'
    }, { ethers });

    expect(result.action).toBe('withdrawTreasury');
    expect(result.params.token).toBe(ethers.ZeroAddress);
    expect(result.params.recipient).toBe(ethers.getAddress(recipient));
    expect(result.params.amount).toBe(1000000000000000000n);
    expect(result.params.reason).toBe('Test withdrawal');
  });

  it('builds disband treasury action with custom token', () => {
    const customToken = '0x90F79bf6EB2c4f870365E785982E1f101E93b906';
    const result = buildActionConfig('disbandTreasury', {
      tokenMode: 'custom',
      customToken
    }, { ethers });

    expect(result.action).toBe('disbandTreasury');
    expect(result.params.token).toBe(ethers.getAddress(customToken));
  });

  it('builds update config action with entry fee and fee split', () => {
    const result = buildActionConfig('updateConfig', {
      entryFee: '250000000000000000',
      updateFeeSplit: true,
      burnPercent: '40',
      treasuryPercent: '30',
      memberPercent: '30'
    }, { ethers });

    expect(result.action).toBe('updateConfig');
    expect(result.params.newEntryFee).toBe(250000000000000000n);
    expect(result.params.updateFeeSplit).toBe(true);
    expect(result.params.newBurnPercent).toBe(40);
    expect(result.params.newTreasuryPercent).toBe(30);
    expect(result.params.newMemberPoolPercent).toBe(30);
  });
});
