// Shared helpers for frontend flows

// Minimal debug logger usable in both browser and Node tests
const __isDebug = (() => {
  // Node tests: opt-in via DEBUG_TEMPL=1
  try { if (globalThis?.process?.env?.DEBUG_TEMPL === '1') return true; } catch {}
  // Browser (Vite): import.meta.env.VITE_E2E_DEBUG
  try {
    // @ts-ignore - vite injects env on import.meta at build time
    const env = import.meta?.env;
    if (env?.VITE_E2E_DEBUG === '1') return true;
  } catch {}
  return false;
})();

export const dlog = (...args) => {
  if (!__isDebug) return;
  try { console.log(...args); } catch {}
};

export const isDebugEnabled = () => __isDebug;

export function isE2ETestEnv() {
  try { if (globalThis?.process?.env?.NODE_ENV === 'test') return true; } catch {}
  try {
    // @ts-ignore - vite env
    if (import.meta?.env?.VITE_E2E_DEBUG === '1') return true;
  } catch {}
  return false;
}

export function allowLocalTemplFallback() {
  try { if (globalThis?.process?.env?.TEMPL_ENABLE_LOCAL_FALLBACK === '1') return true; } catch {}
  try {
    // @ts-ignore - vite env
    if (import.meta?.env?.VITE_ENABLE_BACKEND_FALLBACK === '1') return true;
  } catch {}
  return false;
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
