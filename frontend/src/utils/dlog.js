// @ts-check
// Shared debug logger for browser and Node environments
const isDebug = (() => {
  try {
    if (globalThis?.process?.env?.DEBUG_TEMPL === '1') return true;
  } catch {}
  try {
    const env = import.meta?.env;
    if (env?.DEV || env?.VITE_E2E_DEBUG === '1') return true;
  } catch {}
  return false;
})();
export const dlog = (...args) => {
  if (isDebug) {
    try { console.log(...args); } catch {}
  }
};
export default dlog;
