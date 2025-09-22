import { useCallback, useEffect, useState } from 'react';

export function useAppLocation() {
  const [path, setPath] = useState(() => (typeof window !== 'undefined' ? window.location.pathname || '/' : '/'));
  const [query, setQuery] = useState(() => (
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search)
      : new URLSearchParams()
  ));
  useEffect(() => {
    const onPop = () => {
      if (typeof window === 'undefined') return;
      setPath(window.location.pathname || '/');
      setQuery(new URLSearchParams(window.location.search));
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((to) => {
    try {
      if (typeof window === 'undefined') return;
      const url = new URL(to, window.location.origin);
      window.history.pushState({}, '', url.toString());
      setPath(url.pathname);
      setQuery(url.searchParams);
    } catch {
      if (typeof window !== 'undefined') {
        window.location.assign(to);
      }
    }
  }, []);

  return { path, query, navigate };
}
