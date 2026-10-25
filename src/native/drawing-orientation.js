import { useCallback, useEffect, useRef, useState } from 'react';
import { callNative, isNativeShell } from '../shared/account/native.js';

const owner = { current: null, counter: 0 };
const landscape = host => Number(host?.innerWidth) > Number(host?.innerHeight);

/** Orientation is a best-effort presentation request, never permission to draw. */
export function createDrawingOrientationSession({ host = typeof window === 'undefined' ? null : window,
  native = isNativeShell(), nativeCall = callNative, onStatus = () => {}, ownership = owner } = {}) {
  let live = false, token = null, request = 0;
  const status = () => onStatus(live ? landscape(host) ? 'landscape' : 'rotate' : 'idle');
  const releaseToken = current => {
    if (!current) return;
    if (native) {
      try { void Promise.resolve(nativeCall('drawingOrientation', { game: 'ersomha', active: false, lease: current }, { timeout: 2000 })).catch(() => {}); }
      catch { /* teardown must still remove listeners if a bridge disappears */ }
    }
    else if (ownership.current === current) { try { host?.screen?.orientation?.unlock?.(); } catch { /* browser-owned preference */ } }
    if (ownership.current === current) ownership.current = null;
  };
  const requestLandscape = async () => {
    if (!live || !host || host.document?.hidden) return false;
    const generation = ++request;
    token = `ers-${Date.now().toString(36)}-${(++ownership.counter).toString(36)}`;
    const current = token;
    ownership.current = current;
    // Native token replacement is atomic; a later old cleanup is harmless.
    onStatus(landscape(host) ? 'landscape' : 'requesting');
    try {
      if (native) await nativeCall('drawingOrientation', { game: 'ersomha', active: true, lease: current }, { timeout: 2000 });
      else {
        const orientation = host.screen?.orientation;
        if (typeof orientation?.lock !== 'function') { status(); return false; }
        await orientation.lock('landscape');
      }
      if (!live || generation !== request) {
        // A browser can finish a lock after its component was removed. Unlock
        // only when no newer drawing surface owns the global preference.
        if (!native && ownership.current == null) { try { host.screen?.orientation?.unlock?.(); } catch { /* unavailable */ } }
        return false;
      }
      status(); return true;
    } catch { if (live && generation === request) status(); return false; }
  };
  const hashChange = () => {
    if (!/^#\/room\/[0-9]{6}(?:\?|$)/.test(host?.location?.hash || '')) stop();
  };
  const visibility = () => { if (!host?.document?.hidden && !token) void requestLandscape(); else status(); };
  const stop = () => {
    if (!live) return;
    live = false; request++;
    releaseToken(token); token = null;
    host?.removeEventListener?.('resize', status);
    host?.screen?.orientation?.removeEventListener?.('change', status);
    host?.removeEventListener?.('hashchange', hashChange);
    host?.document?.removeEventListener?.('visibilitychange', visibility);
    onStatus('idle');
  };
  return {
    start() {
      if (live || !host) return;
      live = true;
      host.addEventListener?.('resize', status);
      host.screen?.orientation?.addEventListener?.('change', status);
      host.addEventListener?.('hashchange', hashChange);
      host.document?.addEventListener?.('visibilitychange', visibility);
      void requestLandscape();
    },
    stop,
    requestLandscape,
  };
}

export function useDrawingOrientation(active, { roundKey } = {}) {
  const [status, setStatus] = useState('idle');
  const session = useRef(null);
  useEffect(() => {
    if (!active) { setStatus('idle'); return undefined; }
    const current = createDrawingOrientationSession({ onStatus: setStatus });
    session.current = current; current.start();
    return () => { current.stop(); if (session.current === current) session.current = null; };
  }, [active, roundKey]); // a new round owns a distinct lease
  const requestLandscape = useCallback(() => session.current?.requestLandscape() ?? Promise.resolve(false), []);
  return { status, requestLandscape };
}
