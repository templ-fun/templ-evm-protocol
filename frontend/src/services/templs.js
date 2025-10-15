// @ts-check
import { BACKEND_URL } from '../config.js';
import { allowLocalTemplFallback } from './utils.js';

export async function listTempls(backendUrl = BACKEND_URL) {
  const allowFallback = allowLocalTemplFallback();
  const readLocalRegistry = () => {
    try {
      const key = 'templ:test:deploys';
      const arr = JSON.parse(localStorage.getItem(key) || '[]');
      const last = localStorage.getItem('templ:lastAddress');
      const all = Array.from(new Set([...(arr || []), ...(last ? [last] : [])]));
      return all.map((a) => ({ contract: a, groupId: null, priest: null }));
    } catch {
      return [];
    }
  };

  try {
    const res = await fetch(`${backendUrl}/templs`);
    if (!res.ok) {
      return allowFallback ? readLocalRegistry() : [];
    }
    const data = await res.json().catch(() => null);
    if (!data || !Array.isArray(data.templs)) {
      return allowFallback ? readLocalRegistry() : [];
    }
    const templs = [...data.templs];
    if (allowFallback) {
      const fromLocal = readLocalRegistry();
      const seen = new Set(templs.map((t) => String(t.contract || '').toLowerCase()));
      for (const item of fromLocal) {
        const key = String(item.contract || '').toLowerCase();
        if (key && !seen.has(key)) {
          templs.push(item);
        }
      }
    }
    return templs;
  } catch {
    return allowFallback ? readLocalRegistry() : [];
  }
}
