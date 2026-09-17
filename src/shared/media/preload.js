import { mediaKind } from './resolve.js';

const loaded = new Set();
const failed = new Set();
export function isLoaded(url) { return loaded.has(url); }
export function hasFailed(url) { return failed.has(url); }

// Every load settles, even when a mobile connection disappears without an error.
function loadOne(url, { signal, timeoutMs }) {
  if (loaded.has(url)) return Promise.resolve(true);
  if (signal?.aborted || typeof document === 'undefined') return Promise.resolve(false);
  return new Promise((resolve) => {
    let settled = false;
    let img;
    const controller = new AbortController();
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (img) { img.onload = null; img.onerror = null; if (!ok) img.src = ''; }
      if (ok) { loaded.add(url); failed.delete(url); }
      else if (!signal?.aborted) failed.add(url);
      resolve(ok);
    };
    const abort = () => { controller.abort(); finish(false); };
    const timer = setTimeout(abort, timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    if (mediaKind(url) === 'image') {
      img = new Image();
      img.decoding = 'async';
      img.onload = () => finish(true);
      img.onerror = () => finish(false);
      img.src = url;
    } else {
      fetch(url, { mode: 'cors', credentials: 'omit', signal: controller.signal })
        .then(async (response) => {
          if (!response?.ok || /text\/html/i.test(response.headers?.get('content-type') || '')) return finish(false);
          await response.arrayBuffer(); // Headers alone do not mean the clip downloaded.
          finish(true);
        }).catch(() => finish(false));
    }
  });
}

export async function preloadMedia(urls, { concurrency = 4, onProgress, signal, timeoutMs = 20000 } = {}) {
  const queue = [...new Set(urls)].filter((url) => !loaded.has(url));
  const total = queue.length;
  let done = 0;
  let ok = 0;
  const workers = Math.min(total, Math.max(1, Math.min(6, Math.floor(Number(concurrency) || 4))));
  await Promise.all(Array.from({ length: workers }, async () => {
    while (queue.length && !signal?.aborted) {
      const url = queue.shift();
      const success = await loadOne(url, { signal, timeoutMs });
      done++;
      if (success) ok++;
      if (!signal?.aborted) onProgress?.({ done, total, ok, url, success });
    }
  }));
  return { total, ok, failed: total - ok, ...(signal?.aborted ? { aborted: true } : {}) };
}

export async function cacheForOffline(urls, { onProgress, signal, timeoutMs = 120000 } = {}) {
  const unique = [...new Set(urls)];
  const controller = typeof navigator !== 'undefined' && navigator.serviceWorker?.controller;
  if (!controller) {
    const result = await preloadMedia(unique, { onProgress, signal });
    // HTTP cache warming is not a promise of durable offline availability.
    return { ...result, offlineReady: false, unsupported: true };
  }
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    let settled = false;
    let ok = 0;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      channel.port1.onmessage = null;
      channel.port1.close();
      signal?.removeEventListener('abort', abort);
      resolve(result);
    };
    const abort = () => finish({ total: unique.length, ok, failed: unique.length - ok, offlineReady: false, aborted: true });
    const timer = setTimeout(() => finish({ total: unique.length, ok, failed: unique.length - ok, offlineReady: false, timedOut: true }), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    channel.port1.onmessage = ({ data = {} }) => {
      if (data.type === 'progress') { ok = data.ok || 0; onProgress?.(data); }
      if (data.type === 'done') finish({ ...data, offlineReady: data.failed === 0 });
    };
    try { controller.postMessage({ type: 'cache-media', urls: unique }, [channel.port2]); }
    catch { finish({ total: unique.length, ok: 0, failed: unique.length, offlineReady: false }); }
  });
}

export function resetMediaState() { loaded.clear(); failed.clear(); }
