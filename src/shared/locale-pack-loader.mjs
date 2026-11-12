const failure = code => Object.assign(new Error(code), { code });

// Runtime for content-hashed public language assets. Nothing here imports the
// private drawing bank. A failed request never populates the shared registry.
export function createLocalePackLoader(manifest, registry, { fetchImpl = (...args) => fetch(...args), timeoutMs = 15000 } = {}) {
  const pending = new Map();
  return async function load(id, version) {
    const entry = Object.hasOwn(manifest, id) ? manifest[id] : null;
    if (!entry) throw failure('CONTENT_UNAVAILABLE');
    if (version !== undefined && version !== entry.contentVersion) throw failure('CONTENT_VERSION');
    if (Object.hasOwn(registry, id)) return registry[id];
    if (pending.has(id)) return pending.get(id);
    const task = (async () => {
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(entry.url, { signal: controller.signal, cache: 'force-cache' });
        if (!response.ok) throw failure('CONTENT_UNAVAILABLE');
        const pack = await response.json();
        if (pack?.schemaVersion !== 1 || pack.kind !== entry.kind || pack.id !== id || pack.contentLocale !== 'en' || pack.contentVersion !== entry.contentVersion) throw failure('CONTENT_VERSION');
        if (!pack.data || typeof pack.data !== 'object' || Array.isArray(pack.data) !== entry.array) throw failure('CONTENT_UNAVAILABLE');
        registry[id] = pack.data;
        return registry[id];
      } catch (error) { throw error?.code ? error : failure('CONTENT_UNAVAILABLE'); }
      finally { clearTimeout(timer); }
    })();
    pending.set(id, task);
    try { return await task; } finally { if (pending.get(id) === task) pending.delete(id); }
  };
}
