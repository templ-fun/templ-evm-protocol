import { useCallback, useEffect, useState } from 'react';

function normalizePath(pathname) {
  if (!pathname || pathname === '/') {
    return '/create';
  }
  return pathname;
}

export function useAppLocation() {
  const [path, setPath] = useState(() => (
    typeof window !== 'undefined' ? normalizePath(window.location.pathname || '/') : '/create'
  ));
  const [query, setQuery] = useState(() => (
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search)
      : new URLSearchParams()
  ));
  useEffect(() => {
    const onPop = () => {
      if (typeof window === 'undefined') return;
      setPath(normalizePath(window.location.pathname || '/'));
      setQuery(new URLSearchParams(window.location.search));
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((to) => {
    try {
      if (typeof window === 'undefined') return;
      const url = new URL(to, window.location.origin);
      const normalizedPath = normalizePath(url.pathname);
      if (normalizedPath !== url.pathname) {
        url.pathname = normalizedPath;
      }
      window.history.pushState({}, '', url.toString());
      setPath(normalizedPath);
      setQuery(url.searchParams);
    } catch {
      if (typeof window !== 'undefined') {
        window.location.assign(to);
      }
    }
  }, []);

  return { path, query, navigate };
}
