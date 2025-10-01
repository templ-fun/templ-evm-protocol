import { describe, expect, it, vi } from 'vitest';
import { joinTempl } from './membership.js';

describe('membership service', () => {
  const buildEthers = (templContract, tokenContract) => ({
    Contract: vi.fn((address) => {
      if (address === 'templ-address') return templContract;
      if (address === 'token-address') return tokenContract;
      throw new Error(`Unexpected contract address ${address}`);
    }),
    getAddress: vi.fn((value) => value)
  });

  const buildSigner = () => ({
    getAddress: vi.fn().mockResolvedValue('0xmember'),
    provider: { getCode: vi.fn().mockResolvedValue('0x1234') }
  });

  it('joins when allowance covers entry fee', async () => {
    const wait = vi.fn().mockResolvedValue({});
    const templContract = {
      isMember: vi.fn().mockResolvedValue(false),
      join: vi.fn().mockResolvedValue({ wait }),
      joinFor: vi.fn(),
      entryFee: vi.fn().mockResolvedValue(100n),
      accessToken: vi.fn().mockResolvedValue('token-address')
    };
    const tokenContract = {
      allowance: vi.fn().mockResolvedValue(150n)
    };
    const ethers = buildEthers(templContract, tokenContract);
    const signer = buildSigner();

    const result = await joinTempl({
      ethers,
      signer,
      templAddress: 'templ-address',
      templArtifact: { abi: [] },
      walletAddress: '0xmember'
    });

    expect(result).toEqual({ joined: true, recipient: '0xmember' });
    expect(templContract.join).toHaveBeenCalledTimes(1);
    expect(templContract.joinFor).not.toHaveBeenCalled();
    expect(wait).toHaveBeenCalledTimes(1);
  });

  it('calls joinFor when gifting membership to another wallet', async () => {
    const wait = vi.fn().mockResolvedValue({});
    const templContract = {
      isMember: vi.fn().mockResolvedValue(false),
      join: vi.fn(),
      joinFor: vi.fn().mockResolvedValue({ wait }),
      entryFee: vi.fn().mockResolvedValue(100n),
      accessToken: vi.fn().mockResolvedValue('token-address')
    };
    const tokenContract = {
      allowance: vi.fn().mockResolvedValue(200n)
    };
    const ethers = buildEthers(templContract, tokenContract);
    const signer = buildSigner();

    const result = await joinTempl({
      ethers,
      signer,
      templAddress: 'templ-address',
      templArtifact: { abi: [] },
      walletAddress: '0xmember',
      recipientAddress: '0xfriend'
    });

    expect(result).toEqual({ joined: true, recipient: '0xfriend' });
    expect(templContract.joinFor).toHaveBeenCalledWith('0xfriend', {});
    expect(templContract.join).not.toHaveBeenCalled();
    expect(wait).toHaveBeenCalledTimes(1);
  });

  it('returns a no-op result when the recipient is already a member', async () => {
    const templContract = {
      isMember: vi.fn().mockResolvedValue(true),
      join: vi.fn(),
      joinFor: vi.fn(),
      entryFee: vi.fn().mockResolvedValue(100n),
      accessToken: vi.fn().mockResolvedValue('token-address')
    };
    const tokenContract = {
      allowance: vi.fn().mockResolvedValue(150n)
    };
    const ethers = buildEthers(templContract, tokenContract);
    const signer = buildSigner();

    const result = await joinTempl({
      ethers,
      signer,
      templAddress: 'templ-address',
      templArtifact: { abi: [] },
      walletAddress: '0xmember',
      recipientAddress: '0xmember'
    });

    expect(result).toEqual({ joined: false, recipient: '0xmember' });
    expect(templContract.join).not.toHaveBeenCalled();
    expect(templContract.joinFor).not.toHaveBeenCalled();
  });

  it('throws when allowance is below the entry fee', async () => {
    const templContract = {
      isMember: vi.fn().mockResolvedValue(false),
      join: vi.fn(),
      joinFor: vi.fn(),
      entryFee: vi.fn().mockResolvedValue(200n),
      accessToken: vi.fn().mockResolvedValue('token-address')
    };
    const tokenContract = {
      allowance: vi.fn().mockResolvedValue(50n)
    };
    const ethers = buildEthers(templContract, tokenContract);
    const signer = buildSigner();

    await expect(joinTempl({
      ethers,
      signer,
      templAddress: 'templ-address',
      templArtifact: { abi: [] },
      walletAddress: '0xmember'
    })).rejects.toThrow('Allowance is lower than the entry fee. Approve the entry fee amount before joining.');
    expect(templContract.join).not.toHaveBeenCalled();
    expect(templContract.joinFor).not.toHaveBeenCalled();
  });

  it('surfaces a friendly error when the membership cap is reached', async () => {
    const memberLimitError = new Error('Member limit reached');
    memberLimitError.code = 'CALL_EXCEPTION';
    memberLimitError.errorName = 'MemberLimitReached';

    const templContract = {
      isMember: vi.fn().mockResolvedValue(false),
      join: vi.fn().mockImplementation(() => {
        throw memberLimitError;
      }),
      joinFor: vi.fn(),
      entryFee: vi.fn().mockResolvedValue(100n),
      accessToken: vi.fn().mockResolvedValue('token-address')
    };
    const tokenContract = {
      allowance: vi.fn().mockResolvedValue(200n)
    };
    const ethers = buildEthers(templContract, tokenContract);
    const signer = buildSigner();

    await expect(joinTempl({
      ethers,
      signer,
      templAddress: 'templ-address',
      templArtifact: { abi: [] },
      walletAddress: '0xmember'
    })).rejects.toThrow('Membership is currently capped. Governance must raise or clear the limit before new joins succeed.');
  });
});
