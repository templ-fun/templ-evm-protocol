// Shared helpers for frontend flows

import { isTemplDebugEnabled, isTemplE2EDebug, isTemplTestEnv, readTemplEnv } from '../../../shared/debug.js';

// Minimal debug logger usable in both browser and Node tests
export const dlog = (...args) => {
  if (!isTemplDebugEnabled()) return;
  try { console.log(...args); } catch {}
};

export const isDebugEnabled = () => isTemplDebugEnabled();

export function isE2ETestEnv() {
  return isTemplTestEnv() || isTemplE2EDebug();
}

export function allowLocalTemplFallback() {
  const fallbackFlag = readTemplEnv('TEMPL_ENABLE_LOCAL_FALLBACK');
  if (fallbackFlag === '1' || fallbackFlag?.toLowerCase?.() === 'true') return true;
  const viteFallback = readTemplEnv('VITE_ENABLE_BACKEND_FALLBACK');
  return viteFallback === '1' || viteFallback?.toLowerCase?.() === 'true';
}

export function addToTestRegistry(address) {
  if (!isE2ETestEnv()) return;
  try {
    const key = 'templ:test:deploys';
    const arr = JSON.parse(localStorage.getItem(key) || '[]');
    if (!arr.includes(address)) arr.push(address);
    localStorage.setItem(key, JSON.stringify(arr));
    localStorage.setItem('templ:lastAddress', address);
  } catch {}
}
