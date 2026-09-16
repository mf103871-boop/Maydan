// تخزين محلي بنطاق: كل لعبة تحصل على مخزن مفاتيحه تحت `maydan:<gameId>:`
// فلا تتداخل بيانات لعبة مع أخرى، ويمكن مسحها بمفردها.
export const PLATFORM_PREFIX = 'maydan:';

function resolveBackend(backend) {
  if (backend) return backend;
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch (error) {
    // Some browsers throw on mere access in private mode.
  }
  return null;
}

export function createStorage(scope, backend) {
  const prefix = scope.startsWith(PLATFORM_PREFIX) ? scope : `${PLATFORM_PREFIX}${scope}:`;
  const store = resolveBackend(backend);
  const memory = new Map();
  const fullKey = (key) => `${prefix}${key}`;

  return {
    prefix,
    // Callers that promise recovery after reload must distinguish memory fallback.
    persistent: Boolean(store),
    get(key, fallback = null) {
      try {
        const raw = store ? store.getItem(fullKey(key)) : memory.get(fullKey(key));
        if (raw === null || raw === undefined) return fallback;
        return JSON.parse(raw);
      } catch (error) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        const raw = JSON.stringify(value);
        if (store) store.setItem(fullKey(key), raw);
        else memory.set(fullKey(key), raw);
        return true;
      } catch (error) {
        return false;
      }
    },
    remove(key) {
      try {
        if (store) store.removeItem(fullKey(key));
        else memory.delete(fullKey(key));
      } catch (error) {
        // ignore
      }
    },
    keys() {
      const found = [];
      try {
        if (store) {
          for (let i = 0; i < store.length; i += 1) {
            const k = store.key(i);
            if (k && k.startsWith(prefix)) found.push(k.slice(prefix.length));
          }
        } else {
          for (const k of memory.keys()) if (k.startsWith(prefix)) found.push(k.slice(prefix.length));
        }
      } catch (error) {
        // ignore
      }
      return found;
    },
    clear() {
      for (const key of this.keys()) this.remove(key);
    },
  };
}

// Removes every key the platform or any game wrote. Used by Settings → مسح البيانات.
// `keep` يحمي بادئات بعينها (الحساب والاشتراك مثلًا) من المسح؛ السلوك بلا خيارات
// كما كان تمامًا. يقبل clearAllPlatformData({ keep }) أو (backend, { keep }).
export function clearAllPlatformData(backend, options = {}) {
  const isOptions = backend && typeof backend === 'object' && typeof backend.getItem !== 'function';
  const { keep = [] } = isOptions ? backend : (options || {});
  const store = resolveBackend(isOptions ? null : backend);
  if (!store) return 0;
  const spared = Array.isArray(keep) ? keep.filter((prefix) => typeof prefix === 'string' && prefix) : [];
  const doomed = [];
  try {
    for (let i = 0; i < store.length; i += 1) {
      const k = store.key(i);
      if (!k || !(k.startsWith(PLATFORM_PREFIX) || k.startsWith('maydan-'))) continue;
      if (spared.some((prefix) => k.startsWith(prefix))) continue;
      doomed.push(k);
    }
    doomed.forEach((k) => store.removeItem(k));
  } catch (error) {
    // ignore
  }
  return doomed.length;
}
