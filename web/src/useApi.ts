import { useCallback, useEffect, useState } from 'react';
import { api, NotLoggedIn, toLogin } from './api';

/** Loads JSON from the API; sends the user to /login on a 401. Refreshes every `everyMs`. */
export function useApi<T>(path: string, everyMs?: number) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState(false);
  const load = useCallback(async () => {
    try {
      setData(await api<T>(path));
      setError(false);
    } catch (e) {
      if (e instanceof NotLoggedIn) return toLogin();
      setError(true);
    }
  }, [path]);
  useEffect(() => {
    void load();
    if (!everyMs) return;
    const timer = setInterval(() => void load(), everyMs);
    return () => clearInterval(timer);
  }, [load, everyMs]);
  return { data, error, reload: load };
}
