import { ethers } from 'ethers';
import { Client } from '@xmtp/browser-sdk';
import { XMTPCache } from './XMTPCache';

export class XMTPInstallations {
  static installationIdToBytes(id) {
    if (!id) return null;
    try {
      if (/^0x/i.test(id)) {
        return ethers.getBytes(id);
      }
    } catch {}
    try {
      const normalized = id.replace(/-/g, '+').replace(/_/g, '/');
      const padded = normalized + '==='.slice((normalized.length + 3) % 4);
      if (typeof window !== 'undefined' && typeof window.atob === 'function') {
        const binary = window.atob(padded);
        const out = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) {
          out[i] = binary.charCodeAt(i);
        }
        return out;
      }
      if (typeof globalThis !== 'undefined' && typeof globalThis.Buffer !== 'undefined') {
        return globalThis.Buffer.from(padded, 'base64');
      }
      // Fallback manual decode
      const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
      const bytes = [];
      let buffer = 0;
      let bits = 0;
      for (const char of padded) {
        if (char === '=') break;
        const index = alphabet.indexOf(char);
        if (index === -1) continue;
        buffer = (buffer << 6) | index;
        bits += 6;
        if (bits >= 8) {
          bits -= 8;
          bytes.push((buffer >> bits) & 0xff);
        }
      }
      return Uint8Array.from(bytes);
    } catch {
      return null;
    }
  }

  static formatInstallationRecord(inst) {
    if (!inst) return { id: '', timestamp: 0, bytes: null, revokedAt: 0 };
    let timestamp = 0;
    let revokedAt = 0;
    try {
      if (typeof inst.clientTimestampNs === 'bigint') {
        timestamp = Number(inst.clientTimestampNs / 1000000n);
      }
    } catch {}
    try {
      if (typeof inst.revokedAtNs === 'bigint') {
        revokedAt = Number(inst.revokedAtNs / 1000000n);
      } else if (typeof inst.revokedTimestampNs === 'bigint') {
        revokedAt = Number(inst.revokedTimestampNs / 1000000n);
      } else if (typeof inst.revokedAtMs === 'number') {
        revokedAt = inst.revokedAtMs;
      } else if (typeof inst.revokedAt === 'number') {
        revokedAt = inst.revokedAt;
      }
    } catch {}
    return {
      id: inst.id || '',
      timestamp,
      bytes: inst.bytes instanceof Uint8Array ? inst.bytes : null,
      revokedAt
    };
  }

  static areUint8ArraysEqual(a, b) {
    if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  static installationMatches(inst, targetId, targetBytes) {
    if (!inst) return false;
    const id = inst.id ? String(inst.id) : '';
    if (inst.revokedAt && inst.revokedAt > 0) {
      return false;
    }
    if (id && targetId) {
      if (id === targetId) {
        return true;
      }
      const bothHex = /^0x/i.test(id) && /^0x/i.test(targetId);
      if (bothHex && id.toLowerCase() === targetId.toLowerCase()) {
        return true;
      }
    }
    const instBytes = inst.bytes instanceof Uint8Array ? inst.bytes : this.installationIdToBytes(id);
    if (instBytes && targetBytes) {
      return this.areUint8ArraysEqual(instBytes, targetBytes);
    }
    return false;
  }

  static async pruneExcessInstallations({ address, signer, cache, env, keepInstallationId, pushStatus }) {
    if (!cache?.inboxId || !signer) {
      return { revoked: false, installations: null };
    }
    try {
      const states = await Client.inboxStateFromInboxIds([cache.inboxId], env);
      const state = Array.isArray(states) ? states[0] : null;
      const installations = Array.isArray(state?.installations) ? state.installations : [];
      const formatted = installations.map(this.formatInstallationRecord).filter((inst) => inst.id);
      if (formatted.length < 10) {
        return { revoked: false, installations: formatted };
      }
      const sorted = formatted.filter((inst) => inst.id && inst.id !== keepInstallationId);
      sorted.sort((a, b) => a.timestamp - b.timestamp);
      const maxOtherInstallations = 8;
      const overflow = Math.max(0, sorted.length - maxOtherInstallations);
      if (overflow <= 0) {
        return { revoked: false, installations: formatted };
      }
      const targets = sorted.slice(0, overflow);
      const payload = targets
        .map((inst) => inst.bytes || this.installationIdToBytes(inst.id))
        .filter((value) => value instanceof Uint8Array);
      if (!payload.length) {
        return { revoked: false, installations: formatted };
      }
      const nonce = this.getStableNonce(address);
      const signerWrapper = this.makeXmtpSigner({ address, signer, nonce });
      await Client.revokeInstallations(signerWrapper, cache.inboxId, payload, env);
      if (pushStatus) {
        pushStatus(`♻️ Revoked ${targets.length} older XMTP installation${targets.length === 1 ? '' : 's'}`);
      }
      const remaining = formatted.filter((inst) => !targets.some((target) => inst.id === target.id));
      return { revoked: true, installations: remaining };
    } catch (err) {
      console.warn('[XMTPInstallations] prune installations failed', err?.message || err);
      return { revoked: false, installations: null };
    }
  }

  static makeXmtpSigner({ address, signer, nonce }) {
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
          try { toSign = ethers.toUtf8String(message); } catch { toSign = ethers.hexlify(message); }
        } else if (typeof message === 'string') {
          toSign = message;
        } else {
          toSign = String(message);
        }
        const signature = await signer.signMessage(toSign);
        return ethers.getBytes(signature);
      }
    };
  }

  static loadXmtpCache(address) {
    const key = address ? `xmtp:cache:${address.toLowerCase()}` : 'xmtp:cache';
    if (!key) return null;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  static getStableNonce(address) {
    if (!address) return 1;
    // Use local implementation to avoid circular dependency
    const cache = this.loadXmtpCache(address);
    if (cache?.nonce) return cache.nonce;
    try {
      const saved = Number.parseInt(localStorage.getItem(`xmtp:nonce:${address.toLowerCase()}`) || '1', 10);
      if (Number.isFinite(saved) && saved > 0) {
        return saved;
      }
    } catch {}
    return 1;
  }

  static async clearXmtpPersistence(tag) {
    if (typeof navigator === 'undefined' || !navigator?.storage?.getDirectory) {
      return false;
    }
    let cleared = false;
    try {
      const root = await navigator.storage.getDirectory();
      if (!root || typeof root.entries !== 'function') return false;
      for await (const [name, handle] of root.entries()) {
        if (!name || typeof name !== 'string') continue;
        if (!name.startsWith('xmtp-')) continue;
        try {
          if (handle?.kind === 'directory') {
            await root.removeEntry(name, { recursive: true });
          } else {
            await root.removeEntry(name);
          }
          cleared = true;
        } catch (err) {
          console.log('[XMTPInstallations] Failed to remove XMTP persistence entry', { name, message: err?.message || err });
        }
      }
      if (cleared) {
        console.log('[XMTPInstallations] Cleared XMTP persistence', tag ? { tag } : undefined);
      }
    } catch (err) {
      console.log('[XMTPInstallations] clearXmtpPersistence error', err?.message || err);
    }
    return cleared;
  }
}

// Export static methods for direct import
export const getStableNonce = XMTPInstallations.getStableNonce;
export const makeXmtpSigner = XMTPInstallations.makeXmtpSigner;
export const installationIdToBytes = XMTPInstallations.installationIdToBytes;
export const installationMatches = XMTPInstallations.installationMatches;
export const formatInstallationRecord = XMTPInstallations.formatInstallationRecord;
export const areUint8ArraysEqual = XMTPInstallations.areUint8ArraysEqual;
export const clearXmtpPersistence = XMTPInstallations.clearXmtpPersistence;