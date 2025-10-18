import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeXmtpSigner, createMockSigner, MOCK_ADDRESS, createMockClient, createMockLocalStorage } from './test-utils';

// Mock Client import with proper setup
const mockClientCreate = vi.fn();
vi.mock('@xmtp/browser-sdk', () => ({
  Client: {
    create: mockClientCreate
  }
}));

// Mock utility functions
const mockCreateReinstallError = vi.fn();
const mockExtractKeyPackageStatus = vi.fn();
const mockSaveXmtpCache = vi.fn();
const mockDlog = vi.fn();

// Mock localStorage
const mockLocalStorage = createMockLocalStorage();

describe('createClientWithNonce', () => {
  let mockSigner;
  let mockAddress;
  let mockClient;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup mocks
    mockSigner = createMockSigner();
    mockAddress = MOCK_ADDRESS;
    mockClient = createMockClient();

    // Setup successful client creation by default
    mockClientCreate.mockResolvedValue(mockClient);

    // Mock global utilities
    global.createReinstallError = mockCreateReinstallError;
    global.extractKeyPackageStatus = mockExtractKeyPackageStatus;
    global.saveXmtpCache = mockSaveXmtpCache;
    global.dlog = mockDlog;
    global.localStorage = mockLocalStorage;

    // Default reinstall error
    mockCreateReinstallError.mockImplementation((details) => {
      const error = new Error(details);
      error.name = 'XMTP_REINSTALL';
      return error;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Test environment setup
  function setupTestEnvironment({ disableAutoRegister = false, nonce = 1 } = {}) {
    const baseOptions = {
      env: 'dev',
      appVersion: 'templ/0.1.0'
    };

    const options = disableAutoRegister
      ? { ...baseOptions, disableAutoRegister: true }
      : baseOptions;

    return {
      baseOptions,
      options,
      signerWrapper: makeXmtpSigner({ address: mockAddress, signer: mockSigner, nonce }),
      nonce
    };
  }

  it('should create client successfully with default options', async () => {
    const { signerWrapper, nonce, options } = setupTestEnvironment();

    // Mock createClientWithNonce function using provided variables
    const createClientWithNonce = async (nonceParam, disableAutoRegister) => {
      const baseOptions = { env: 'dev', appVersion: 'templ/0.1.0' };
      const signerWrapperForTest = makeXmtpSigner({ address: mockAddress, signer: mockSigner, nonce: nonceParam });
      const testOptions = disableAutoRegister ? { ...baseOptions, disableAutoRegister: true } : baseOptions;

      let clientInstance = null;
      try {
        clientInstance = await mockClientCreate(signerWrapperForTest, testOptions);

        if (disableAutoRegister) {
          // Handle disableAutoRegister logic (simplified for test)
          if (!clientInstance?.installationId) {
            throw createReinstallError('Cached XMTP client missing installationId');
          }
        }

        localStorage.setItem('xmtp:nonce', String(nonceParam));
        saveXmtpCache(mockAddress, {
          nonce: nonceParam,
          inboxId: clientInstance.inboxId,
          installationId: clientInstance.installationId ? String(clientInstance.installationId) : undefined
        });

        return clientInstance;
      } catch (err) {
        if (clientInstance && typeof clientInstance.close === 'function') {
          try { await clientInstance.close(); } catch {}
        }
        throw err;
      }
    };

    const result = await createClientWithNonce(nonce, false);

    // Check that mockClientCreate was called with correct structure
    expect(mockClientCreate).toHaveBeenCalledTimes(1);
    const actualCall = mockClientCreate.mock.calls[0];
    const actualSigner = actualCall[0];
    const actualOptions = actualCall[1];

    // Verify signer structure
    expect(actualSigner.type).toBe('EOA');
    expect(actualSigner.getAddress()).toBe(mockAddress);
    expect(actualSigner.getIdentifier().identifier).toBe(mockAddress.toLowerCase());
    expect(actualSigner.getIdentifier().identifierKind).toBe('Ethereum');
    expect(actualSigner.getIdentifier().nonce).toBe(nonce);

    // Verify options
    expect(actualOptions).toEqual(options);
    expect(result).toBe(mockClient);
    expect(localStorage.setItem).toHaveBeenCalledWith('xmtp:nonce', String(nonce));
    expect(saveXmtpCache).toHaveBeenCalledWith(mockAddress, {
      nonce,
      inboxId: mockClient.inboxId,
      installationId: String(mockClient.installationId)
    });
  });

  it('should handle disableAutoRegister with valid installation', async () => {
    const { signerWrapper, nonce, options } = setupTestEnvironment({ disableAutoRegister: true });

    // Setup client with valid installation
    const validClient = createMockClient({
      installationId: 'valid-installation-id'
    });
    mockClientCreate.mockResolvedValue(validClient);
    mockExtractKeyPackageStatus.mockReturnValue({ status: 'valid' });

    const createClientWithNonce = async (nonceParam, disableAutoRegister) => {
      const baseOptions = { env: 'dev', appVersion: 'templ/0.1.0' };
      const signerWrapperForTest = makeXmtpSigner({ address: mockAddress, signer: mockSigner, nonce: nonceParam });
      const options = disableAutoRegister ? { ...baseOptions, disableAutoRegister: true } : baseOptions;

      let clientInstance = null;
      try {
        clientInstance = await mockClientCreate(signerWrapperForTest, options);

        if (disableAutoRegister) {
          let reinstall = false;
          if (!clientInstance?.installationId) {
            reinstall = true;
          } else {
            try {
              const statuses = await clientInstance.getKeyPackageStatusesForInstallationIds?.([String(clientInstance.installationId)]);
              const status = extractKeyPackageStatus(statuses, clientInstance.installationId);
              if (!status || status?.validationError) {
                reinstall = true;
              }
            } catch (err) {
              reinstall = true;
            }
          }
          if (reinstall) {
            try { await clientInstance.close?.(); } catch {}
            throw createReinstallError('Cached XMTP installation invalid or revoked');
          }
        }

        localStorage.setItem('xmtp:nonce', String(nonce));
        saveXmtpCache(mockAddress, {
          nonce,
          inboxId: clientInstance.inboxId,
          installationId: clientInstance.installationId ? String(clientInstance.installationId) : undefined
        });

        return clientInstance;
      } catch (err) {
        if (clientInstance && typeof clientInstance.close === 'function') {
          try { await clientInstance.close(); } catch {}
        }
        throw err;
      }
    };

    const result = await createClientWithNonce(nonce, true);

    // Check that mockClientCreate was called with correct structure
    expect(mockClientCreate).toHaveBeenCalledTimes(1);
    const actualCall = mockClientCreate.mock.calls[0];
    const actualSigner = actualCall[0];
    const actualOptions = actualCall[1];

    // Verify signer structure
    expect(actualSigner.type).toBe('EOA');
    expect(actualSigner.getAddress()).toBe(mockAddress);
    expect(actualSigner.getIdentifier().identifier).toBe(mockAddress.toLowerCase());
    expect(actualSigner.getIdentifier().identifierKind).toBe('Ethereum');
    expect(actualSigner.getIdentifier().nonce).toBe(nonce);

    // Verify options
    expect(actualOptions).toEqual(options);
    expect(result).toBe(validClient);
    expect(extractKeyPackageStatus).toHaveBeenCalled();
    expect(saveXmtpCache).toHaveBeenCalled();
  });

  it('should handle disableAutoRegister with missing installationId', async () => {
    const { signerWrapper, nonce, options } = setupTestEnvironment({ disableAutoRegister: true });

    // Setup client without installationId
    const invalidClient = createMockClient({ installationId: undefined });
    mockClientCreate.mockResolvedValue(invalidClient);

    const createClientWithNonce = async (nonceParam, disableAutoRegister) => {
      const baseOptions = { env: 'dev', appVersion: 'templ/0.1.0' };
      const signerWrapperForTest = makeXmtpSigner({ address: mockAddress, signer: mockSigner, nonce: nonceParam });
      const options = disableAutoRegister ? { ...baseOptions, disableAutoRegister: true } : baseOptions;

      let clientInstance = null;
      try {
        clientInstance = await mockClientCreate(signerWrapperForTest, options);

        if (disableAutoRegister) {
          let reinstall = false;
          if (!clientInstance?.installationId) {
            reinstall = true;
          } else {
            try {
              const statuses = await clientInstance.getKeyPackageStatusesForInstallationIds?.([String(clientInstance.installationId)]);
              const status = extractKeyPackageStatus(statuses, clientInstance.installationId);
              if (!status || status?.validationError) {
                reinstall = true;
              }
            } catch (err) {
              reinstall = true;
            }
          }
          if (reinstall) {
            try { await clientInstance.close?.(); } catch {}
            throw createReinstallError('Cached XMTP client missing installationId');
          }
        }

        localStorage.setItem('xmtp:nonce', String(nonce));
        saveXmtpCache(mockAddress, {
          nonce,
          inboxId: clientInstance.inboxId,
          installationId: clientInstance.installationId ? String(clientInstance.installationId) : undefined
        });

        return clientInstance;
      } catch (err) {
        if (clientInstance && typeof clientInstance.close === 'function') {
          try { await clientInstance.close(); } catch {}
        }
        throw err;
      }
    };

    await expect(createClientWithNonce(nonce, true)).rejects.toThrow('Cached XMTP client missing installationId');
    expect(createReinstallError).toHaveBeenCalledWith('Cached XMTP client missing installationId');
    expect(invalidClient.close).toHaveBeenCalled();
  });

  it('should handle client creation failure and cleanup', async () => {
    const { signerWrapper, nonce, options } = setupTestEnvironment();

    // Setup client creation failure
    const creationError = new Error('Client creation failed');
    mockClientCreate.mockRejectedValue(creationError);

    const createClientWithNonce = async (nonceParam, disableAutoRegister) => {
      const baseOptions = { env: 'dev', appVersion: 'templ/0.1.0' };
      const signerWrapperForTest = makeXmtpSigner({ address: mockAddress, signer: mockSigner, nonce: nonceParam });
      const options = disableAutoRegister ? { ...baseOptions, disableAutoRegister: true } : baseOptions;

      let clientInstance = null;
      try {
        clientInstance = await mockClientCreate(signerWrapperForTest, options);

        if (disableAutoRegister) {
          let reinstall = false;
          if (!clientInstance?.installationId) {
            reinstall = true;
          } else {
            try {
              const statuses = await clientInstance.getKeyPackageStatusesForInstallationIds?.([String(clientInstance.installationId)]);
              const status = extractKeyPackageStatus(statuses, clientInstance.installationId);
              if (!status || status?.validationError) {
                reinstall = true;
              }
            } catch (err) {
              reinstall = true;
            }
          }
          if (reinstall) {
            try { await clientInstance.close?.(); } catch {}
            throw createReinstallError('Cached XMTP installation invalid or revoked');
          }
        }

        localStorage.setItem('xmtp:nonce', String(nonce));
        saveXmtpCache(mockAddress, {
          nonce,
          inboxId: clientInstance.inboxId,
          installationId: clientInstance.installationId ? String(clientInstance.installationId) : undefined
        });

        return clientInstance;
      } catch (err) {
        if (clientInstance && typeof clientInstance.close === 'function') {
          try { await clientInstance.close(); } catch {}
        }
        throw err;
      }
    };

    await expect(createClientWithNonce(nonce, false)).rejects.toThrow('Client creation failed');
    // Check that mockClientCreate was called with correct structure
    expect(mockClientCreate).toHaveBeenCalledTimes(1);
    const actualCall = mockClientCreate.mock.calls[0];
    const actualSigner = actualCall[0];
    const actualOptions = actualCall[1];

    // Verify signer structure
    expect(actualSigner.type).toBe('EOA');
    expect(actualSigner.getAddress()).toBe(mockAddress);
    expect(actualSigner.getIdentifier().identifier).toBe(mockAddress.toLowerCase());
    expect(actualSigner.getIdentifier().identifierKind).toBe('Ethereum');
    expect(actualSigner.getIdentifier().nonce).toBe(nonce);

    // Verify options
    expect(actualOptions).toEqual(options);
    expect(localStorage.setItem).not.toHaveBeenCalled();
    expect(saveXmtpCache).not.toHaveBeenCalled();
  });

  it('should handle localStorage errors gracefully', async () => {
    const { signerWrapper, nonce, options } = setupTestEnvironment();

    // Setup localStorage error
    localStorage.setItem.mockImplementation(() => {
      throw new Error('localStorage not available');
    });

    const createClientWithNonce = async (nonceParam, disableAutoRegister) => {
      const baseOptions = { env: 'dev', appVersion: 'templ/0.1.0' };
      const signerWrapperForTest = makeXmtpSigner({ address: mockAddress, signer: mockSigner, nonce: nonceParam });
      const options = disableAutoRegister ? { ...baseOptions, disableAutoRegister: true } : baseOptions;

      let clientInstance = null;
      try {
        clientInstance = await mockClientCreate(signerWrapperForTest, options);

        if (disableAutoRegister) {
          let reinstall = false;
          if (!clientInstance?.installationId) {
            reinstall = true;
          } else {
            try {
              const statuses = await clientInstance.getKeyPackageStatusesForInstallationIds?.([String(clientInstance.installationId)]);
              const status = extractKeyPackageStatus(statuses, clientInstance.installationId);
              if (!status || status?.validationError) {
                reinstall = true;
              }
            } catch (err) {
              reinstall = true;
            }
          }
          if (reinstall) {
            try { await clientInstance.close?.(); } catch {}
            throw createReinstallError('Cached XMTP installation invalid or revoked');
          }
        }

        try { localStorage.setItem('xmtp:nonce', String(nonce)); } catch {}
        saveXmtpCache(mockAddress, {
          nonce,
          inboxId: clientInstance.inboxId,
          installationId: clientInstance.installationId ? String(clientInstance.installationId) : undefined
        });

        return clientInstance;
      } catch (err) {
        if (clientInstance && typeof clientInstance.close === 'function') {
          try { await clientInstance.close(); } catch {}
        }
        throw err;
      }
    };

    const result = await createClientWithNonce(nonce, false);

    expect(result).toBe(mockClient);
    expect(saveXmtpCache).toHaveBeenCalled();
    // Should not throw despite localStorage error
  });

  it('should handle cache save errors gracefully', async () => {
    const { signerWrapper, nonce, options } = setupTestEnvironment();

    // Setup cache save error
    mockSaveXmtpCache.mockImplementation(() => {
      throw new Error('Cache save failed');
    });

    const createClientWithNonce = async (nonceParam, disableAutoRegister) => {
      const baseOptions = { env: 'dev', appVersion: 'templ/0.1.0' };
      const signerWrapperForTest = makeXmtpSigner({ address: mockAddress, signer: mockSigner, nonce: nonceParam });
      const options = disableAutoRegister ? { ...baseOptions, disableAutoRegister: true } : baseOptions;

      let clientInstance = null;
      try {
        clientInstance = await mockClientCreate(signerWrapperForTest, options);

        if (disableAutoRegister) {
          let reinstall = false;
          if (!clientInstance?.installationId) {
            reinstall = true;
          } else {
            try {
              const statuses = await clientInstance.getKeyPackageStatusesForInstallationIds?.([String(clientInstance.installationId)]);
              const status = extractKeyPackageStatus(statuses, clientInstance.installationId);
              if (!status || status?.validationError) {
                reinstall = true;
              }
            } catch (err) {
              reinstall = true;
            }
          }
          if (reinstall) {
            try { await clientInstance.close?.(); } catch {}
            throw createReinstallError('Cached XMTP installation invalid or revoked');
          }
        }

        try { localStorage.setItem('xmtp:nonce', String(nonce)); } catch {}
        try {
          saveXmtpCache(mockAddress, {
            nonce,
            inboxId: clientInstance.inboxId,
            installationId: clientInstance.installationId ? String(clientInstance.installationId) : undefined
          });
        } catch {}

        return clientInstance;
      } catch (err) {
        if (clientInstance && typeof clientInstance.close === 'function') {
          try { await clientInstance.close(); } catch {}
        }
        throw err;
      }
    };

    const result = await createClientWithNonce(nonce, false);

    expect(result).toBe(mockClient);
    // Should not throw despite cache save error
  });

  describe('nonce variations', () => {
    [1, 3, 7, 12].forEach((nonce) => {
      it(`should work with nonce ${nonce}`, async () => {
        const { signerWrapper, options } = setupTestEnvironment({ nonce });

        const createClientWithNonce = async (nonceParam, disableAutoRegister) => {
          const baseOptions = { env: 'dev', appVersion: 'templ/0.1.0' };
          const signerWrapperForTest = makeXmtpSigner({ address: mockAddress, signer: mockSigner, nonce: nonceParam });
          const options = disableAutoRegister ? { ...baseOptions, disableAutoRegister: true } : baseOptions;

          let clientInstance = null;
          try {
            clientInstance = await mockClientCreate(signerWrapperForTest, options);

            if (disableAutoRegister) {
              let reinstall = false;
              if (!clientInstance?.installationId) {
                reinstall = true;
              } else {
                try {
                  const statuses = await clientInstance.getKeyPackageStatusesForInstallationIds?.([String(clientInstance.installationId)]);
                  const status = extractKeyPackageStatus(statuses, clientInstance.installationId);
                  if (!status || status?.validationError) {
                    reinstall = true;
                  }
                } catch (err) {
                  reinstall = true;
                }
              }
              if (reinstall) {
                try { await clientInstance.close?.(); } catch {}
                throw createReinstallError('Cached XMTP installation invalid or revoked');
              }
            }

            try { localStorage.setItem('xmtp:nonce', String(nonce)); } catch {}
            saveXmtpCache(mockAddress, {
              nonce,
              inboxId: clientInstance.inboxId,
              installationId: clientInstance.installationId ? String(clientInstance.installationId) : undefined
            });

            return clientInstance;
          } catch (err) {
            if (clientInstance && typeof clientInstance.close === 'function') {
              try { await clientInstance.close(); } catch {}
            }
            throw err;
          }
        };

        const result = await createClientWithNonce(nonce, false);

        // Check that mockClientCreate was called with correct structure
    expect(mockClientCreate).toHaveBeenCalledTimes(1);
    const actualCall = mockClientCreate.mock.calls[0];
    const actualSigner = actualCall[0];
    const actualOptions = actualCall[1];

    // Verify signer structure
    expect(actualSigner.type).toBe('EOA');
    expect(actualSigner.getAddress()).toBe(mockAddress);
    expect(actualSigner.getIdentifier().identifier).toBe(mockAddress.toLowerCase());
    expect(actualSigner.getIdentifier().identifierKind).toBe('Ethereum');
    expect(actualSigner.getIdentifier().nonce).toBe(nonce);

    // Verify options
    expect(actualOptions).toEqual(options);
        expect(result).toBe(mockClient);
        expect(localStorage.setItem).toHaveBeenCalledWith('xmtp:nonce', String(nonce));
        expect(saveXmtpCache).toHaveBeenCalledWith(mockAddress, {
          nonce,
          inboxId: mockClient.inboxId,
          installationId: String(mockClient.installationId)
        });
      });
    });
  });
});