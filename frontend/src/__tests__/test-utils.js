import { vi } from 'vitest';

// Mock global Buffer for test environment
if (typeof global.Buffer === 'undefined') {
  global.Buffer = require('buffer').Buffer;
}

// Test utilities for XMTP functions
// Extracted from App.jsx for testing purposes

export function makeXmtpSigner({ address, signer, nonce }) {
  return {
    type: 'EOA',
    getAddress: () => address,
    getIdentifier: () => ({
      identifier: address.toLowerCase(),
      identifierKind: 'Ethereum',
      nonce
    }),
    signMessage: async (message) => {
      let toSign;
      if (message instanceof Uint8Array) {
        try {
          toSign = new TextDecoder().decode(message);
        } catch {
          toSign = '0x' + Array.from(message).map(byte => byte.toString(16).padStart(2, '0')).join('');
        }
      } else if (typeof message === 'string') {
        toSign = message;
      } else {
        toSign = String(message);
      }
      const signature = await signer.signMessage(toSign);
      return new Uint8Array(Buffer.from(signature.slice(2), 'hex'));
    }
  };
}

// Mock utilities for testing
export function createMockSigner() {
  return {
    signMessage: vi.fn().mockResolvedValue('0x1234567890abcdef')
  };
}

export const MOCK_ADDRESS = '0x1234567890123456789012345678901234567890';

// Mock XMTP Client and related utilities
export function createMockClient(options = {}) {
  return {
    inboxId: options.inboxId || 'test-inbox-id',
    installationId: options.installationId || 'test-installation-id',
    close: vi.fn().mockResolvedValue(),
    getKeyPackageStatusesForInstallationIds: vi.fn().mockResolvedValue([]),
    ...options
  };
}

export function createMockClientInstance() {
  const mockClient = {
    inboxId: 'test-inbox-id',
    installationId: 'test-installation-id',
    close: vi.fn().mockResolvedValue(),
    getKeyPackageStatusesForInstallationIds: vi.fn()
  };

  // Mock successful client creation
  vi.doMock('@xmtp/browser-sdk', () => ({
    Client: {
      create: vi.fn().mockResolvedValue(mockClient)
    }
  }));

  return mockClient;
}

// Mock localStorage for testing
export function createMockLocalStorage() {
  const store = {};
  return {
    setItem: vi.fn((key, value) => {
      store[key] = String(value);
    }),
    getItem: vi.fn((key) => store[key] || null),
    removeItem: vi.fn((key) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      Object.keys(store).forEach(key => delete store[key]);
    })
  };
}