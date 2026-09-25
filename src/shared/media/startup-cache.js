// Use the worker's media cache directly: the first visit may not have a
// controlling service worker yet, but its images can still be saved now.
const MEDIA_CACHE = 'maydan-media-v1';
const DEFAULT_TIMEOUT = 20000;

function abortedError() {
  const error = new Error('Image loading stopped');
  error.name = 'AbortError';
  return error;
}

// The deadline covers the body and storage, not just response headers. The
// explicit race also settles when a browser operation fails to honour abort.
function withinDeadline(operation, { signal, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    let settled = false;
    let timer;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      callback(value);
    };
    const abort = () => {
      controller.abort();
      finish(reject, abortedError());
    };
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(abort, timeoutMs);
    Promise.resolve().then(() => {
      checkSignal(controller.signal);
      return operation(controller.signal);
    }).then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error),
    );
  });
}

function imageResponse(response) {
  return response?.status === 200
    && /^image\//i.test(response.headers?.get('content-type') || '');
}

function checkSignal(signal) {
  if (signal.aborted) throw abortedError();
}

/**
 * Download complete image bodies with bounded memory/network use. `ok` counts
 * usable images; `persistent` is false if any could only be warmed over the
 * network because storage was unavailable. Offline readiness requires both
 * persistent === true and failed === 0. Version/query strings stay in cache keys.
 */
export async function cacheStartupImages(urls, {
  onProgress, signal, concurrency = 6, timeoutMs = DEFAULT_TIMEOUT,
} = {}) {
  const unique = [...new Set(urls)];
  const total = unique.length;
  const duration = Number(timeoutMs);
  const deadline = Number.isFinite(duration) && duration > 0 ? duration : DEFAULT_TIMEOUT;
  const workers = Math.min(total, Math.max(1, Math.min(6, Math.floor(Number(concurrency) || 6))));
  let ok = 0;
  let done = 0;
  let index = 0;
  let persistent = true;
  let cache;
  const progress = () => onProgress?.({ done, total, ok, failed: done - ok });
  progress();

  try {
    if (!globalThis.caches?.open) throw new Error('Image storage unavailable');
    cache = await withinDeadline(() => globalThis.caches.open(MEDIA_CACHE), { signal, timeoutMs: deadline });
  } catch {
    persistent = false;
  }

  async function load(url, requestSignal) {
    if (cache) {
      let hit;
      try {
        hit = await cache.match(url);
      } catch {
        persistent = false;
      }
      checkSignal(requestSignal);
      if (hit) {
        try {
          if (imageResponse(hit) && (await hit.blob()).size > 0) return;
        } catch {
          // Discard an unreadable cached body and repair it from the network.
        }
        checkSignal(requestSignal);
        try { await cache.delete(url); } catch { persistent = false; }
        checkSignal(requestSignal);
      }
    }

    const response = await fetch(url, { signal: requestSignal, priority: 'low' });
    if (!imageResponse(response)) {
      response?.body?.cancel().catch(() => {});
      throw new Error('Image unavailable');
    }
    const body = await response.blob();
    checkSignal(requestSignal);
    if (!body.size) throw new Error('Empty image');
    if (cache) {
      // The body is already decoded by fetch; save exactly those bytes without
      // retaining an HTTP compression header from the network response.
      const headers = new Headers(response.headers);
      headers.delete('content-encoding');
      headers.set('content-length', String(body.size));
      try { await cache.put(url, new Response(body, { status: 200, headers })); }
      catch { persistent = false; }
      checkSignal(requestSignal);
    }
  }

  await Promise.all(Array.from({ length: workers }, async () => {
    while (index < total && !signal?.aborted) {
      const url = unique[index++];
      try {
        await withinDeadline((requestSignal) => load(url, requestSignal), { signal, timeoutMs: deadline });
        ok += 1;
      } catch {
        // A bad image or a dropped connection must not block all other images.
      }
      done += 1;
      progress();
    }
  }));

  return {
    total, ok, failed: total - ok, persistent: persistent && !signal?.aborted,
    ...(signal?.aborted ? { aborted: true } : {}),
  };
}
