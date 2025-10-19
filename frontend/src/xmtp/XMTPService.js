import { Client } from '@xmtp/browser-sdk';
import { XMTPCacheManager } from './XMTPCache';
import { XMTPInstallations } from './XMTPInstallations';
import { XMTPCircuitBreaker } from './XMTPCircuitBreaker';
import { resolveXmtpEnv, XMTP_RETRY_DELAYS, XMTP_TIMEOUT_MS, XMTP_DEV_TIMEOUT_MS, createReinstallError } from './XMTPUtils';

const xmtpCircuitBreaker = new XMTPCircuitBreaker();

export class XMTPService {
  static isFileLockError(error) {
    const errorMessage = error?.message || error?.toString?.() || '';
    return errorMessage.includes('NoModificationAllowedError') ||
           errorMessage.includes('createSyncAccessHandle') ||
           errorMessage.includes('Database(NotFound)') ||
           errorMessage.includes('Access Handles cannot be created') ||
           errorMessage.includes('possible vfs error') ||
           errorMessage.includes('An error occurred while creating sync access handle');
  }

  static createFileLockError() {
    return new Error('Multiple tabs detected. Please close other browser tabs and refresh.');
  }

  static async createXmtpClient({
    address,
    signer,
    nonce,
    env,
    pushStatus,
    setXmtp,
    setXmtpError,
    setXmtpLimitWarning,
    setActiveInstallationId,
    setInstallations,
    setInstallationsError,
    setInstallationsLoading,
    useAutoConnectTimeout = false
  }) {
    if (!address || !signer) {
      throw new Error('Address and signer are required');
    }

    const walletLower = address.toLowerCase();
    const cache = await XMTPCacheManager.loadXmtpCache(walletLower);

    // Check if we need to reinstall
    if (cache?.inboxId && cache?.installationId) {
      try {
        await xmtpCircuitBreaker.execute(async () => {
          const states = await Client.inboxStateFromInboxIds([cache.inboxId], env);
          const state = Array.isArray(states) ? states[0] : null;
          const installations = Array.isArray(state?.installations) ? state.installations : [];

          const activeInstallations = installations
            .map(XMTPInstallations.formatInstallationRecord)
            .filter((inst) => inst.id && !inst.revokedAt);

          setInstallations(activeInstallations);

          // Check if our cached installation is still valid
          const isActive = activeInstallations.some((inst) =>
            XMTPInstallations.installationMatches(inst, cache.installationId)
          );

          if (!isActive) {
            throw new Error('Cached installation not found');
          }
        });
      } catch (err) {
        // Check for file lock conflicts during installation verification
        if (XMTPService.isFileLockError(err)) {
          const fileLockError = XMTPService.createFileLockError();
          console.warn('[XMTPService] File lock conflict during installation verification:', fileLockError.message);
          setXmtpError(fileLockError.message);
          setInstallationsLoading(false);
          throw fileLockError;
        }

        console.log('[XMTPService] Installation verification failed, clearing cache:', err?.message || err);
        await XMTPCacheManager.saveXmtpCache(walletLower, {
          inboxId: null,
          installationId: null
        });
        return this.createXmtpClient({
          address,
          signer,
          nonce,
          env,
          pushStatus,
          setXmtp,
          setXmtpError,
          setXmtpLimitWarning,
          setActiveInstallationId,
          setInstallations,
          setInstallationsError,
          setInstallationsLoading
        });
      }
    }

    // Create new client if needed
    try {
      setInstallationsLoading(true);
      setInstallationsError(null);

      const createClientFn = async () => {
        const signerWrapper = XMTPInstallations.makeXmtpSigner({
          address,
          signer,
          nonce
        });

        return await Client.create(signerWrapper, { env });
      };

      const client = await xmtpCircuitBreaker.execute(async () => {
        if (useAutoConnectTimeout) {
          return await this.createWithAutoConnectTimeout(createClientFn, 'XMTP client creation (auto-reconnect)');
        } else {
          return await createClientFn();
        }
      });

      // Save cache
      await XMTPCacheManager.saveXmtpCache(walletLower, {
        inboxId: client.inboxId,
        installationId: client.installationId,
        nonce
      });

      // Set active installation
      setActiveInstallationId(client.installationId);
      setXmtp(client);

      // Load installations
      try {
        const states = await Client.inboxStateFromInboxIds([client.inboxId], env);
        const state = Array.isArray(states) ? states[0] : null;
        const installations = Array.isArray(state?.installations) ? state.installations : [];

        const activeInstallations = installations
          .map(XMTPInstallations.formatInstallationRecord)
          .filter((inst) => inst.id && !inst.revokedAt);

        setInstallations(activeInstallations);

        // Prune excess installations
        if (activeInstallations.length >= 10) {
          const { revoked, installations: remaining } = await XMTPInstallations.pruneExcessInstallations({
            address,
            signer,
            cache: { inboxId: client.inboxId },
            env,
            keepInstallationId: client.installationId,
            pushStatus
          });

          if (revoked) {
            setInstallations(remaining);
          }
        }
      } catch (err) {
        // Check for file lock conflicts during installations loading
        if (XMTPService.isFileLockError(err)) {
          const fileLockError = XMTPService.createFileLockError();
          console.warn('[XMTPService] File lock conflict during installations loading:', fileLockError.message);
          setXmtpError(fileLockError.message);
          return; // Don't throw here, client was created successfully
        }

        console.warn('[XMTPService] Failed to load installations after client creation:', err?.message || err);
      }

      pushStatus('✅ XMTP client ready');
      return client;
    } catch (err) {
      console.error('[XMTPService] Failed to create XMTP client:', err?.message || err);

      // Handle file lock conflicts specifically
      if (XMTPService.isFileLockError(err)) {
        const fileLockError = XMTPService.createFileLockError();
        console.warn('[XMTPService] File lock conflict detected:', fileLockError.message);
        setXmtpError(fileLockError.message);
        setInstallationsLoading(false);
        throw fileLockError;
      }

      setXmtpError(err?.message || 'Failed to create XMTP client');
      setInstallationsLoading(false);
      throw err;
    }
  }

  static createWithTimeout(operation, timeoutMs = XMTP_TIMEOUT_MS, operationName = 'XMTP operation') {
    // Use environment-specific timeout if default is used
    const env = resolveXmtpEnv();
    const effectiveTimeout = timeoutMs === XMTP_TIMEOUT_MS && env === 'dev'
      ? XMTP_DEV_TIMEOUT_MS
      : timeoutMs;

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`${operationName} timed out after ${effectiveTimeout}ms`));
      }, effectiveTimeout);

      operation()
        .then((result) => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }

  static createWithAutoConnectTimeout(operation, operationName = 'XMTP auto-connect') {
    // Use a longer timeout for dev environment, shorter for production
    const env = resolveXmtpEnv();
    const timeoutMs = env === 'dev' ? 45000 : 15000; // 45s for dev, 15s for production
    return this.createWithRetry(
      () => this.createWithTimeout(operation, timeoutMs, operationName),
      1, // One retry
      operationName,
      { delays: [3000] } // 3 second delay before retry
    );
  }

  static async createWithRetry(
    operation,
    maxRetries = 3,
    operationName = 'XMTP operation',
    options = {}
  ) {
    const { delays = XMTP_RETRY_DELAYS, pushStatus } = options;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0 && pushStatus) {
          const delay = delays[Math.min(attempt - 1, delays.length - 1)];
          pushStatus(`🔄 Retrying ${operationName} (attempt ${attempt + 1}/${maxRetries + 1})...`);
          await delay(delay);
        }

        return await operation();
      } catch (error) {
        if (attempt === maxRetries) {
          if (pushStatus) {
            pushStatus(`❌ ${operationName} failed after ${maxRetries + 1} attempts`);
          }
          throw error;
        }
        console.log(`[XMTPService] ${operationName} attempt ${attempt + 1} failed:`, error?.message || error);
      }
    }
  }

  static async createClientWithNonce({
    address,
    signer,
    nonce,
    disableAutoRegister,
    baseOptions = {},
    xmtpCircuitBreaker,
    storageKey = 'xmtp:last-nonce'
  }) {
    return await xmtpCircuitBreaker.execute(async () => {
      return await this.createWithRetry(async () => {
        const signerWrapper = XMTPInstallations.makeXmtpSigner({ address, signer, nonce });
        const options = disableAutoRegister ? { ...baseOptions, disableAutoRegister: true } : baseOptions;
        console.log('[XMTPService] Creating XMTP client', { disableAutoRegister, nonce });
        let clientInstance = null;

        clientInstance = await this.createWithTimeout(
          async () => Client.create(signerWrapper, options),
          XMTP_TIMEOUT_MS,
          `XMTP client creation (nonce: ${nonce})`
        );

        if (disableAutoRegister) {
          let reinstall = false;
          if (!clientInstance?.installationId) {
            reinstall = true;
            console.log('[XMTPService] Cached XMTP client missing installationId after resume attempt', { nonce });
          } else {
            try {
              const statuses = await clientInstance.getKeyPackageStatusesForInstallationIds?.([String(clientInstance.installationId)]);
              const status = this.extractKeyPackageStatus(statuses, clientInstance.installationId);
              if (!status || status?.validationError) {
                reinstall = true;
                console.log('[XMTPService] XMTP key package status invalid after resume', {
                  nonce,
                  validationError: status?.validationError || null,
                  statusAvailable: Boolean(status)
                });
              }
            } catch (err) {
              reinstall = true;
              console.log('[XMTPService] XMTP key package status check threw during resume', err?.message || err);
            }
          }
          if (reinstall) {
            try { await clientInstance.close?.(); } catch {}
            throw createReinstallError('Cached XMTP installation invalid or revoked');
          }
        }

        try { localStorage.setItem(storageKey, String(nonce)); } catch {}
        await XMTPCacheManager.saveXmtpCache(address, {
          nonce,
          inboxId: clientInstance.inboxId,
          installationId: clientInstance.installationId ? String(clientInstance.installationId) : undefined
        });

        console.log('[XMTPService] XMTP client ready', {
          disableAutoRegister,
          nonce,
          inboxId: clientInstance.inboxId,
          installationId: clientInstance.installationId ? String(clientInstance.installationId) : null
        });

        return clientInstance;
      }, 2, `XMTP client creation (nonce: ${nonce})`);
    });
  }

  static extractKeyPackageStatus(statuses, installationId) {
    if (!Array.isArray(statuses) || !installationId) return null;
    return statuses.find(status => String(status.installationId) === String(installationId));
  }

  static async initializeXMTPAfterWalletConnect({
    address,
    signer,
    pushStatus,
    setXmtp,
    setXmtpError,
    setXmtpLimitWarning,
    setActiveInstallationId,
    setInstallations,
    setInstallationsError,
    setInstallationsLoading,
    setActiveInboxId,
    resetChatState,
    setPendingJoinAddress,
    setPurchaseStatusNote,
    setJoinStatusNote,
    setProfileOpen,
    useAutoConnectTimeout = false
  }) {
    // This function contains all the XMTP initialization logic that was previously in connectWallet
    // It handles the complex XMTP setup process while keeping wallet connection logic separate

    return new Promise((resolve, reject) => {
      (async () => {
        try {
          // Reset chat-related state
          resetChatState();
          setPendingJoinAddress(null);
          setPurchaseStatusNote(null);
          setJoinStatusNote(null);
          setProfileOpen(false);

          const client = await this.createXmtpClient({
            address,
            signer,
            nonce: XMTPInstallations.getStableNonce(address),
            env: resolveXmtpEnv(),
            pushStatus,
            setXmtp,
            setXmtpError,
            setXmtpLimitWarning,
            setActiveInstallationId,
            setInstallations,
            setInstallationsError,
            setInstallationsLoading,
            useAutoConnectTimeout
          });

          // Set XMTP state
          setActiveInboxId(client?.inboxId || '');

          resolve(client);
        } catch (error) {
          console.error('[XMTPService] Failed to initialize XMTP after wallet connect:', error);
          setXmtpError(error?.message || 'Failed to initialize XMTP');
          reject(error);
        }
      })();
    });
  }
}