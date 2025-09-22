// @ts-check

/**
 * Send a JSON request with standard headers.
 * @param {string} url
 * @param {object} payload
 * @param {RequestInit} [options]
 * @returns {Promise<Response>}
 */
export function postJson(url, payload, options = {}) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    body: JSON.stringify(payload),
    ...options,
  });
}
