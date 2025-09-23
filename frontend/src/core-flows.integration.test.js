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
  const normalize = (addr) => (addr ? addr.toLowerCase() : ZERO_ADDRESS);
  const DEFAULT_BURN_ADDRESS = '0x000000000000000000000000000000000000dead';
  const DEFAULT_QUORUM_PERCENT = 33;
  const DEFAULT_EXECUTION_DELAY = 7 * 24 * 60 * 60;

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

    _nextTemplAddress() {
      return normalize(`0xTempl${state.createdTempls.length + 1}`);
    }

    async _normalizeConfig(input) {
      const priest = normalize(input.priest ?? (await this.signer.getAddress()));
      const token = normalize(input.token);
      if (token === ZERO_ADDRESS) throw new Error('token required');
      if (input.entryFee === undefined) throw new Error('entry fee required');
      const entryFee = typeof input.entryFee === 'bigint' ? input.entryFee : BigInt(input.entryFee);
      const burnPercent = Number(input.burnPercent ?? 30);
      const treasuryPercent = Number(input.treasuryPercent ?? 30);
      const memberPoolPercent = Number(input.memberPoolPercent ?? 30);
      const quorumPercent = Number(input.quorumPercent ?? DEFAULT_QUORUM_PERCENT);
      const executionDelaySeconds = Number(input.executionDelaySeconds ?? DEFAULT_EXECUTION_DELAY);
      const burnAddress = input.burnAddress ? normalize(input.burnAddress) : DEFAULT_BURN_ADDRESS;
      const priestIsDictator = input.priestIsDictator === true;
      return {
        priest,
        token,
        entryFee,
        burnPercent,
        treasuryPercent,
        memberPoolPercent,
        quorumPercent,
        executionDelaySeconds,
        burnAddress,
        priestIsDictator
      };
    }

    _recordTempl(config, address) {
      const addr = (address ?? config.address ?? this._nextTemplAddress()).toLowerCase();
      state.createdTempls.push({
        priest: config.priest,
        token: config.token,
        entryFee: config.entryFee,
        burnPercent: config.burnPercent,
        treasuryPercent: config.treasuryPercent,
        memberPoolPercent: config.memberPoolPercent,
        quorumPercent: config.quorumPercent,
        executionDelaySeconds: config.executionDelaySeconds,
        burnAddress: config.burnAddress,
        priestIsDictator: config.priestIsDictator
      });
      state.templs[addr] = {
        accessToken: config.token,
        entryFee: config.entryFee,
        burnPercent: config.burnPercent,
        treasuryPercent: config.treasuryPercent,
        memberPoolPercent: config.memberPoolPercent,
        protocolPercent: state.protocolPercent,
        quorumPercent: config.quorumPercent,
        executionDelaySeconds: config.executionDelaySeconds,
        burnAddress: config.burnAddress,
        priestIsDictator: config.priestIsDictator,
        members: new Set()
      };
      state.pendingTempl = null;
      return addr;
    }

    async protocolFeeRecipient() {
      if (this.kind !== 'factory') throw new Error('not factory');
      return state.protocolFeeRecipient;
    }

    async protocolPercent() {
      if (this.kind !== 'factory') throw new Error('not factory');
      return BigInt(state.protocolPercent);
    }

    async protocolBP() {
      return this.protocolPercent();
    }

    get createTempl() {
      if (this.kind !== 'factory') return undefined;
      const fn = async (token, entryFee, overrides = {}) => {
        const config = await this._normalizeConfig({ token, entryFee, ...overrides });
        const pending = state.pendingTempl && state.pendingTempl.address ? state.pendingTempl : null;
        const finalConfig = pending ?? { ...config, address: this._nextTemplAddress() };
        this._recordTempl(finalConfig, finalConfig.address);
        return {
          wait: async () => ({ transactionHash: `0xtx-${state.createdTempls.length}` })
        };
      };
      fn.staticCall = async (token, entryFee, overrides = {}) => {
        const config = await this._normalizeConfig({ token, entryFee, ...overrides });
        const address = this._nextTemplAddress();
        state.pendingTempl = { ...config, address };
        return address;
      };
      return fn;
    }

    get createTemplWithConfig() {
      if (this.kind !== 'factory') return undefined;
      const fn = async (configArg, overrides = {}) => {
        const config = await this._normalizeConfig({ ...configArg, ...overrides });
        const pending = state.pendingTempl && state.pendingTempl.address ? state.pendingTempl : null;
        const finalConfig = pending ?? { ...config, address: this._nextTemplAddress() };
        this._recordTempl(finalConfig, finalConfig.address);
        return {
          wait: async () => ({ transactionHash: `0xtx-${state.createdTempls.length}` })
        };
      };
      fn.staticCall = async (configArg) => {
        const config = await this._normalizeConfig(configArg);
        const address = this._nextTemplAddress();
        state.pendingTempl = { ...config, address };
        return address;
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
        templ.burnPercent,
        templ.treasuryPercent,
        templ.memberPoolPercent,
        templ.protocolPercent
      ];
    }

    async purchaseAccess() {
      const templ = state.templs[this.address];
      const member = normalize(await this.signer.getAddress());
      templ.members.add(member);
      return { wait: async () => ({}) };
    }

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
      protocolPercent: 10,
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

    const fetchMock = vi.fn(async (url, init = {}) => {
      if (url === 'http://backend/templs') {
        const payload = JSON.parse(init.body);
        expect(payload.contractAddress).toMatch(/^0xtempl/);
        return {
          ok: true,
          status: 200,
          json: async () => ({ groupId: 'group-1' })
        };
      }
      if (url === 'http://backend/templs?include=groupId') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ templs: [] })
        };
      }
      if (url.startsWith('http://backend/debug/')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({})
        };
      }
      if (url === 'http://backend/join') {
        const body = JSON.parse(init.body);
        expect(body.contractAddress).toMatch(/^0xtempl/);
        return {
          ok: true,
          status: 200,
          json: async () => ({ groupId: 'group-1' })
        };
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });
    globalThis.fetch = fetchMock;

    const result = await deployTempl({
      ethers,
      xmtp,
      signer,
      walletAddress: await signer.getAddress(),
      tokenAddress: '0xT0ken0000000000000000000000000000000001',
      entryFee: '1000',
      burnPercent: '20',
      treasuryPercent: '45',
      memberPoolPercent: '25',
      factoryAddress: state.factoryAddress,
      factoryArtifact: templFactoryArtifact,
      templArtifact,
      backendUrl: 'http://backend'
    });

    expect(result.contractAddress).toMatch(/^0xtempl/);
    expect(result.groupId).toBe('group-1');
    expect(state.createdTempls).toHaveLength(1);
    expect(state.createdTempls[0]).toMatchObject({
      burnPercent: 20,
      treasuryPercent: 45,
      memberPoolPercent: 25
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
