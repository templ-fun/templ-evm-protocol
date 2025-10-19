// Import all modules for re-export
import { XMTPService } from './XMTPService';
import { XMTPCache, XMTPCacheManager, JOINED_STORAGE_PREFIX } from './XMTPCache';
import {
  XMTPInstallations,
  getStableNonce,
  makeXmtpSigner,
  installationIdToBytes,
  installationMatches,
  formatInstallationRecord,
  areUint8ArraysEqual,
  clearXmtpPersistence
} from './XMTPInstallations';
import { XMTPCircuitBreaker } from './XMTPCircuitBreaker';
import {
  XMTP_CONSENT_STATE_VALUES,
  XMTP_GROUP_CONVERSATION_TYPE,
  XMTP_SYNC_CONVERSATION_TYPE,
  XMTP_TIMEOUT_MS,
  XMTP_RETRY_DELAYS,
  normalizeAddressLower,
  extractKeyPackageStatus,
  delay,
  resolveXmtpEnv,
  createReinstallError,
  isMissingInstallationError
} from './XMTPUtils';
import { useXMTP } from './useXMTP';

// Re-export everything
export { XMTPService };
export { XMTPCache, XMTPCacheManager, JOINED_STORAGE_PREFIX };
export {
  XMTPInstallations,
  getStableNonce,
  makeXmtpSigner,
  installationIdToBytes,
  installationMatches,
  formatInstallationRecord,
  areUint8ArraysEqual,
  clearXmtpPersistence
};
export { XMTPCircuitBreaker };
export {
  XMTP_CONSENT_STATE_VALUES,
  XMTP_GROUP_CONVERSATION_TYPE,
  XMTP_SYNC_CONVERSATION_TYPE,
  XMTP_TIMEOUT_MS,
  XMTP_RETRY_DELAYS,
  normalizeAddressLower,
  extractKeyPackageStatus,
  delay,
  resolveXmtpEnv,
  createReinstallError,
  isMissingInstallationError
};
export { useXMTP };

// Default export for convenience
export default {
  XMTPService,
  XMTPCache,
  XMTPCacheManager,
  XMTPInstallations,
  XMTPCircuitBreaker,
  useXMTP,
  constants: {
    XMTP_CONSENT_STATE_VALUES,
    XMTP_GROUP_CONVERSATION_TYPE,
    XMTP_SYNC_CONVERSATION_TYPE,
    XMTP_TIMEOUT_MS,
    XMTP_RETRY_DELAYS
  },
  utils: {
    normalizeAddressLower,
    extractKeyPackageStatus,
    delay,
    resolveXmtpEnv,
    createReinstallError,
    isMissingInstallationError
  },
  helpers: {
    createClientWithNonce: (options) => XMTPService.createClientWithNonce(options),
    extractKeyPackageStatus: (status) => XMTPService.extractKeyPackageStatus(status)
  }
};