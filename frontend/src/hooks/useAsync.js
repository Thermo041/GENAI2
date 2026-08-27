import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Small stale-while-revalidate cache. Keyed results are kept in memory for the
 * session, so navigating back to a page paints instantly and only refreshes in
 * the background — no skeleton flash for data we already have.
 */
const cache = new Map();

export function readCache(key) {
  return key ? cache.get(key) : undefined;
}

export function writeCache(key, data) {
  if (key) cache.set(key, { data, at: Date.now() });
}

export function invalidateCache(prefix) {
  if (!prefix) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) if (key.startsWith(prefix)) cache.delete(key);
}

/**
 * Runs an async function and exposes { data, error, loading, revalidating,
 * refresh, setData }. Pass `cacheKey` to get instant paints on repeat visits.
 */
export function useAsync(fn, deps = [], { immediate = true, cacheKey, onSuccess, onError } = {}) {
  const cached = readCache(cacheKey);
  const [data, setData] = useState(cached?.data ?? null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(immediate && !cached);
  const [revalidating, setRevalidating] = useState(false);
  const mounted = useRef(true);
  const callback = useRef(fn);
  callback.current = fn;
  const keyRef = useRef(cacheKey);
  keyRef.current = cacheKey;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(
    async (...args) => {
      const hasData = readCache(keyRef.current) !== undefined || data !== null;
      if (hasData) setRevalidating(true);
      else setLoading(true);
      setError(null);
      try {
        const result = await callback.current(...args);
        if (mounted.current) setData(result);
        writeCache(keyRef.current, result);
        onSuccess?.(result);
        return result;
      } catch (err) {
        if (mounted.current) setError(err);
        onError?.(err);
        return null;
      } finally {
        if (mounted.current) {
          setLoading(false);
          setRevalidating(false);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    // Paint whatever is cached for the new key, then revalidate.
    const entry = readCache(cacheKey);
    if (entry !== undefined) {
      setData(entry.data);
      setLoading(false);
    } else if (!immediate) {
      setLoading(false);
    }
    if (immediate) run();
    // `immediate` is in the list on purpose: callers gate fetches on state that
    // resolves after mount (for example "is this repository indexed?").
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, immediate, cacheKey]);

  return { data, error, loading, revalidating, refresh: run, setData, setError };
}

/** Tracks an in-flight mutation with an error slot the UI can render. */
export function useMutation(fn) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const mutate = useCallback(
    async (...args) => {
      setLoading(true);
      setError(null);
      try {
        return await fn(...args);
      } catch (err) {
        setError(err);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [fn],
  );

  return { mutate, loading, error, reset: () => setError(null) };
}

export function useDebouncedValue(value, delay = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
