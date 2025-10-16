// @ts-check

/**
 * Determine whether templ debug logging should be enabled.
 * Looks at both Node (`process.env`) and Vite (`import.meta.env`) flags.
 * @returns {boolean}
 */
export function isTemplDebugEnabled() {
  try {
    if (globalThis?.process?.env?.DEBUG_TEMPL === '1') return true;
  } catch {}
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('templ:xmtpDebug') === '1') {
      return true;
    }
  } catch {}
  if (isTemplE2EDebug()) return true;
  try {
    // @ts-ignore - Vite injects env on import.meta at build time
    const env = import.meta?.env;
    if (env?.VITE_TEMPL_DEBUG === '1') return true;
  } catch {}
  return false;
}

/**
 * Determine if we are running in e2e/fast mode.
 * @returns {boolean}
 */
export function isTemplE2EDebug() {
  try {
    if (globalThis?.process?.env?.VITE_E2E_DEBUG === '1') return true;
  } catch {}
  try {
    // @ts-ignore - Vite injects env on import.meta at build time
    const env = import.meta?.env;
    if (env?.VITE_E2E_DEBUG === '1') return true;
  } catch {}
  return false;
}

/**
 * Resolve whether the current runtime is an automated test env.
 * @returns {boolean}
 */
export function isTemplTestEnv() {
  try {
    if (globalThis?.process?.env?.NODE_ENV === 'test') return true;
  } catch {}
  return isTemplE2EDebug();
}

/**
 * Read arbitrary templ env flags from both Node and Vite.
 * Node variables take precedence.
 * @param {string} key
 * @param {string} [fallback]
 * @returns {string}
 */
export function readTemplEnv(key, fallback = '') {
  try {
    const value = globalThis?.process?.env?.[key];
    if (typeof value === 'string') return value;
  } catch {}
  try {
    // @ts-ignore - Vite injects env on import.meta at build time
    const env = import.meta?.env;
    if (env && Object.prototype.hasOwnProperty.call(env, key)) {
      const value = env[key];
      if (typeof value === 'string') return value;
    }
  } catch {}
  return fallback;
}
