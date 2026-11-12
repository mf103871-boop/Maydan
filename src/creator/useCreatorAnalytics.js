import { useCallback, useEffect, useRef, useState } from 'react';
import { REFRESH_MS, STALE_MS, validateAnalytics } from './analytics.js';

const ACCESS_ERRORS = new Set(['AUTH_REQUIRED', 'AUTH_EXPIRED', 'SIGNATURE', 'FORBIDDEN', 'CREATOR_FORBIDDEN', 'STALE_ACCOUNT']);
const initial = () => ({ data: null, error: null, loading: false, stale: false, hidden: typeof document !== 'undefined' && document.hidden });

export function useCreatorAnalytics({ enabled, owner, request }) {
  const [state, setState] = useState(() => ({ ...initial(), owner, enabled }));
  const currentRequest = useRef(request);
  currentRequest.current = request;
  const manual = useRef(() => {});
  useEffect(() => {
    let active = true;
    let busy = false;
    let blocked = false;
    let timer;
    let lastData = null;
    const publish = changes => { if (active) setState(previous => ({ ...previous, ...changes })); };
    setState({ ...initial(), owner, enabled });
    const schedule = () => {
      clearTimeout(timer);
      if (active && enabled && !blocked && !document.hidden) timer = setTimeout(load, REFRESH_MS);
    };
    async function load() {
      if (!active || !enabled || blocked || busy || document.hidden) return;
      clearTimeout(timer);
      busy = true;
      publish({ loading: true });
      try {
        const data = validateAnalytics(await currentRequest.current('/api/creator/analytics', { method: 'GET', timeout: 12_000 }));
        if (!active) return;
        lastData = data;
        publish({ data, error: null, stale: Date.now() - Date.parse(data.updatedAt) > STALE_MS });
      } catch (error) {
        if (!active) return;
        const code = typeof error?.code === 'string' ? error.code : 'NETWORK';
        blocked = ACCESS_ERRORS.has(code);
        if (blocked) lastData = null;
        publish({ error: code, stale: !!lastData, ...(blocked ? { data: null } : {}) });
      } finally {
        busy = false;
        publish({ loading: false });
        schedule();
      }
    }
    const visibility = () => {
      clearTimeout(timer);
      publish({ hidden: document.hidden, ...(lastData ? { stale: Date.now() - Date.parse(lastData.updatedAt) > STALE_MS } : {}) });
      if (!document.hidden) load();
    };
    manual.current = load;
    if (enabled) {
      document.addEventListener('visibilitychange', visibility);
      load();
    }
    return () => {
      active = false;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', visibility);
      manual.current = () => {};
    };
  }, [enabled, owner]);
  const refresh = useCallback(() => manual.current(), []);
  // Do not paint the previous account's snapshot even for the render before
  // effect cleanup when a sign-out or identity change occurs.
  const visible = state.owner === owner && state.enabled === enabled ? state : initial();
  return { ...visible, refresh, accessError: ACCESS_ERRORS.has(visible.error) };
}
