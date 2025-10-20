// @ts-check
import { useState, useEffect } from 'react';
import { Client } from '@xmtp/browser-sdk';

function XMTPDebug() {
  const [debugInfo, setDebugInfo] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [walletAddress, setWalletAddress] = useState('');
  const [xmtpClient, setXmtpClient] = useState(null);
  const [activeInboxId, setActiveInboxId] = useState('');
  const [xmtpInstallations, setXmtpInstallations] = useState([]);

  // Helper: find any cached XMTP info in localStorage
  function findAnyXmtpCache() {
    try {
      if (typeof localStorage === 'undefined') return null;
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        if (key.startsWith('xmtp:cache:')) {
          try {
            const address = key.slice('xmtp:cache:'.length);
            const parsed = JSON.parse(localStorage.getItem(key) || '{}');
            if (parsed && typeof parsed === 'object') {
              return { address, cache: parsed };
            }
          } catch {/* ignore */}
        }
      }
    } catch {/* ignore */}
    return null;
  }

  // Sync window properties (and fallbacks) to state
  useEffect(() => {
    const interval = setInterval(() => {
      try {
        if (window.walletAddress !== walletAddress) {
          setWalletAddress(window.walletAddress || '');
        }
      } catch {/* ignore */}
      try {
        const candidateClient = window.xmtpClient || window.__XMTP || null;
        if (candidateClient !== xmtpClient) {
          setXmtpClient(candidateClient);
        }
      } catch {/* ignore */}
      try {
        const candidateInbox = window.activeInboxId || (xmtpClient?.inboxId ?? '') || '';
        if (candidateInbox !== activeInboxId) {
          setActiveInboxId(candidateInbox || '');
        }
      } catch {/* ignore */}
      try {
        const candidateInstalls = window.xmtpInstallations || [];
        if (JSON.stringify(candidateInstalls) !== JSON.stringify(xmtpInstallations)) {
          setXmtpInstallations(candidateInstalls);
        }
      } catch {/* ignore */}
    }, 100);

    return () => clearInterval(interval);
  }, [walletAddress, xmtpClient, activeInboxId, xmtpInstallations]);

  useEffect(() => {
    const loadDebugInfo = async () => {
      try {
        // Get wallet info from state
        const info = {
          walletAddress: walletAddress || 'Not available',
          xmtpClient: xmtpClient ? 'Available' : 'Not available',
          activeInboxId: activeInboxId || 'Not available',
          installationsCount: xmtpInstallations?.length || 'Unknown',
          userAgent: navigator.userAgent,
          timestamp: new Date().toISOString(),
          xmtpEnv: import.meta.env.VITE_XMTP_ENV || 'not set'
        };

        // Try to get user's inbox ID using browser SDK (or cache fallback)
        if (walletAddress && xmtpClient) {
          try {
            // In browser SDK, we can get inbox ID from the client
            const inboxId = xmtpClient.inboxId;
            info.userInboxId = inboxId || 'Not available';
            info.inboxIdTimestamp = new Date().toISOString();
            info.inboxIdSource = 'client';
          } catch (err) {
            info.userInboxIdError = err.message;
            info.inboxIdTimestamp = new Date().toISOString();
          }
        } else if (walletAddress && !xmtpClient) {
          // Fallback to cache: xmtp:cache:<address>
          try {
            const cached = findAnyXmtpCache();
            const cachedInbox = cached?.cache?.inboxId || '';
            if (cachedInbox) {
              info.userInboxId = cachedInbox;
              info.inboxIdSource = 'cache';
              info.inboxIdTimestamp = new Date().toISOString();
              // Try to fetch installation count via inboxStateFromInboxIds
              try {
                const env = (() => {
                  const forced = import.meta.env.VITE_XMTP_ENV?.trim();
                  if (forced) return forced;
                  try {
                    const override = window.localStorage?.getItem?.('templ:xmtpEnv')?.trim();
                    if (override && ['local', 'dev', 'production'].includes(override)) {
                      return override;
                    }
                  } catch {/* ignore */}
                  return 'production';
                })();
                const states = await Client.inboxStateFromInboxIds([cachedInbox], env);
                const state = Array.isArray(states) ? states[0] : null;
                const list = Array.isArray(state?.installations) ? state.installations : [];
                info.installationsCount = list.length;
              } catch {/* ignore */}
            } else {
              info.userInboxIdError = 'XMTP client not initialized';
              info.inboxIdTimestamp = new Date().toISOString();
            }
          } catch {
            info.userInboxIdError = 'XMTP client not initialized';
            info.inboxIdTimestamp = new Date().toISOString();
          }
        }

        setDebugInfo(info);
        setLoading(false);
      } catch (err) {
        setDebugInfo({
          error: err.message,
          timestamp: new Date().toISOString()
        });
        setLoading(false);
      }
    };

    loadDebugInfo();
  }, [walletAddress, xmtpClient, activeInboxId, xmtpInstallations, refreshTrigger]);

  if (loading) {
    return (
      <div className="space-y-3 p-4">
        <h2 className="text-xl font-semibold">XMTP Debug Info</h2>
        <p>Loading XMTP debug information...</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 p-4">
      <h2 className="text-xl font-semibold">XMTP Debug Information</h2>
      <p className="text-sm text-black/60">This page helps debug XMTP client issues. Use this information to troubleshoot priest addition problems.</p>

      <div className="border border-black/20 rounded p-3 space-y-2">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-lg font-medium">Wallet & Connection</h3>
          <button
            className="px-3 py-1 rounded border border-black/20 text-xs hover:bg-black/5"
            onClick={() => {
              // Force reload the debug info by incrementing trigger
              setLoading(true);
              setRefreshTrigger(prev => prev + 1);
            }}
          >
            Refresh
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
          <div><strong>Wallet Address:</strong> <code className="text-xs">{debugInfo.walletAddress}</code></div>
          <div><strong>XMTP Client:</strong> {debugInfo.xmtpClient}</div>
          <div><strong>Active Inbox ID:</strong> <code className="text-xs">{debugInfo.activeInboxId}</code></div>
          <div><strong>Installation Count:</strong> {debugInfo.installationsCount}</div>
        </div>
      </div>

      {debugInfo.userInboxId && (
        <div className="border border-black/20 rounded p-3 space-y-2">
          <h3 className="text-lg font-medium mb-2">User Inbox Information</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
            <div><strong>Your Inbox ID:</strong> <code className="text-xs">{debugInfo.userInboxId}</code></div>
            <div><strong>Source:</strong> {debugInfo.inboxIdSource || 'Unknown'}</div>
            <div><strong>Query Time:</strong> {debugInfo.inboxIdTimestamp}</div>
          </div>
          <div className="mt-2 text-xs">
            <p>This is your XMTP inbox ID that should be used when you're listed as a priest in a templ.</p>
            {debugInfo.inboxIdSource === 'client' ? (
              <p className="text-green-600">✅ XMTP client initialized and inbox ID available!</p>
            ) : (
              <p className="text-yellow-600">⚠️ XMTP inbox ID may not be available. Initialize XMTP to ensure proper functionality.</p>
            )}
          </div>
        </div>
      )}

      {debugInfo.userInboxIdError && (
        <div className="border border-red-200 rounded p-3 space-y-2">
          <h3 className="text-lg font-medium mb-2">Inbox ID Resolution Error</h3>
          <div className="text-sm">
            <strong>Error:</strong> {debugInfo.userInboxIdError}
          </div>
        </div>
      )}

      {debugInfo.error && (
        <div className="border border-red-200 rounded p-3 space-y-2">
          <h3 className="text-lg font-medium mb-2">General Error</h3>
          <div className="text-sm">
            <strong>Error:</strong> {debugInfo.error}
          </div>
        </div>
      )}
    </div>
  );
}

export default XMTPDebug;
