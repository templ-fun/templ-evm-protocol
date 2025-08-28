import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  deployTempl,
  purchaseAndJoin,
  sendMessage,
  proposeVote,
  voteOnProposal,
  watchProposals
} from './flows.js';

const templArtifact = { abi: [], bytecode: '0x' };

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('templ flows', () => {
  it('deployTempl deploys contract and registers group', async () => {
    const fakeContract = {
      waitForDeployment: vi.fn(),
      getAddress: vi.fn().mockResolvedValue('0xDeAd')
    };
    const factory = { deploy: vi.fn().mockResolvedValue(fakeContract) };
    const ethers = {
      ContractFactory: vi.fn().mockImplementation(() => factory)
    };
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ groupId: 'group-1' }) });
    const xmtp = { conversations: { getGroup: vi.fn().mockResolvedValue('groupObj') } };
    const signer = { signMessage: vi.fn().mockResolvedValue('sig') };

    const result = await deployTempl({
      ethers,
      xmtp,
      signer,
      walletAddress: '0xabc',
      tokenAddress: '0xdef',
      protocolFeeRecipient: '0xfee',
      entryFee: '1',
      priestVoteWeight: '10',
      priestWeightThreshold: '10',
      templArtifact
    });

    expect(ethers.ContractFactory).toHaveBeenCalled();
    expect(factory.deploy).toHaveBeenCalledWith(
      '0xabc',
      '0xfee',
      '0xdef',
      BigInt(1),
      BigInt(10),
      BigInt(10)
    );
    expect(signer.signMessage).toHaveBeenCalledWith('create:0xdead');
    expect(result).toEqual({ contractAddress: '0xDeAd', group: 'groupObj', groupId: 'group-1' });
  });

  it('purchaseAndJoin purchases access and joins group', async () => {
    const contract = {
      hasPurchased: vi.fn().mockResolvedValue(false),
      purchaseAccess: vi.fn().mockResolvedValue({ wait: vi.fn() })
    };
    const ethers = { Contract: vi.fn().mockReturnValue(contract) };
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ groupId: 'group-2' }) });
    const xmtp = { conversations: { getGroup: vi.fn().mockResolvedValue('groupObj2') } };
    const signer = { signMessage: vi.fn().mockResolvedValue('sig') };

    const result = await purchaseAndJoin({
      ethers,
      xmtp,
      signer,
      walletAddress: '0xabc',
      templAddress: '0xTeMpL',
      templArtifact
    });

    expect(contract.purchaseAccess).toHaveBeenCalled();
    expect(signer.signMessage).toHaveBeenCalledWith('join:0xtempl');
    expect(result).toEqual({ group: 'groupObj2', groupId: 'group-2' });
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
    expect(contract.vote).toHaveBeenCalledWith(1, true);
  });

  it('watchProposals registers event listeners', () => {
    const on = vi.fn();
    const contract = { on };
    const ethers = { Contract: vi.fn().mockReturnValue(contract) };
    watchProposals({
      ethers,
      provider: {},
      templAddress: '0xtempl',
      templArtifact,
      onProposal: vi.fn(),
      onVote: vi.fn()
    });
    expect(on).toHaveBeenCalledTimes(2);
  });
});
