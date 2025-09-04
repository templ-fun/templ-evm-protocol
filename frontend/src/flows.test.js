import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
vi.mock('./xmtpHelpers.js', () => ({
  waitForConversation: vi.fn(),
  syncXMTP: vi.fn()
}));
import { waitForConversation } from './xmtpHelpers.js';
import {
  deployTempl,
  purchaseAndJoin,
  sendMessage,
  proposeVote,
  voteOnProposal,
  executeProposal,
  watchProposals,
  delegateMute,
  muteMember,
  fetchActiveMutes
} from './flows.js';
import { BACKEND_URL } from './config.js';
import { buildDelegateMessage, buildMuteMessage } from '../../shared/signing.js';
import {
  mockFetchSuccess,
  mockFetchFailure,
  mockFetchError
} from '../test-utils/mockFetch.js';
import { createSignerMock, createXMTPMock } from '../test-utils/mocks.js';

const templArtifact = { abi: [], bytecode: '0x' };
const originalFetch = globalThis.fetch;

beforeEach(() => {
  waitForConversation.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  globalThis.fetch = originalFetch;
});

describe('templ flows', () => {
  it('deployTempl rejects when required params missing', async () => {
    await expect(deployTempl({})).rejects.toThrow(
      'Missing required deployTempl parameters'
    );
  });

  it('deployTempl deploys contract and registers group', async () => {
    const fakeContract = {
      waitForDeployment: vi.fn(),
      getAddress: vi.fn().mockResolvedValue('0xDeAd')
    };
    const factory = { deploy: vi.fn().mockResolvedValue(fakeContract) };
    const ethers = {
      ContractFactory: vi.fn().mockImplementation(() => factory)
    };
    mockFetchSuccess({ groupId: 'group-1' });
    const xmtp = createXMTPMock();
    const signer = createSignerMock();
    waitForConversation.mockResolvedValueOnce({ id: 'group-1', consentState: 'allowed' });

    const result = await deployTempl({
      ethers,
      xmtp,
      signer,
      walletAddress: '0xabc',
      tokenAddress: '0xdef',
      protocolFeeRecipient: '0xfee',
      entryFee: '1',
      templArtifact
    });

    expect(ethers.ContractFactory).toHaveBeenCalled();
    expect(factory.deploy).toHaveBeenCalledWith(
      '0xabc',
      '0xfee',
      '0xdef',
      BigInt(1),
      BigInt(10),
      BigInt(10),
      {}
    );
    expect(signer.signMessage).toHaveBeenCalledWith('create:0xdead');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${BACKEND_URL}/templs`,
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contractAddress: '0xDeAd',
          priestAddress: '0xabc',
          priestInboxId: 'inbox-1',
          signature: 'sig'
        })
      })
    );
    expect(result).toEqual({ contractAddress: '0xDeAd', group: { id: 'group-1', consentState: 'allowed' }, groupId: 'group-1' });
  });

  it('deployTempl throws on non-200 backend response', async () => {
    const fakeContract = {
      waitForDeployment: vi.fn(),
      getAddress: vi.fn().mockResolvedValue('0xDeAd')
    };
    const factory = { deploy: vi.fn().mockResolvedValue(fakeContract) };
    const ethers = {
      ContractFactory: vi.fn().mockImplementation(() => factory)
    };
    mockFetchFailure({
      status: 500,
      statusText: 'Server Error',
      response: 'fail'
    });
    const signer = createSignerMock();
    await expect(
      deployTempl({
        ethers,
        xmtp: undefined,
        signer,
        walletAddress: '0xabc',
        tokenAddress: '0xdef',
        protocolFeeRecipient: '0xfee',
        entryFee: '1',
        templArtifact
      })
    ).rejects.toThrow(/Templ registration failed/);
  });

  it('deployTempl throws on invalid JSON response', async () => {
    const fakeContract = {
      waitForDeployment: vi.fn(),
      getAddress: vi.fn().mockResolvedValue('0xDeAd')
    };
    const factory = { deploy: vi.fn().mockResolvedValue(fakeContract) };
    const ethers = {
      ContractFactory: vi.fn().mockImplementation(() => factory)
    };
    mockFetchSuccess({});
    const signer = createSignerMock();
    await expect(
      deployTempl({
        ethers,
        xmtp: undefined,
        signer,
        walletAddress: '0xabc',
        tokenAddress: '0xdef',
        protocolFeeRecipient: '0xfee',
        entryFee: '1',
        templArtifact
      })
    ).rejects.toThrow(/Invalid \/templs response/);
  });

  it('purchaseAndJoin purchases access and joins group', async () => {
    const templContract = {
      hasAccess: vi.fn().mockResolvedValue(false),
      purchaseAccess: vi.fn().mockResolvedValue({ wait: vi.fn() }),
      getConfig: vi.fn().mockResolvedValue(['0xToken', 100n, false, 0n, 0n, 0n])
    };
    const erc20 = {
      allowance: vi.fn().mockResolvedValue(0n),
      approve: vi.fn().mockResolvedValue({ wait: vi.fn() })
    };
    const Contract = vi.fn().mockImplementation((address, abi) => {
      if (Array.isArray(abi) && abi.some(s => String(s).includes('allowance'))) return erc20;
      return templContract;
    });
    const ethers = { Contract };
    mockFetchSuccess({ groupId: 'group-2' });
    const xmtp = createXMTPMock({ inboxId: 'inbox-2' });
    const signer = createSignerMock();
    waitForConversation.mockResolvedValueOnce({ id: 'group-2', consentState: 'allowed' });

    const result = await purchaseAndJoin({
      ethers,
      xmtp,
      signer,
      walletAddress: '0xabc',
      templAddress: '0xTeMpL',
      templArtifact
    });

    expect(templContract.purchaseAccess).toHaveBeenCalled();
    expect(signer.signMessage).toHaveBeenCalledWith('join:0xtempl');
    expect(result).toEqual({ group: { id: 'group-2', consentState: 'allowed' }, groupId: 'group-2' });
  });

  it('purchaseAndJoin rejects on backend failure', async () => {
    const templContract = { hasAccess: vi.fn().mockResolvedValue(true) };
    const ethers = { Contract: vi.fn().mockReturnValue(templContract) };
    const signer = createSignerMock();
    mockFetchFailure({
      status: 500,
      statusText: 'Server Error',
      response: 'fail'
    });
    await expect(
      purchaseAndJoin({
        ethers,
        xmtp: undefined,
        signer,
        walletAddress: '0xabc',
        templAddress: '0xTempl',
        templArtifact
      })
    ).rejects.toThrow(/Join failed: 500/);
  });

  it('purchaseAndJoin errors when access not purchased', async () => {
    const templContract = { hasAccess: vi.fn().mockResolvedValue(true) };
    const ethers = { Contract: vi.fn().mockReturnValue(templContract) };
    const signer = createSignerMock();
    mockFetchFailure({
      status: 403,
      statusText: 'Forbidden',
      response: 'Access not purchased'
    });
    await expect(
      purchaseAndJoin({
        ethers,
        xmtp: undefined,
        signer,
        walletAddress: '0xabc',
        templAddress: '0xTempl',
        templArtifact
      })
    ).rejects.toThrow(/Access not purchased/);
  });

  it('sendMessage forwards content to group', async () => {
    const group = { send: vi.fn() };
    await sendMessage({ group, content: 'hello' });
    expect(group.send).toHaveBeenCalledWith('hello');
  });

  it('proposeVote calls createProposal', async () => {
    const contract = {
      createProposal: vi.fn().mockResolvedValue({ wait: vi.fn() })
    };
    const ethers = { Contract: vi.fn().mockReturnValue(contract) };
    await proposeVote({
      ethers,
      signer: {},
      templAddress: '0xtempl',
      templArtifact,
      title: 't',
      description: 'd',
      callData: '0x00'
    });
    expect(contract.createProposal).toHaveBeenCalled();
  });

  it('voteOnProposal calls vote', async () => {
    const contract = { vote: vi.fn().mockResolvedValue({ wait: vi.fn() }) };
    const ethers = { Contract: vi.fn().mockReturnValue(contract) };
    await voteOnProposal({
      ethers,
      signer: {},
      templAddress: '0xtempl',
      templArtifact,
      proposalId: 1,
      support: true
    });
    expect(contract.vote).toHaveBeenCalledWith(1, true, {});
  });

  it('executeProposal calls executeProposal', async () => {
    const contract = { executeProposal: vi.fn().mockResolvedValue({ wait: vi.fn() }) };
    const ethers = { Contract: vi.fn().mockReturnValue(contract) };
    await executeProposal({
      ethers,
      signer: {},
      templAddress: '0xtempl',
      templArtifact,
      proposalId: 2
    });
    expect(contract.executeProposal).toHaveBeenCalledWith(2, {});
  });

  it('watchProposals registers event listeners', () => {
    const on = vi.fn();
    const contract = { on };
    const ethers = { Contract: vi.fn().mockReturnValue(contract) };
    const cleanup = watchProposals({
      ethers,
      provider: {},
      templAddress: '0xtempl',
      templArtifact,
      onProposal: vi.fn(),
      onVote: vi.fn()
    });
    expect(on).toHaveBeenCalledTimes(2);
    expect(typeof cleanup).toBe('function');
  });

  it('watchProposals stops firing events after cleanup', () => {
    const listeners = {};
    const contract = {
      on: vi.fn((event, cb) => {
        (listeners[event] || (listeners[event] = [])).push(cb);
      }),
      off: vi.fn((event, cb) => {
        listeners[event] = (listeners[event] || []).filter((fn) => fn !== cb);
      }),
      emit: (event, ...args) => {
        (listeners[event] || []).forEach((fn) => fn(...args));
      }
    };
    const ethers = { Contract: vi.fn().mockReturnValue(contract) };
    const onProposal = vi.fn();
    const onVote = vi.fn();
    const cleanup = watchProposals({
      ethers,
      provider: {},
      templAddress: '0xtempl',
      templArtifact,
      onProposal,
      onVote
    });
    contract.emit('ProposalCreated', 1, '0x', 'title', 123);
    contract.emit('VoteCast', 1, '0x', true, 123);
    expect(onProposal).toHaveBeenCalledTimes(1);
    expect(onVote).toHaveBeenCalledTimes(1);
    cleanup();
    contract.emit('ProposalCreated', 2, '0x', 'title2', 456);
    contract.emit('VoteCast', 1, '0x', false, 456);
    expect(onProposal).toHaveBeenCalledTimes(1);
    expect(onVote).toHaveBeenCalledTimes(1);
  });

  it('delegateMute posts delegation to backend', async () => {
    const signer = createSignerMock();
    mockFetchSuccess({ delegated: true });
    const result = await delegateMute({
      signer,
      contractAddress: '0xTempl',
      priestAddress: '0xPriest',
      delegateAddress: '0xDel'
    });
    expect(signer.signMessage).toHaveBeenCalledWith(
      buildDelegateMessage('0xTempl', '0xDel')
    );
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${BACKEND_URL}/delegates`,
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contractAddress: '0xTempl',
          priestAddress: '0xPriest',
          delegateAddress: '0xDel',
          signature: 'sig'
        })
      })
    );
    expect(result).toBe(true);
  });

  it('delegateMute returns false on non-200', async () => {
    const signer = createSignerMock();
    mockFetchFailure();
    const result = await delegateMute({
      signer,
      contractAddress: '0xTempl',
      priestAddress: '0xPriest',
      delegateAddress: '0xDel'
    });
    expect(result).toBe(false);
  });

  it('delegateMute rejects on fetch error', async () => {
    const signer = createSignerMock();
    mockFetchError(new Error('fail'));
    await expect(
      delegateMute({
        signer,
        contractAddress: '0xTempl',
        priestAddress: '0xPriest',
        delegateAddress: '0xDel'
      })
    ).rejects.toThrow('fail');
  });

  it('delegateMute throws on invalid JSON response', async () => {
    const signer = createSignerMock();
    mockFetchSuccess({});
    await expect(
      delegateMute({
        signer,
        contractAddress: '0xTempl',
        priestAddress: '0xPriest',
        delegateAddress: '0xDel'
      })
    ).rejects.toThrow('Invalid /delegates response');
  });

  it('muteMember posts mute to backend', async () => {
    const signer = createSignerMock();
    mockFetchSuccess({ mutedUntil: 123 });
    const result = await muteMember({
      signer,
      contractAddress: '0xTempl',
      moderatorAddress: '0xMod',
      targetAddress: '0xTar'
    });
    expect(signer.signMessage).toHaveBeenCalledWith(
      buildMuteMessage('0xTempl', '0xTar')
    );
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${BACKEND_URL}/mute`,
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contractAddress: '0xTempl',
          moderatorAddress: '0xMod',
          targetAddress: '0xTar',
          signature: 'sig'
        })
      })
    );
    expect(result).toBe(123);
  });

  it('muteMember returns 0 on non-200', async () => {
    const signer = createSignerMock();
    mockFetchFailure();
    const result = await muteMember({
      signer,
      contractAddress: '0xTempl',
      moderatorAddress: '0xMod',
      targetAddress: '0xTar'
    });
    expect(result).toBe(0);
  });

  it('muteMember rejects on fetch error', async () => {
    const signer = createSignerMock();
    mockFetchError(new Error('fail'));
    await expect(
      muteMember({
        signer,
        contractAddress: '0xTempl',
        moderatorAddress: '0xMod',
        targetAddress: '0xTar'
      })
    ).rejects.toThrow('fail');
  });

  it('muteMember throws on invalid JSON response', async () => {
    const signer = createSignerMock();
    mockFetchSuccess({});
    await expect(
      muteMember({
        signer,
        contractAddress: '0xTempl',
        moderatorAddress: '0xMod',
        targetAddress: '0xTar'
      })
    ).rejects.toThrow('Invalid /mute response');
  });

  it('fetchActiveMutes queries backend for mutes', async () => {
    mockFetchSuccess({ mutes: [{ address: '0xabc', count: 1, until: 0 }] });
    const result = await fetchActiveMutes({ contractAddress: '0xTempl' });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${BACKEND_URL}/mutes?contractAddress=0xTempl`
    );
    expect(result).toEqual([{ address: '0xabc', count: 1, until: 0 }]);
  });

  it('fetchActiveMutes returns empty array on non-200', async () => {
    mockFetchFailure();
    const result = await fetchActiveMutes({ contractAddress: '0xTempl' });
    expect(result).toEqual([]);
  });

  it('fetchActiveMutes throws on invalid JSON response', async () => {
    mockFetchSuccess({});
    await expect(
      fetchActiveMutes({ contractAddress: '0xTempl' })
    ).rejects.toThrow('Invalid /mutes response');
  });
});
