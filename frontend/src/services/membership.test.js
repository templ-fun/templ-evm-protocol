import { describe, expect, it, vi } from 'vitest';
import { purchaseAccess } from './membership.js';

describe('membership service', () => {
  it('allows purchase when allowance covers entry fee', async () => {
    const purchaseWait = vi.fn().mockResolvedValue({});
    const templContract = {
      hasAccess: vi.fn().mockResolvedValue(false),
      purchaseAccess: vi.fn().mockResolvedValue({ wait: purchaseWait }),
      entryFee: vi.fn().mockResolvedValue(100n),
      accessToken: vi.fn().mockResolvedValue('token-address')
    };
    const tokenContract = {
      allowance: vi.fn().mockResolvedValue(150n)
    };

    const fakeEthers = {
      Contract: vi.fn((address) => {
        if (address === 'templ-address') return templContract;
        if (address === 'token-address') return tokenContract;
        throw new Error(`Unexpected contract address ${address}`);
      }),
      getAddress: vi.fn((value) => value)
    };

    const signer = {
      getAddress: vi.fn().mockResolvedValue('0xmember'),
      provider: { getCode: vi.fn().mockResolvedValue('0x1234') }
    };

    const result = await purchaseAccess({
      ethers: fakeEthers,
      signer,
      templAddress: 'templ-address',
      templArtifact: { abi: [] },
      walletAddress: '0xmember'
    });

    expect(result).toEqual({ purchased: true });
    expect(templContract.purchaseAccess).toHaveBeenCalledTimes(1);
    expect(purchaseWait).toHaveBeenCalledTimes(1);
  });

  it('throws when allowance is below the entry fee', async () => {
    const templContract = {
      hasAccess: vi.fn().mockResolvedValue(false),
      purchaseAccess: vi.fn(),
      entryFee: vi.fn().mockResolvedValue(200n),
      accessToken: vi.fn().mockResolvedValue('token-address')
    };
    const tokenContract = {
      allowance: vi.fn().mockResolvedValue(50n)
    };

    const fakeEthers = {
      Contract: vi.fn((address) => {
        if (address === 'templ-address') return templContract;
        if (address === 'token-address') return tokenContract;
        throw new Error(`Unexpected contract address ${address}`);
      }),
      getAddress: vi.fn((value) => value)
    };

    const signer = {
      getAddress: vi.fn().mockResolvedValue('0xmember'),
      provider: { getCode: vi.fn().mockResolvedValue('0x1234') }
    };

    await expect(purchaseAccess({
      ethers: fakeEthers,
      signer,
      templAddress: 'templ-address',
      templArtifact: { abi: [] },
      walletAddress: '0xmember'
    })).rejects.toThrow('Allowance is lower than the entry fee');
    expect(templContract.purchaseAccess).not.toHaveBeenCalled();
  });
});
