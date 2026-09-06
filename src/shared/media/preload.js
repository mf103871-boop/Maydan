// تحميل الوسائط مسبقًا: عند بناء اللوحة نُحضِر ملفات الجولة كلها في الخلفية،
// فلا ينتظر اللاعب التحميل عند فتح السؤال. التحميل محدود التوازي حتى لا يخنق
// الشبكة على الجوال، ويتجاهل الأخطاء لأن غياب ملف لا يجوز أن يوقف اللعب.
import { mediaKind } from './resolve.js';

const DEFAULT_CONCURRENCY = 4;
const loaded = new Set();
const failed = new Set();

export function isLoaded(url) { return loaded.has(url); }
export function hasFailed(url) { return failed.has(url); }

function loadOne(url) {
  const kind = mediaKind(url);
  return new Promise((resolve) => {
    if (loaded.has(url)) { resolve(true); return; }
    if (typeof document === 'undefined') { resolve(false); return; }
    const done = (ok) => {
      (ok ? loaded : failed).add(url);
      resolve(ok);
    };
    if (kind === 'image') {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => done(true);
      img.onerror = () => done(false);
      img.src = url;
      return;
    }
    // الصوت والفيديو: يكفي جلب البايتات إلى المخزن، فالعنصر سيقرؤها من هناك.
    fetch(url, { mode: 'cors', credentials: 'omit' })
      .then((response) => done(!!response && response.ok))
      .catch(() => done(false));
  });
}

// يعيد { ok, failed } ويستدعي onProgress بعد كل ملف.
export async function preloadMedia(urls, { concurrency = DEFAULT_CONCURRENCY, onProgress, signal } = {}) {
  const queue = [...new Set(urls)].filter((url) => !loaded.has(url));
  let done = 0;
  let ok = 0;
  const total = queue.length;
  if (!total) return { total: 0, ok: 0, failed: 0 };

  const workers = Array.from({ length: Math.min(concurrency, total) }, async () => {
    for (;;) {
      if (signal && signal.aborted) return;
      const url = queue.shift();
      if (!url) return;
      const success = await loadOne(url);
      done += 1;
      if (success) ok += 1;
      if (onProgress) onProgress({ done, total, ok, url, success });
    }
  });
  await Promise.all(workers);
  return { total, ok, failed: total - ok };
}

// يطلب من العامل الخدمي تخزين ملفات الحزمة كي تعمل لاحقًا دون إنترنت.
export async function cacheForOffline(urls, { onProgress } = {}) {
  if (typeof navigator === 'undefined' || !navigator.serviceWorker || !navigator.serviceWorker.controller) {
    // بلا عامل خدمي يبقى التحميل المسبق مفيدًا: مخزن المتصفح نفسه يحتفظ بالملفات.
    return preloadMedia(urls, { onProgress });
  }
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve({ total: urls.length, ok: 0, failed: urls.length, timedOut: true }), 120000);
    channel.port1.onmessage = (event) => {
      const data = event.data || {};
      if (data.type === 'progress' && onProgress) onProgress(data);
      if (data.type === 'done') { clearTimeout(timer); resolve(data); }
    };
    navigator.serviceWorker.controller.postMessage({ type: 'cache-media', urls }, [channel.port2]);
  });
}

export function resetMediaState() { loaded.clear(); failed.clear(); }
