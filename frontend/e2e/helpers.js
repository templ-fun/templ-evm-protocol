import { ethers } from 'ethers';

const DEFAULT_CHAIN_ID_HEX = '0x539';

export async function setupWalletBridge({ page, provider, wallets = {}, chainIdHex = DEFAULT_CHAIN_ID_HEX, extraWallets = [] }) {
  const seen = new Set();
  const addressByKey = {};
  const walletByAddress = {};

  const enqueue = async (key, wallet) => {
    if (!wallet || seen.has(key)) return;
    seen.add(key);
    const address = (await wallet.getAddress()).toLowerCase();
    addressByKey[key] = address;
    walletByAddress[address] = wallet;
  };

  await enqueue('priest', wallets.priest);
  await enqueue('member', wallets.member);

  for (const [key, wallet] of Object.entries(wallets)) {
    await enqueue(key, wallet);
  }
  for (const entry of extraWallets) {
    if (!entry) continue;
    const { key, wallet } = entry;
    await enqueue(key, wallet);
  }

  let activeKey = 'priest';
  let activeWallet = walletByAddress[addressByKey[activeKey]];
  let isConnected = false;

  const handleRequest = async (_source, request) => {
    const { method, params = [] } = request || {};
    switch (method) {
      case 'eth_chainId':
        return chainIdHex;
      case 'net_version':
        return '1337';
      case 'eth_accounts': {
        if (!isConnected) return [];
        return [await activeWallet.getAddress()];
      }
      case 'eth_requestAccounts': {
        isConnected = true;
        return [await activeWallet.getAddress()];
      }
      case 'wallet_switchEthereumChain':
      case 'wallet_addEthereumChain':
        return null;
      case 'personal_sign': {
        const [message, addressMaybe] = params;
        const address = (addressMaybe || '').toLowerCase();
        const signer = walletByAddress[address] || activeWallet;
        const payload = typeof message === 'string' && message.startsWith('0x')
          ? ethers.getBytes(message)
          : message;
        return await signer.signMessage(payload);
      }
      case 'eth_sign': {
        const [addressMaybe, message] = params;
        const address = (addressMaybe || '').toLowerCase();
        const signer = walletByAddress[address] || activeWallet;
        const payload = typeof message === 'string' && message.startsWith('0x')
          ? ethers.getBytes(message)
          : message;
        return await signer.signMessage(payload);
      }
      case 'eth_signTypedData':
      case 'eth_signTypedData_v3':
      case 'eth_signTypedData_v4': {
        const [addressMaybe, typedDataRaw] = params;
        const address = (addressMaybe || '').toLowerCase();
        const signer = walletByAddress[address] || activeWallet;
        const typedData = typeof typedDataRaw === 'string'
          ? JSON.parse(typedDataRaw)
          : typedDataRaw;
        const { domain, message } = typedData;
        const types = { ...typedData.types };
        delete types.EIP712Domain;
        return await signer.signTypedData(domain, types, message);
      }
      case 'eth_sendTransaction': {
        const [tx] = params;
        if (!tx) throw new Error('Missing transaction payload');
        const from = (tx.from || (await activeWallet.getAddress())).toLowerCase();
        const signer = walletByAddress[from] || activeWallet;
        const value = tx.value;
        const txRequest = {
          to: tx.to,
          data: tx.data,
          value: value !== undefined ? BigInt(value === '0x' ? '0x0' : value) : undefined,
          gasLimit: tx.gas ?? tx.gasLimit,
          gasPrice: tx.gasPrice,
          maxFeePerGas: tx.maxFeePerGas,
          maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
          type: tx.type
        };
        const response = await signer.sendTransaction(txRequest);
        await response.wait();
        return response.hash;
      }
      default:
        return provider.send(method, params);
    }
  };

  await page.exposeBinding('templE2ERequest', handleRequest);

  await page.addInitScript(({ chainId }) => {
    const listeners = new Map();
    const state = { connected: false, selectedAddress: null, chainId };

    const getListeners = (event) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      return listeners.get(event);
    };
    const emit = (event, payload) => {
      const set = listeners.get(event);
      if (!set) return;
      for (const handler of Array.from(set)) {
        try {
          handler(payload);
        } catch (err) {
          console.error('[templ:e2e] listener error', err);
        }
      }
    };

    window.ethereum = {
      isMetaMask: true,
      chainId,
      async request(raw) {
        const req = typeof raw === 'string' ? { method: raw, params: [] } : (raw || {});
        const result = await window.templE2ERequest(req);
        if (req.method === 'eth_requestAccounts') {
          const list = Array.isArray(result) ? result : [];
          state.connected = list.length > 0;
          state.selectedAddress = list[0] || null;
          emit('accountsChanged', list);
        } else if (req.method === 'eth_accounts') {
          const list = Array.isArray(result) ? result : [];
          if (list.length > 0) {
            state.connected = true;
            state.selectedAddress = list[0];
          }
        } else if (req.method === 'eth_chainId' && typeof result === 'string') {
          state.chainId = result;
          window.ethereum.chainId = result;
        }
        return result;
      },
      on(event, handler) {
        getListeners(event).add(handler);
      },
      removeListener(event, handler) {
        getListeners(event).delete(handler);
      },
      off(event, handler) {
        getListeners(event).delete(handler);
      },
      once(event, handler) {
        const wrapped = (payload) => {
          this.removeListener(event, wrapped);
          handler(payload);
        };
        this.on(event, wrapped);
      },
      isConnected() {
        return state.connected;
      },
      enable() {
        return this.request({ method: 'eth_requestAccounts' });
      },
      get selectedAddress() {
        return state.selectedAddress;
      },
      set selectedAddress(value) {
        state.selectedAddress = value || null;
      }
    };

    window.templTestHooks = {
      emitAccountsChanged(accounts) {
        const list = Array.isArray(accounts) ? accounts : [];
        state.connected = list.length > 0;
        state.selectedAddress = list[0] || null;
        emit('accountsChanged', list);
      },
      setSelectedAddress(address) {
        state.selectedAddress = address || null;
      },
      setConnected(flag) {
        state.connected = Boolean(flag);
      },
      setChainId(next) {
        state.chainId = next;
        window.ethereum.chainId = next;
        emit('chainChanged', next);
      },
      getState() {
        return { ...state };
      }
    };
  }, { chainId: chainIdHex });

  const switchAccount = async (key, { emit = true } = {}) => {
    if (!addressByKey[key]) {
      throw new Error(`Unknown wallet key: ${key}`);
    }
    activeKey = key;
    activeWallet = walletByAddress[addressByKey[key]];
    if (emit) {
      isConnected = true;
      await page.evaluate((addr) => {
        window.templTestHooks.emitAccountsChanged([addr]);
      }, addressByKey[key]);
    } else {
      await page.evaluate((addr) => {
        window.templTestHooks.setSelectedAddress(addr);
      }, addressByKey[key]);
    }
  };

  return {
    switchAccount,
    getAddress(key) {
      return addressByKey[key];
    }
  };
}

export const CHAIN_ID_HEX = DEFAULT_CHAIN_ID_HEX;
