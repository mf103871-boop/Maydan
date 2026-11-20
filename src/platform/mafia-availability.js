import { useCallback, useEffect, useRef, useState } from 'react';
import { resolveAccountServer } from '../shared/account/api.js';
import { ROOM_CAPABILITIES, validateServerUrl } from '../online/shared.js';

const CACHE_MS = 30_000;
const TIMEOUT_MS = 8_000;
const cache = new Map();
const loading = Object.freeze({ status: 'loading', enabled: false });
const failed = Object.freeze({ status: 'error', enabled: false });

export function mafiaAvailability(value) {
  if (!value || typeof value.enabled !== 'boolean' || value.capabilities?.mafia !== ROOM_CAPABILITIES.mafia) return failed;
  return Object.freeze({ status: value.enabled ? 'enabled' : 'disabled', enabled: value.enabled });
}

function current(origin) {
  const saved = cache.get(origin);
  return saved && saved.until > Date.now() ? saved : null;
}

// The origin comes from the same build-owned account/room configuration. A
// result belongs only to that origin, stays in memory, and expires quickly.
export function useMafiaAvailability(server = resolveAccountServer()) {
  const origin = validateServerUrl(server);
  const [attempt, setAttempt] = useState(0);
  const [observed, setObserved] = useState(() => ({ origin, value: current(origin)?.value || (origin ? loading : failed) }));
  const request = useRef(0);
  const retry = useCallback(() => { cache.delete(origin); setAttempt(value => value + 1); }, [origin]);
  useEffect(() => {
    const id = ++request.current;
    const controller = new AbortController();
    let active = true, timeout, expiry;
    const isCurrent = () => active && request.current === id;
    const publish = (value, until) => {
      if (!isCurrent()) return;
      setObserved({ origin, value });
      if (until) expiry = setTimeout(() => { if (isCurrent()) setAttempt(value => value + 1); }, Math.max(1, until - Date.now()));
    };
    const saved = current(origin);
    if (!origin) publish(failed);
    else if (saved) publish(saved.value, saved.until);
    else {
      publish(loading);
      timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
      fetch(`${origin}/api/mafia/capabilities`, { signal: controller.signal, credentials: 'omit', cache: 'no-store', redirect: 'error' })
        .then(response => { if (!response.ok) throw new Error('Unavailable capability'); return response.json(); })
        .then(body => {
          if (!isCurrent() || controller.signal.aborted) return;
          const value = mafiaAvailability(body);
          if (value.status === 'error') { publish(failed); return; }
          const until = Date.now() + CACHE_MS;
          cache.set(origin, { value, until }); publish(value, until);
        }).catch(() => { if (isCurrent()) publish(failed); })
        .finally(() => clearTimeout(timeout));
    }
    return () => { active = false; controller.abort(); clearTimeout(timeout); clearTimeout(expiry); };
  }, [origin, attempt]);
  // Never display an old origin's positive result during the effect transition.
  const value = observed.origin === origin ? observed.value : current(origin)?.value || (origin ? loading : failed);
  return { ...value, retry };
}
