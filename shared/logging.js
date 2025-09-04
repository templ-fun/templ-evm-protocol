// @ts-check

// Minimal logger usable in both Node and browser environments
const isDebug = (() => {
  try { if (globalThis?.process?.env?.DEBUG_TEMPL === '1') return true; } catch {}
  try {
    // @ts-ignore - vite injects env on import.meta at build time
    const env = import.meta?.env;
    if (env?.VITE_E2E_DEBUG === '1') return true;
  } catch {}
  return false;
})();
const noop = () => {};
const logger = {
  info: (...args) => { try { console.log(...args); } catch {} },
  warn: (...args) => { try { console.warn(...args); } catch {} },
  error: (...args) => { try { console.error(...args); } catch {} },
  debug: isDebug ? (...args) => { try { console.debug(...args); } catch {} } : noop
};

export { logger };
