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
