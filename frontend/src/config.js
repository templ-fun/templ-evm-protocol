export const BACKEND_URL = (() => {
  try {
    if (globalThis?.process?.env?.BACKEND_URL) return globalThis.process.env.BACKEND_URL;
  } catch {}
  try {
    // @ts-ignore - Vite injects env on import.meta at build time
    const env = import.meta?.env;
    if (env?.VITE_BACKEND_URL) return env.VITE_BACKEND_URL;
  } catch {}
  return 'http://localhost:3001';
})();

function readEnv(key, fallback = '') {
  try {
    if (globalThis?.process?.env?.[key]) return globalThis.process.env[key];
  } catch {}
  try {
    // @ts-ignore - Vite injects env on import.meta at build time
    const env = import.meta?.env;
    if (env && Object.prototype.hasOwnProperty.call(env, key)) {
      return env[key];
    }
  } catch {}
  return fallback;
}

export const FACTORY_CONFIG = (() => {
  const address = readEnv('VITE_TEMPL_FACTORY_ADDRESS', readEnv('TEMPL_FACTORY_ADDRESS', '')).trim();
  const protocolRecipient = readEnv('VITE_TEMPL_FACTORY_PROTOCOL_RECIPIENT', readEnv('TEMPL_FACTORY_PROTOCOL_RECIPIENT', '')).trim();
  const protocolPercentRaw = readEnv('VITE_TEMPL_FACTORY_PROTOCOL_PERCENT', readEnv('TEMPL_FACTORY_PROTOCOL_BP', ''));
  let protocolPercent = undefined;
  if (protocolPercentRaw !== '') {
    const parsed = Number(protocolPercentRaw);
    if (Number.isFinite(parsed)) {
      protocolPercent = parsed;
    }
  }
  return {
    address,
    protocolFeeRecipient: protocolRecipient,
    protocolPercent
  };
})();

function resolveMiniAppOriginFromEnv() {
  const originEnv = readEnv('VITE_MINIAPP_ORIGIN', readEnv('MINIAPP_ORIGIN', '')).trim();
  if (originEnv) {
    return originEnv;
  }
  const domainEnv = readEnv('VITE_MINIAPP_DOMAIN', readEnv('MINIAPP_DOMAIN', '')).trim();
  if (domainEnv) {
    if (domainEnv.startsWith('http://') || domainEnv.startsWith('https://')) {
      return domainEnv;
    }
    return `https://${domainEnv}`;
  }
  return '';
}

const DEFAULT_MINIAPP_ORIGIN = 'https://app.templ.fun';

export function getMiniAppOrigin() {
  const fromEnv = resolveMiniAppOriginFromEnv();
  if (fromEnv) return fromEnv;
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return DEFAULT_MINIAPP_ORIGIN;
}

const MINIAPP_CANONICAL_BASE = (() => {
  const base = readEnv('VITE_MINIAPP_CANONICAL_BASE', readEnv('MINIAPP_CANONICAL_BASE', '')).trim();
  if (!base) return '';
  if (base.startsWith('http://') || base.startsWith('https://')) {
    return base;
  }
  return `https://${base}`;
})();

export function getMiniAppCanonicalBase() {
  return MINIAPP_CANONICAL_BASE;
}

export function buildMiniAppUrl(pathname = '/') {
  try {
    const origin = getMiniAppOrigin();
    return new URL(pathname, origin).toString();
  } catch {
    return pathname;
  }
}

export function buildMiniAppCanonicalUrl(pathname = '/') {
  const canonicalBase = getMiniAppCanonicalBase();
  if (!canonicalBase) return '';
  try {
    return new URL(pathname, canonicalBase).toString();
  } catch {
    return '';
  }
}
