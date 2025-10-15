import { useCallback, useState } from 'react';

export function useStatusLog() {
  const [status, setStatus] = useState([]);
  const [toast, setToast] = useState('');

  const pushStatus = useCallback((msg) => {
    const text = String(msg);
    setStatus((s) => [...s, text]);
    if (typeof window === 'undefined') return;
    try {
      setToast(text);
      const anyWindow = /** @type {any} */ (window);
      if (typeof anyWindow.clearTimeout === 'function') {
        anyWindow.clearTimeout(anyWindow.__templToastT);
      }
      if (typeof anyWindow.setTimeout === 'function') {
        anyWindow.__templToastT = anyWindow.setTimeout(() => setToast(''), 1800);
      }
    } catch {}
  }, []);

  const resetStatus = useCallback(() => setStatus([]), []);

  return { status, toast, pushStatus, resetStatus };
}
