import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import process from 'node:process';
import {
  deployTempl,
  purchaseAndJoin
} from './flows.js';
import templArtifact from './contracts/TEMPL.json';
import templFactoryArtifact from './contracts/TemplFactory.json';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

function createStubEthers(state) {
  const normalize = (addr) => addr ? addr.toLowerCase() : ZERO_ADDRESS;

  class StubContract {
    constructor(address, abi, signer) {
      this.address = normalize(address);
      this.abi = abi;
      this.signer = signer;
      if (this.address === normalize(state.factoryAddress)) {
        this.kind = 'factory';
      } else if (state.templs[this.address]) {
        this.kind = 'templ';
      } else if (state.tokens[this.address]) {
        this.kind = 'token';
      } else {
        this.kind = 'unknown';
      }
    }

    async protocolFeeRecipient() {
      if (this.kind !== 'factory') throw new Error('not factory');
      return state.protocolFeeRecipient;
    }

    async protocolBP() {
      if (this.kind !== 'factory') throw new Error('not factory');
      return BigInt(state.protocolBP);
    }

    get createTempl() {
      if (this.kind !== 'factory') return undefined;
      const fn = async (priest, token, entryFee, burnBP, treasuryBP, memberPoolBP) => {
        state.createdTempls.push({ priest: normalize(priest), token: normalize(token), entryFee: BigInt(entryFee), burnBP: Number(burnBP), treasuryBP: Number(treasuryBP), memberPoolBP: Number(memberPoolBP) });
        const addr = normalize(`0xTempl${state.createdTempls.length}`);
        state.templs[addr] = {
          accessToken: normalize(token),
          entryFee: BigInt(entryFee),
          burnBP: Number(burnBP),
          treasuryBP: Number(treasuryBP),
          memberPoolBP: Number(memberPoolBP),
          protocolBP: state.protocolBP,
          members: new Set()
        };
        return {
          wait: async () => ({ transactionHash: `0xtx-${state.createdTempls.length}` })
        };
      };
      fn.staticCall = async (priest, token, entryFee, burnBP, treasuryBP, memberPoolBP) => {
        const addr = normalize(`0xTempl${state.createdTempls.length + 1}`);
        state.pendingTempl = { priest: normalize(priest), token: normalize(token), entryFee: BigInt(entryFee), burnBP: Number(burnBP), treasuryBP: Number(treasuryBP), memberPoolBP: Number(memberPoolBP), address: addr };
        return addr;
      };
      return fn;
    }

    async accessToken() {
      const templ = state.templs[this.address];
      if (!templ) throw new Error('templ missing');
      return templ.accessToken;
    }

    async entryFee() {
      const templ = state.templs[this.address];
      return templ.entryFee;
    }

    async hasAccess(member) {
      const templ = state.templs[this.address];
      return templ.members.has(normalize(member));
    }

    async getConfig() {
      const templ = state.templs[this.address];
      return [
        templ.accessToken,
        templ.entryFee,
        false,
        BigInt(templ.members.size),
        0n,
        0n,
        templ.burnBP,
        templ.treasuryBP,
        templ.memberPoolBP,
        templ.protocolBP
      ];
    }

    async purchaseAccess() {
      const templ = state.templs[this.address];
      const member = normalize(await this.signer.getAddress());
      templ.members.add(member);
      return { wait: async () => ({}) };
    }

    // Minimal ERC20 interface for approvals
    async allowance(owner, spender) {
      const token = state.tokens[this.address];
      const key = `${normalize(owner)}:${normalize(spender)}`;
      return token.allowances.get(key) || 0n;
    }

    async approve(spender, amount) {
      const token = state.tokens[this.address];
      const owner = normalize(await this.signer.getAddress());
      const key = `${owner}:${normalize(spender)}`;
      token.allowances.set(key, BigInt(amount));
      return { wait: async () => ({}) };
    }

    async getAddress() {
      return this.address;
    }
  }

  class StubContractFactory {
    constructor(abi, bytecode, signer) {
      this.signer = signer;
      this.abi = abi;
      this.bytecode = bytecode;
    }

    deploy() {
      return this.signer;
    }
  }

  return {
    ZeroAddress: ZERO_ADDRESS,
    isAddress: (addr) => typeof addr === 'string' && addr.startsWith('0x') && addr.length === 42,
    getAddress: (addr) => normalize(addr),
    Contract: StubContract,
    ContractFactory: StubContractFactory,
    Interface: class { constructor() {} }
  };
}

function createSigner(address) {
  const normalized = address.toLowerCase();
  const provider = {
    async getNetwork() {
      return { chainId: 1337n };
    }
  };
  return {
    provider,
    async getAddress() {
      return normalized;
    },
    signTypedData: vi.fn().mockResolvedValue('sig'),
    signMessage: vi.fn().mockResolvedValue('sig')
  };
}

function createStubXMTP() {
  const groups = new Map();
  return {
    inboxId: 'stub-inbox',
    conversations: {
      async newGroup() {
        const id = `group-${groups.size + 1}`;
        const group = {
          id,
          async send() {},
          async sync() {}
        };
        groups.set(id, group);
        return group;
      },
      async list() {
        return Array.from(groups.values());
      }
    },
    preferences: {
      async inboxState() {}
    },
    debugInformation: {
      async apiAggregateStatistics() {
        return 'UploadKeyPackage 1';
      }
    }
  };
}

describe('core flows e2e (stubbed)', () => {
  let originalFetch;
  let originalLocalStorage;
  let originalDebugFlag;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    const store = new Map();
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k)
    };
    originalDebugFlag = process.env.VITE_E2E_DEBUG;
    process.env.VITE_E2E_DEBUG = '1';
  });

  afterEach(() => {
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    } else {
      delete globalThis.fetch;
    }
    if (originalLocalStorage) {
      globalThis.localStorage = originalLocalStorage;
    } else {
      delete globalThis.localStorage;
    }
    if (originalDebugFlag === undefined) {
      delete process.env.VITE_E2E_DEBUG;
    } else {
      process.env.VITE_E2E_DEBUG = originalDebugFlag;
    }
    vi.restoreAllMocks();
  });

  it('deploys via factory and allows join with custom fee split', async () => {
    const state = {
      factoryAddress: '0xFaC70ry00000000000000000000000000000001',
      protocolFeeRecipient: '0xProt0000000000000000000000000000000001',
      protocolBP: 10,
      createdTempls: [],
      templs: {},
      tokens: {
        '0xt0ken000000000000000000000000000000000001': {
          allowances: new Map()
        }
      }
    };
    const ethers = createStubEthers(state);
    const signer = createSigner('0xPriest00000000000000000000000000000001');
    const xmtp = createStubXMTP();

    const fetchMock = vi.fn()
      .mockImplementationOnce(async (url, init) => {
        expect(url).toBe('http://backend/templs');
        expect(JSON.parse(init.body).contractAddress).toMatch(/^0xtempl/);
        return {
          ok: true,
          status: 200,
          json: async () => ({ groupId: 'group-1' })
        };
      })
      .mockImplementationOnce(async (url, init) => {
        expect(url).toBe('http://backend/join');
        const body = JSON.parse(init.body);
        expect(body.contractAddress).toMatch(/^0xtempl/);
        return {
          ok: true,
          status: 200,
          json: async () => ({ groupId: 'group-1' })
        };
      });
    globalThis.fetch = fetchMock;

    const result = await deployTempl({
      ethers,
      xmtp,
      signer,
      walletAddress: await signer.getAddress(),
      tokenAddress: '0xT0ken0000000000000000000000000000000001',
      entryFee: '1000',
      burnBP: '20',
      treasuryBP: '45',
      memberPoolBP: '25',
      factoryAddress: state.factoryAddress,
      factoryArtifact: templFactoryArtifact,
      templArtifact,
      backendUrl: 'http://backend'
    });

    expect(result.contractAddress).toMatch(/^0xtempl/);
    expect(result.groupId).toBe('group-1');
    expect(state.createdTempls).toHaveLength(1);
    expect(state.createdTempls[0]).toMatchObject({
      burnBP: 20,
      treasuryBP: 45,
      memberPoolBP: 25
    });

    const memberSigner = createSigner('0xMember00000000000000000000000000000001');
    const joinResult = await purchaseAndJoin({
      ethers,
      xmtp,
      signer: memberSigner,
      walletAddress: await memberSigner.getAddress(),
      templAddress: result.contractAddress,
      templArtifact,
      backendUrl: 'http://backend'
    });

    expect(joinResult.groupId).toBe('group-1');
    const templState = state.templs[result.contractAddress.toLowerCase()];
    expect(templState.members.has(await memberSigner.getAddress())).toBe(true);
  });
});
