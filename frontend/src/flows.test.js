import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
vi.mock('../../shared/xmtp.js', () => ({
  waitForConversation: vi.fn(),
  syncXMTP: vi.fn()
}));
import { waitForConversation } from '../../shared/xmtp.js';
import {
  deployTempl,
  purchaseAccess,
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
import {
  mockFetchSuccess,
  mockFetchFailure,
  mockFetchError
} from '../test-utils/mockFetch.js';
import { createSignerMock, createXMTPMock } from '../test-utils/mocks.js';

const templArtifact = { abi: [], bytecode: '0x' };
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const originalFetch = globalThis.fetch;
let xmtp;
let signer;

beforeEach(() => {
  waitForConversation.mockReset();
  xmtp = createXMTPMock();
  signer = createSignerMock();
  mockFetchSuccess({});
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
    const wait = vi.fn().mockResolvedValue({});
    const createTempl = vi.fn().mockResolvedValue({ wait });
    createTempl.staticCall = vi.fn().mockResolvedValue('0xDeAd');
    const factoryContract = {
      protocolFeeRecipient: vi.fn().mockResolvedValue('0xfee'),
      protocolPercent: vi.fn().mockResolvedValue(10n),
      createTempl
    };
    const ethers = {
      Contract: vi.fn().mockImplementation((address) => {
        if (address === '0xFactory') return factoryContract;
        throw new Error(`unexpected contract ${address}`);
      })
    };
    mockFetchSuccess({ groupId: 'group-1' });
    waitForConversation.mockResolvedValueOnce({ id: 'group-1', consentState: 'allowed' });

    const result = await deployTempl({
      ethers,
      xmtp,
      signer,
      walletAddress: '0xabc',
      tokenAddress: '0xdef',
      entryFee: '1',
      burnPercent: '30',
      treasuryPercent: '30',
      memberPoolPercent: '30',
      factoryAddress: '0xFactory',
      factoryArtifact: { abi: [] },
      templArtifact
    });

    expect(createTempl.staticCall).toHaveBeenCalledWith('0xdef', BigInt(1));
    expect(createTempl).toHaveBeenCalledWith('0xdef', BigInt(1), {});
    expect(signer.signTypedData).toHaveBeenCalled();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${BACKEND_URL}/templs`,
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Include typed-signature timing fields
        body: expect.stringContaining('"contractAddress":"0xDeAd"')
      })
    );
    // Also assert presence of critical fields without exact values
    const fetchArgs = /** @type {[string, any]} */ (globalThis.fetch.mock.calls[0]);
    expect(fetchArgs[1].body).toContain('"priestAddress":"0xabc"');
    expect(fetchArgs[1].body).toContain('"signature":"sig"');
    expect(fetchArgs[1].body).toContain('"chainId":1337');
    expect(fetchArgs[1].body).toContain('"nonce":');
    expect(fetchArgs[1].body).toContain('"issuedAt":');
    expect(fetchArgs[1].body).toContain('"expiry":');
    expect(result).toEqual({ contractAddress: '0xDeAd', group: { id: 'group-1', consentState: 'allowed' }, groupId: 'group-1' });
  });

  it('deployTempl throws on non-200 backend response', async () => {
    const wait = vi.fn();
    const createTempl = vi.fn().mockResolvedValue({ wait });
    createTempl.staticCall = vi.fn().mockResolvedValue('0xDeAd');
    const factoryContract = {
      protocolFeeRecipient: vi.fn().mockResolvedValue('0xfee'),
      protocolPercent: vi.fn().mockResolvedValue(10n),
      createTempl
    };
    const ethers = {
      Contract: vi.fn().mockImplementation(() => factoryContract)
    };
    mockFetchFailure({
      status: 500,
      statusText: 'Server Error',
      response: 'fail'
    });
    await expect(
      deployTempl({
        ethers,
        xmtp: undefined,
        signer,
        walletAddress: '0xabc',
        tokenAddress: '0xdef',
        entryFee: '1',
        burnPercent: '30',
        treasuryPercent: '30',
        memberPoolPercent: '30',
        factoryAddress: '0xFactory',
        factoryArtifact: { abi: [] },
        templArtifact
      })
    ).rejects.toThrow(/Templ registration failed/);
  });

  it('deployTempl throws on invalid JSON response', async () => {
    const wait = vi.fn();
    const createTempl = vi.fn().mockResolvedValue({ wait });
    createTempl.staticCall = vi.fn().mockResolvedValue('0xDeAd');
    const factoryContract = {
      protocolFeeRecipient: vi.fn().mockResolvedValue('0xfee'),
      protocolPercent: vi.fn().mockResolvedValue(10n),
      createTempl
    };
    const ethers = {
      Contract: vi.fn().mockImplementation(() => factoryContract)
    };
    mockFetchSuccess({});
    await expect(
      deployTempl({
        ethers,
        xmtp: undefined,
        signer,
        walletAddress: '0xabc',
        tokenAddress: '0xdef',
        entryFee: '1',
        burnPercent: '30',
        treasuryPercent: '30',
        memberPoolPercent: '30',
        factoryAddress: '0xFactory',
        factoryArtifact: { abi: [] },
        templArtifact
      })
    ).rejects.toThrow(/Invalid \/templs response/);
  });

  it('deployTempl forwards -1 sentinel for default fee splits', async () => {
    const wait = vi.fn().mockResolvedValue({});
    const createTemplWithConfig = vi.fn().mockResolvedValue({ wait });
    createTemplWithConfig.staticCall = vi.fn().mockResolvedValue('0xDeAd');
    const factoryContract = {
      protocolFeeRecipient: vi.fn().mockResolvedValue('0xfee'),
      protocolPercent: vi.fn().mockResolvedValue(10n),
      createTemplWithConfig
    };
    const ethers = {
      Contract: vi.fn().mockImplementation((address) => {
        if (address === '0xFactory') return factoryContract;
        throw new Error(`unexpected contract ${address}`);
      })
    };
    mockFetchSuccess({ groupId: 'group-1' });
    waitForConversation.mockResolvedValueOnce({ id: 'group-1', consentState: 'allowed' });

    await deployTempl({
      ethers,
      xmtp,
      signer,
      walletAddress: '0xabc',
      tokenAddress: '0xdef',
      entryFee: '100',
      burnPercent: '-1',
      treasuryPercent: '50',
      memberPoolPercent: '10',
      factoryAddress: '0xFactory',
      factoryArtifact: { abi: [] },
      templArtifact
    });

    expect(createTemplWithConfig.staticCall).toHaveBeenCalledWith({
      priest: '0xabc',
      token: '0xdef',
      entryFee: BigInt(100),
      burnPercent: -1,
      treasuryPercent: 50,
      memberPoolPercent: 10,
      burnAddress: ZERO_ADDRESS,
      priestIsDictator: false
    });
    expect(createTemplWithConfig).toHaveBeenCalledWith({
      priest: '0xabc',
      token: '0xdef',
      entryFee: BigInt(100),
      burnPercent: -1,
      treasuryPercent: 50,
      memberPoolPercent: 10,
      burnAddress: ZERO_ADDRESS,
      priestIsDictator: false
    }, {});
  });

  it('purchaseAccess approves token and purchases membership when needed', async () => {
    const purchaseTx = { wait: vi.fn() };
    const approvalTx = { wait: vi.fn() };
    const templContract = {
      hasAccess: vi.fn().mockResolvedValue(false),
      getConfig: vi.fn().mockResolvedValue(['0xToken', 100n, false, 0n, 0n, 0n, 30, 30, 30, 10]),
      purchaseAccess: vi.fn().mockResolvedValue(purchaseTx)
    };
    const erc20 = {
      allowance: vi.fn().mockResolvedValue(0n),
      approve: vi.fn().mockResolvedValue(approvalTx)
    };
    const Contract = vi.fn().mockImplementation((address, abi) => {
      if (Array.isArray(abi) && abi.some((s) => String(s).includes('allowance'))) return erc20;
      return templContract;
    });
    const ethers = { Contract, ZeroAddress: '0x0000000000000000000000000000000000000000' };

    const result = await purchaseAccess({
      ethers,
      signer,
      walletAddress: '0xabc',
      templAddress: '0xTempl',
      templArtifact,
      txOptions: { gasLimit: 123n }
    });

    expect(templContract.getConfig).toHaveBeenCalled();
    expect(erc20.allowance).toHaveBeenCalledWith('0xabc', '0xTempl');
    expect(erc20.approve).toHaveBeenCalledWith('0xTempl', 100n, { gasLimit: 123n });
    expect(approvalTx.wait).toHaveBeenCalled();
    expect(templContract.purchaseAccess).toHaveBeenCalledWith({ gasLimit: 123n });
    expect(purchaseTx.wait).toHaveBeenCalled();
    expect(result).toBe(true);
  });

  it('purchaseAccess short-circuits when membership already granted', async () => {
    const templContract = {
      hasAccess: vi.fn().mockResolvedValue(true),
      purchaseAccess: vi.fn(),
      getConfig: vi.fn()
    };
    const ethers = { Contract: vi.fn().mockReturnValue(templContract) };

    const result = await purchaseAccess({
      ethers,
      signer,
      walletAddress: '0xabc',
      templAddress: '0xTempl',
      templArtifact
    });

    expect(result).toBe(false);
    expect(templContract.getConfig).not.toHaveBeenCalled();
    expect(templContract.purchaseAccess).not.toHaveBeenCalled();
  });

  it('purchaseAndJoin purchases access and joins group', async () => {
    const templContract = {
      hasAccess: vi.fn().mockResolvedValue(false),
      purchaseAccess: vi.fn().mockResolvedValue({ wait: vi.fn() }),
      getConfig: vi.fn().mockResolvedValue(['0xToken', 100n, false, 0n, 0n, 0n, 30, 30, 30, 10])
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
    expect(signer.signTypedData).toHaveBeenCalled();
    expect(result).toEqual({ group: { id: 'group-2', consentState: 'allowed' }, groupId: 'group-2' });
  });

  it('purchaseAndJoin rejects on backend failure', async () => {
    const templContract = { hasAccess: vi.fn().mockResolvedValue(true) };
    const ethers = { Contract: vi.fn().mockReturnValue(templContract) };
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

  it('proposeVote uses typed helper for setPaused', async () => {
    const contract = {
      createProposalSetPaused: vi.fn().mockResolvedValue({ wait: vi.fn().mockResolvedValue({ logs: [] }) })
    };
    const ethers = { Contract: vi.fn().mockReturnValue(contract) };
    const result = await proposeVote({
      ethers,
      signer: {},
      templAddress: '0xtempl',
      templArtifact,
      action: 'setPaused',
      params: { paused: true },
      votingPeriod: 0
    });
    expect(contract.createProposalSetPaused).toHaveBeenCalled();
    expect(result).toEqual({ receipt: expect.any(Object), proposalId: null });
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

  it('executeProposal rejects with contract error', async () => {
    const contract = {
      executeProposal: vi.fn().mockRejectedValue({ reason: 'nope' })
    };
    const ethers = { Contract: vi.fn().mockReturnValue(contract) };
    await expect(
      executeProposal({
        ethers,
        signer: {},
        templAddress: '0xtempl',
        templArtifact,
        proposalId: 3
      })
    ).rejects.toThrow('nope');
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
    contract.emit('ProposalCreated', 1, '0x', 123);
    contract.emit('VoteCast', 1, '0x', true, 123);
    expect(onProposal).toHaveBeenCalledTimes(1);
    expect(onVote).toHaveBeenCalledTimes(1);
    cleanup();
    contract.emit('ProposalCreated', 2, '0x', 456);
    contract.emit('VoteCast', 1, '0x', false, 456);
    expect(onProposal).toHaveBeenCalledTimes(1);
    expect(onVote).toHaveBeenCalledTimes(1);
  });

  it('delegateMute posts delegation to backend', async () => {
    mockFetchSuccess({ delegated: true });
    const result = await delegateMute({
      signer,
      contractAddress: '0xTempl',
      priestAddress: '0xPriest',
      delegateAddress: '0xDel'
    });
    expect(signer.signTypedData).toHaveBeenCalled();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${BACKEND_URL}/delegateMute`,
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: expect.any(String)
      })
    );
    {
      const args = /** @type {[string, any]} */ (globalThis.fetch.mock.calls[0]);
      expect(args[1].body).toContain('"contractAddress":"0xTempl"');
      expect(args[1].body).toContain('"priestAddress":"0xPriest"');
      expect(args[1].body).toContain('"delegateAddress":"0xDel"');
      expect(args[1].body).toContain('"signature":"sig"');
      expect(args[1].body).toContain('"chainId":1337');
      expect(args[1].body).toContain('"nonce":');
      expect(args[1].body).toContain('"issuedAt":');
      expect(args[1].body).toContain('"expiry":');
    }
    expect(result).toBe(true);
  });

  it('delegateMute returns false on non-200', async () => {
    mockFetchFailure();
    const result = await delegateMute({
      signer,
      contractAddress: '0xTempl',
      priestAddress: '0xPriest',
      delegateAddress: '0xDel'
    });
    expect(result).toBe(false);
  });

  it('muteMember posts mute to backend', async () => {
    mockFetchSuccess({ mutedUntil: 123 });
    const result = await muteMember({
      signer,
      contractAddress: '0xTempl',
      moderatorAddress: '0xMod',
      targetAddress: '0xTar'
    });
    expect(signer.signTypedData).toHaveBeenCalled();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${BACKEND_URL}/mute`,
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: expect.any(String)
      })
    );
    {
      const args = /** @type {[string, any]} */ (globalThis.fetch.mock.calls[0]);
      expect(args[1].body).toContain('"contractAddress":"0xTempl"');
      expect(args[1].body).toContain('"moderatorAddress":"0xMod"');
      expect(args[1].body).toContain('"targetAddress":"0xTar"');
      expect(args[1].body).toContain('"signature":"sig"');
      expect(args[1].body).toContain('"chainId":1337');
      expect(args[1].body).toContain('"nonce":');
      expect(args[1].body).toContain('"issuedAt":');
      expect(args[1].body).toContain('"expiry":');
    }
    expect(result).toBe(123);
  });

  it('muteMember returns 0 on non-200', async () => {
    mockFetchFailure();
    const result = await muteMember({
      signer,
      contractAddress: '0xTempl',
      moderatorAddress: '0xMod',
      targetAddress: '0xTar'
    });
    expect(result).toBe(0);
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

  const errorTable = [
    {
      fn: delegateMute,
      args: () => ({
        signer,
        contractAddress: '0xTempl',
        priestAddress: '0xPriest',
        delegateAddress: '0xDel'
      }),
      expectedError: 'fail'
    },
    {
      fn: delegateMute,
      args: () => ({
        signer,
        contractAddress: '0xTempl',
        priestAddress: '0xPriest',
        delegateAddress: '0xDel'
      }),
      expectedError: 'Invalid /delegateMute response'
    },
    {
      fn: muteMember,
      args: () => ({
        signer,
        contractAddress: '0xTempl',
        moderatorAddress: '0xMod',
        targetAddress: '0xTar'
      }),
      expectedError: 'fail'
    },
    {
      fn: muteMember,
      args: () => ({
        signer,
        contractAddress: '0xTempl',
        moderatorAddress: '0xMod',
        targetAddress: '0xTar'
      }),
      expectedError: 'Invalid /mute response'
    },
    {
      fn: fetchActiveMutes,
      args: () => ({ contractAddress: '0xTempl' }),
      expectedError: 'fail'
    },
    {
      fn: fetchActiveMutes,
      args: () => ({ contractAddress: '0xTempl' }),
      expectedError: 'Invalid /mutes response'
    }
  ];

  errorTable.forEach(({ fn, args, expectedError }) => {
    it(`${fn.name} rejects with ${expectedError}`, async () => {
      if (expectedError === 'fail') {
        mockFetchError(new Error('fail'));
      } else {
        mockFetchSuccess({});
      }
      await expect(fn(args())).rejects.toThrow(expectedError);
    });
  });
});
