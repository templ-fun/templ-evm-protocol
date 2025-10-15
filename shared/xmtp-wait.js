// @ts-check

/**
 * Generic async polling utility.
 * @param {object} opts
 * @param {() => Promise<any>} opts.check Async function returning truthy value when condition met
 * @param {number} [opts.tries=60] Number of attempts
 * @param {number} [opts.delayMs=1000] Delay between attempts in milliseconds
 * @param {(err:any)=>void} [opts.onError] Optional error handler per attempt
 * @returns {Promise<any|null>} First truthy result or null if none
 */
export async function waitFor({ check, tries = 60, delayMs = 1000, onError }) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await check();
      if (res) return res;
    } catch (err) {
      try { onError?.(err); } catch {}
    }
    if (i < tries - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
}
