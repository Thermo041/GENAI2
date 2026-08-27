import { useCallback, useEffect, useRef, useState } from 'react';
import { indexEventsUrl } from '../services/api.js';
import { repoApi } from '../services/endpoints.js';

const ACTIVE_STATUSES = new Set(['queued', 'indexing']);

/**
 * Live indexing progress. Prefers Server-Sent Events and falls back to polling
 * when EventSource fails (proxies, ad blockers, Render cold starts). Counters
 * come straight from the IndexJob document — nothing is simulated.
 */
export function useIndexProgress(owner, repo, { enabled = true, onComplete } = {}) {
  const [status, setStatus] = useState(null);
  const [job, setJob] = useState(null);
  const [streaming, setStreaming] = useState(false);
  const sourceRef = useRef(null);
  const pollRef = useRef(null);
  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;

  const stop = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
    setStreaming(false);
  }, []);

  const pollOnce = useCallback(async () => {
    if (!owner || !repo) return null;
    try {
      const data = await repoApi.indexStatus(owner, repo);
      setStatus(data);
      setJob(data.job || null);
      return data;
    } catch {
      return null;
    }
  }, [owner, repo]);

  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      const data = await pollOnce();
      const jobStatus = data?.job?.status;
      if (data && !ACTIVE_STATUSES.has(data.status) && jobStatus !== 'running' && jobStatus !== 'queued') {
        stop();
        completeRef.current?.(data);
      }
    }, 2500);
  }, [pollOnce, stop]);

  /** Called after POST /index — opens the event stream for this run. */
  const watch = useCallback(() => {
    if (!owner || !repo) return;
    stop();
    try {
      const source = new EventSource(indexEventsUrl(owner, repo), { withCredentials: true });
      sourceRef.current = source;
      setStreaming(true);

      source.addEventListener('progress', (event) => {
        try {
          const payload = JSON.parse(event.data);
          setJob(payload);
          setStatus((prev) => ({ ...(prev || {}), status: payload?.status === 'completed' ? 'indexed' : 'indexing', job: payload }));
        } catch {
          // ignore malformed frame
        }
      });

      source.addEventListener('done', async (event) => {
        try {
          const payload = JSON.parse(event.data);
          setJob(payload.job || null);
        } catch {
          // ignore
        }
        stop();
        const fresh = await pollOnce();
        completeRef.current?.(fresh);
      });

      source.onerror = () => {
        stop();
        startPolling();
      };
    } catch {
      startPolling();
    }
  }, [owner, repo, stop, startPolling, pollOnce]);

  // Pick up an index that is already running when the page loads.
  useEffect(() => {
    if (!enabled || !owner || !repo) return undefined;
    let cancelled = false;
    (async () => {
      const data = await pollOnce();
      if (cancelled) return;
      const jobStatus = data?.job?.status;
      if (data && (ACTIVE_STATUSES.has(data.status) || jobStatus === 'running' || jobStatus === 'queued')) watch();
    })();
    return () => {
      cancelled = true;
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, repo, enabled]);

  return { status, job, streaming, watch, stop, refresh: pollOnce, isActive: Boolean(job && ['queued', 'running'].includes(job.status)) };
}
