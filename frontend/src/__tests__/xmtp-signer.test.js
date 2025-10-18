import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeXmtpSigner, createMockSigner, MOCK_ADDRESS } from './test-utils';

// Mock global for test environment
if (typeof global === 'undefined') {
  const global = {};
}

describe('makeXmtpSigner', () => {
  let mockSigner;
  let mockAddress;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Setup mock signer
    mockSigner = createMockSigner();
    mockAddress = MOCK_ADDRESS;
  });

  it('should create a signer with correct structure', () => {
    const nonce = 5;
    const signerWrapper = makeXmtpSigner({ address: mockAddress, signer: mockSigner, nonce });

    expect(signerWrapper).toEqual({
      type: 'EOA',
      getAddress: expect.any(Function),
      getIdentifier: expect.any(Function),
      signMessage: expect.any(Function)
    });
  });

  it('should return correct address from getAddress', () => {
    const signerWrapper = makeXmtpSigner({ address: mockAddress, signer: mockSigner, nonce: 3 });
    expect(signerWrapper.getAddress()).toBe(mockAddress);
  });

  it('should return correct identifier with nonce', () => {
    const nonce = 7;
    const signerWrapper = makeXmtpSigner({ address: mockAddress, signer: mockSigner, nonce });

    const identifier = signerWrapper.getIdentifier();
    expect(identifier).toEqual({
      identifier: mockAddress.toLowerCase(),
      identifierKind: 'Ethereum',
      nonce: 7
    });
  });

  it('should handle Uint8Array message signing', async () => {
    const message = new TextEncoder().encode('test message');
    const signerWrapper = makeXmtpSigner({ address: mockAddress, signer: mockSigner, nonce: 1 });

    await signerWrapper.signMessage(message);

    expect(mockSigner.signMessage).toHaveBeenCalledWith('test message');
  });

  it('should handle string message signing', async () => {
    const message = 'test string message';
    const signerWrapper = makeXmtpSigner({ address: mockAddress, signer: mockSigner, nonce: 2 });

    await signerWrapper.signMessage(message);

    expect(mockSigner.signMessage).toHaveBeenCalledWith(message);
  });

  it('should handle non-string message conversion', async () => {
    const message = { custom: 'object' };
    const signerWrapper = makeXmtpSigner({ address: mockAddress, signer: mockSigner, nonce: 4 });

    await signerWrapper.signMessage(message);

    expect(mockSigner.signMessage).toHaveBeenCalledWith('[object Object]');
  });

  it('should handle Uint8Array conversion fallback', async () => {
    // Force TextDecoder to fail by throwing an error
    const originalDecode = global.TextDecoder.prototype.decode;
    global.TextDecoder.prototype.decode = vi.fn(() => {
      throw new Error('Invalid UTF-8 sequence');
    });

    try {
      const message = new Uint8Array([0x80, 0x81]);
      const signerWrapper = makeXmtpSigner({ address: mockAddress, signer: mockSigner, nonce: 1 });

      await signerWrapper.signMessage(message);

      // Should fall back to hex conversion
      expect(mockSigner.signMessage).toHaveBeenCalledWith('0x8081');
    } finally {
      // Restore original decode
      global.TextDecoder.prototype.decode = originalDecode;
    }
  });

  it('should propagate signing errors', async () => {
    const error = new Error('Signing failed');
    mockSigner.signMessage.mockRejectedValue(error);

    const signerWrapper = makeXmtpSigner({ address: mockAddress, signer: mockSigner, nonce: 1 });

    await expect(signerWrapper.signMessage('test')).rejects.toThrow('Signing failed');
  });

  describe('nonce variations', () => {
    [1, 5, 10, 12].forEach((nonce) => {
      it(`should handle nonce ${nonce}`, () => {
        const signerWrapper = makeXmtpSigner({ address: mockAddress, signer: mockSigner, nonce });

        expect(signerWrapper.getIdentifier().nonce).toBe(nonce);
        expect(typeof signerWrapper.getAddress()).toBe('string');
        expect(typeof signerWrapper.signMessage).toBe('function');
      });
    });
  });
});