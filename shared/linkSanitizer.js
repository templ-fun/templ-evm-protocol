const DEFAULT_ALLOWED_SCHEMES = ['https', 'http', 'tg'];

function isSafeScheme(value, allowedSchemes = DEFAULT_ALLOWED_SCHEMES) {
  if (!value) return false;
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(value);
  if (!schemeMatch) return false;
  const scheme = schemeMatch[1].toLowerCase();
  return allowedSchemes.some((allowed) => allowed.toLowerCase() === scheme);
}

/**
 * Sanitizes a link candidate by ensuring it uses an allowed protocol.
 * Returns the trimmed text and a href if it is link-safe, otherwise only text.
 *
 * @param {string | null | undefined} value
 * @param {{ allowedSchemes?: string[] }} [options]
 * @returns {{ href: string | null, text: string, isSafe: boolean }}
 */
export function sanitizeLink(value, { allowedSchemes = DEFAULT_ALLOWED_SCHEMES } = {}) {
  const text = String(value ?? '').trim();
  if (!text) {
    return { href: null, text: '', isSafe: false };
  }

  if (isSafeScheme(text, allowedSchemes) && !/[\s\u0000-\u001F\u007F]/.test(text)) {
    return { href: text, text, isSafe: true };
  }

  return { href: null, text, isSafe: false };
}

/**
 * Reduces an arbitrary record of link candidates down to only safe hrefs.
 *
 * @template T extends Record<string, any>
 * @param {T | null | undefined} value
 * @param {{ allowedSchemes?: string[] }} [options]
 * @returns {{ [K in keyof T]?: string }}
 */
export function sanitizeLinkMap(value, { allowedSchemes = DEFAULT_ALLOWED_SCHEMES } = {}) {
  if (!value || typeof value !== 'object') {
    return {};
  }

  /** @type {Record<string, string>} */
  const safe = {};
  for (const [key, candidate] of Object.entries(value)) {
    if (typeof candidate !== 'string') {
      continue;
    }
    const sanitized = sanitizeLink(candidate, { allowedSchemes });
    if (sanitized.href) {
      safe[key] = sanitized.href;
    }
  }

  return safe;
}
