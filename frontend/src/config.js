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
  const protocolBpRaw = readEnv('VITE_TEMPL_FACTORY_PROTOCOL_BP', readEnv('TEMPL_FACTORY_PROTOCOL_BP', ''));
  let protocolBP = undefined;
  if (protocolBpRaw !== '') {
    const parsed = Number(protocolBpRaw);
    if (Number.isFinite(parsed)) {
      protocolBP = parsed;
    }
  }
  return {
    address,
    protocolFeeRecipient: protocolRecipient,
    protocolBP
  };
})();
