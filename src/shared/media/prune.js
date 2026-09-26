// After the startup preload the page tells the service worker which media URLs
// (with their per-file versions) the current build uses, so stale copies of
// corrected files and media of retired questions leave the offline cache.
import { allMediaUrls } from './startup-images.js';

export function pruneStaleMedia(urls = allMediaUrls) {
  try {
    const registration = typeof navigator !== 'undefined' && navigator.serviceWorker?.ready;
    if (!registration) return Promise.resolve(false);
    return registration.then((reg) => {
      const worker = reg?.active;
      if (!worker) return false;
      worker.postMessage({ type: 'prune-media', urls });
      return true;
    }).catch(() => false);
  } catch { return Promise.resolve(false); }
}
