import { normalizeAddressLower } from './XMTPUtils';

export const JOINED_STORAGE_PREFIX = 'templ:joined';
const cacheLocks = new Map();
const CACHE_LOCK_TIMEOUT = 5000; // 5 seconds

export class XMTPCache {
  static xmtpCacheKeyForWallet(address) {
    return address ? `xmtp:cache:${address.toLowerCase()}` : null;
  }

  static joinedStorageKeyForWallet(walletLower) {
    return walletLower ? `${JOINED_STORAGE_PREFIX}:${walletLower}` : JOINED_STORAGE_PREFIX;
  }

  static loadJoinedTemplsFromStorage(storageKey = JOINED_STORAGE_PREFIX) {
    if (typeof window === 'undefined') return [];
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      const normalized = parsed
        .map((value) => normalizeAddressLower(value))
        .filter(Boolean);
      return Array.from(new Set(normalized));
    } catch {
      return [];
    }
  }

  static async acquireCacheLock(key) {
    const start = Date.now();

    while (Date.now() - start < CACHE_LOCK_TIMEOUT) {
      if (!cacheLocks.has(key)) {
        cacheLocks.set(key, Date.now());
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    console.log(`[XMTPCache] Cache lock timeout for key: ${key}`);
    return false;
  }

  static releaseCacheLock(key) {
    cacheLocks.delete(key);
  }

  static async atomicLoadXmtpCache(address) {
    const key = this.xmtpCacheKeyForWallet(address);
    if (!key) return null;

    const lockAcquired = await this.acquireCacheLock(key);
    if (!lockAcquired) {
      console.log(`[XMTPCache] Failed to acquire cache lock for load: ${key}`);
      return null;
    }

    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (err) {
      console.log(`[XMTPCache] Error loading XMTP cache:`, err?.message || err);
      return null;
    } finally {
      this.releaseCacheLock(key);
    }
  }

  static async atomicSaveXmtpCache(address, data) {
    const key = this.xmtpCacheKeyForWallet(address);
    if (!key) return false;

    const lockAcquired = await this.acquireCacheLock(key);
    if (!lockAcquired) {
      console.log(`[XMTPCache] Failed to acquire cache lock for save: ${key}`);
      return false;
    }

    try {
      const existing = (() => {
        try {
          const raw = localStorage.getItem(key);
          return raw ? JSON.parse(raw) : {};
        } catch {
          return {};
        }
      })();

      const next = { ...existing, ...data };
      localStorage.setItem(key, JSON.stringify(next));
      console.log(`[XMTPCache] Atomically saved XMTP cache for: ${key}`);
      return true;
    } catch (err) {
      console.log(`[XMTPCache] Error saving XMTP cache:`, err?.message || err);
      return false;
    } finally {
      this.releaseCacheLock(key);
    }
  }
}

// Debounced cache write to prevent rapid successive writes
const debouncedCacheWrites = new Map();
const CACHE_DEBOUNCE_MS = 100;

export class XMTPCacheManager {
  static async debouncedSaveXmtpCache(address, data) {
    const key = XMTPCache.xmtpCacheKeyForWallet(address);
    if (!key) return;

    // Cancel any existing debounce for this key
    if (debouncedCacheWrites.has(key)) {
      clearTimeout(debouncedCacheWrites.get(key));
    }

    // Set new debounce
    const timeoutId = setTimeout(async () => {
      await XMTPCache.atomicSaveXmtpCache(address, data);
      debouncedCacheWrites.delete(key);
    }, CACHE_DEBOUNCE_MS);

    debouncedCacheWrites.set(key, timeoutId);
  }

  static loadXmtpCache(address) {
    const key = XMTPCache.xmtpCacheKeyForWallet(address);
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

  static saveXmtpCache(address, data) {
    // For backward compatibility, use the debounced version
    this.debouncedSaveXmtpCache(address, data);
  }
}