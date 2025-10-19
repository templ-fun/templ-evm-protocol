import { useState, useCallback, useRef, useEffect } from 'react';
import { Client } from '@xmtp/browser-sdk';
import { XMTPService } from './XMTPService';
import { XMTPCacheManager } from './XMTPCache';
import { XMTPInstallations } from './XMTPInstallations';
import { resolveXmtpEnv } from './XMTPUtils';

export function useXMTP({ walletAddress, signer, pushStatus }) {
  const [xmtp, setXmtp] = useState(null);
  const [xmtpError, setXmtpError] = useState(null);
  const [xmtpLimitWarning, setXmtpLimitWarning] = useState(null);
  const [activeInstallationId, setActiveInstallationId] = useState(null);
  const [installationsOpen, setInstallationsOpen] = useState(false);
  const [installations, setInstallations] = useState([]);
  const [installationsLoading, setInstallationsLoading] = useState(false);
  const [installationsError, setInstallationsError] = useState(null);

  const abortControllerRef = useRef(null);
  const streamsRef = useRef({});

  const walletAddressLower = walletAddress?.toLowerCase() || '';

  const createXmtpClient = useCallback(async (useAutoConnectTimeout = false) => {
    if (!walletAddress || !signer) return null;

    try {
      setXmtpError(null);
      setXmtpLimitWarning(null);
      const env = resolveXmtpEnv();
      const nonce = XMTPInstallations.getStableNonce(walletAddress);

      const client = await XMTPService.createXmtpClient({
        address: walletAddress,
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
        useAutoConnectTimeout
      });

      return client;
    } catch (err) {
      console.error('[useXMTP] Failed to create XMTP client:', err?.message || err);

      // Check for file lock conflicts and provide user-friendly message
      if (XMTPService.isFileLockError(err)) {
        const fileLockError = XMTPService.createFileLockError();
        console.warn('[useXMTP] File lock conflict detected:', fileLockError.message);
        setXmtpError(fileLockError.message);
        return null;
      }

      setXmtpError(err?.message || 'Failed to create XMTP client');
      return null;
    }
  }, [walletAddress, signer, pushStatus]);

  const loadInstallationsState = useCallback(async () => {
    if (!walletAddress || !xmtp) return;

    try {
      console.log('[useXMTP] Loading installations state for:', {
        walletAddress: walletAddressLower,
        hasXmtpClient: !!xmtp,
        inboxId: xmtp?.inboxId
      });
      setInstallationsLoading(true);
      setInstallationsError(null);

      const cache = await XMTPCacheManager.loadXmtpCache(walletAddressLower);
      if (!cache?.inboxId) {
        setInstallationsError('No XMTP inbox found for this wallet.');
        setInstallationsLoading(false);
        return;
      }

      const env = resolveXmtpEnv();
      const states = await Client.inboxStateFromInboxIds([cache.inboxId], env);
      const state = Array.isArray(states) ? states[0] : null;
      const installationsList = Array.isArray(state?.installations) ? state.installations : [];

      const formattedInstallations = installationsList
        .map(XMTPInstallations.formatInstallationRecord)
        .filter((inst) => inst.id && !inst.revokedAt);

      setInstallations(formattedInstallations);
    } catch (err) {
      console.error('[useXMTP] loadInstallationsState error:', err?.message || err);
      setInstallationsError(err?.message || String(err));
    } finally {
      setInstallationsLoading(false);
    }
  }, [walletAddress, xmtp, walletAddressLower]);

  const handleOpenInstallations = useCallback(() => {
    setInstallationsOpen(true);
  }, []);

  const handleRevokeInstallation = useCallback(async (installationId) => {
    if (!walletAddress || !signer) {
      setInstallationsError('Connect a wallet to revoke installations.');
      return;
    }

    const cache = await XMTPCacheManager.loadXmtpCache(walletAddressLower);
    if (!cache?.inboxId) {
      setInstallationsError('No XMTP inbox found for this wallet.');
      return;
    }

    try {
      setInstallationsError(null);
      const env = resolveXmtpEnv();
      const nonce = XMTPInstallations.getStableNonce(walletAddress);
      const signerWrapper = XMTPInstallations.makeXmtpSigner({ address: walletAddress, signer, nonce });

      const target = installations.find((inst) => inst.id === installationId);
      const derivePayload = () => {
        const candidate = target?.bytes || XMTPInstallations.installationIdToBytes(installationId);
        return candidate instanceof Uint8Array ? [candidate] : [];
      };

      const payload = derivePayload();
      if (!payload.length) {
        throw new Error('Unable to parse installation id for revocation');
      }

      await Client.revokeInstallations(signerWrapper, cache.inboxId, payload, env);

      XMTPCacheManager.saveXmtpCache(walletAddress, {
        installationId: cache?.installationId && cache.installationId === installationId ? null : cache?.installationId
      });

      setInstallations((prev) => prev.filter((inst) => inst.id !== installationId));
      pushStatus('✅ Installation revoked');
      await loadInstallationsState();
    } catch (err) {
      console.error('[useXMTP] handleRevokeInstallation error:', err?.message || err);
      setInstallationsError(err?.message || String(err));
    }
  }, [walletAddress, signer, installations, walletAddressLower, pushStatus, loadInstallationsState]);

  const handleRevokeOtherInstallations = useCallback(async () => {
    if (!walletAddress || !signer) {
      setInstallationsError('Connect a wallet to revoke installations.');
      return;
    }

    const cache = await XMTPCacheManager.loadXmtpCache(walletAddressLower);
    if (!cache?.inboxId) {
      setInstallationsError('No XMTP inbox found for this wallet.');
      return;
    }

    try {
      setInstallationsError(null);
      const env = resolveXmtpEnv();

      const states = await Client.inboxStateFromInboxIds([cache.inboxId], env);
      const state = Array.isArray(states) ? states[0] : null;
      const targets = (state?.installations || [])
        .map(XMTPInstallations.formatInstallationRecord)
        .filter((inst) => inst.id && inst.id !== activeInstallationId);

      if (!targets.length) {
        setInstallationsError('No other installations to revoke.');
        return;
      }

      const nonce = XMTPInstallations.getStableNonce(walletAddress);
      const signerWrapper = XMTPInstallations.makeXmtpSigner({ address: walletAddress, signer, nonce });

      const payload = targets
        .map((inst) => inst.bytes || XMTPInstallations.installationIdToBytes(inst.id))
        .filter((value) => value instanceof Uint8Array);

      if (!payload.length) {
        throw new Error('Unable to parse installation ids for revocation');
      }

      await Client.revokeInstallations(signerWrapper, cache.inboxId, payload, env);

      const revokedIds = targets.map((inst) => inst.id);
      if (revokedIds.includes(cache?.installationId)) {
        XMTPCacheManager.saveXmtpCache(walletAddress, { installationId: null });
      }

      setInstallations((prev) => prev.filter((inst) => !revokedIds.includes(inst.id)));
      pushStatus('✅ Other installations revoked');
      await loadInstallationsState();
    } catch (err) {
      console.error('[useXMTP] handleRevokeOtherInstallations error:', err?.message || err);
      setInstallationsError(err?.message || String(err));
    }
  }, [walletAddress, signer, activeInstallationId, walletAddressLower, pushStatus, loadInstallationsState]);

  const cleanupXmtpStreams = useCallback(() => {
    Object.entries(streamsRef.current).forEach(([streamType, stream]) => {
      if (stream) {
        try {
          if (typeof stream.return === 'function') {
            stream.return();
          } else if (typeof stream.close === 'function') {
            stream.close();
          }
        } catch (err) {
          console.log(`[useXMTP] Error closing ${streamType} stream:`, err?.message || err);
        }
      }
      streamsRef.current[streamType] = null;
    });

    if (abortControllerRef.current) {
      try {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
        console.log('[useXMTP] Aborted ongoing XMTP operations');
      } catch (err) {
        console.log('[useXMTP] Error aborting operations:', err?.message || err);
      }
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupXmtpStreams();
    };
  }, [cleanupXmtpStreams]);

  // Load installations when wallet or active inbox changes
  useEffect(() => {
    console.log('[useXMTP] useEffect trigger:', {
      hasWalletAddress: !!walletAddress,
      hasXmtpClient: !!xmtp,
      hasInboxId: !!xmtp?.inboxId,
      inboxId: xmtp?.inboxId
    });
    if (!walletAddress || !xmtp?.inboxId) {
      console.log('[useXMTP] Skipping installation loading - missing requirements');
      return;
    }
    loadInstallationsState();
  }, [walletAddress, xmtp, xmtp?.inboxId, loadInstallationsState]);

  return {
    // State
    xmtp,
    xmtpError,
    xmtpLimitWarning,
    activeInstallationId,
    installationsOpen,
    installations,
    installationsLoading,
    installationsError,

    // Setters
    setXmtp,
    setXmtpError,
    setXmtpLimitWarning,
    setActiveInstallationId,
    setInstallationsError,
    setInstallationsLoading,
    setInstallationsOpen,
    setInstallations,

    // Actions
    createXmtpClient,
    loadInstallationsState,
    handleOpenInstallations,
    handleRevokeInstallation,
    handleRevokeOtherInstallations,
    cleanupXmtpStreams,

    // Refs for external access
    streamsRef,
    abortControllerRef
  };
}