// أدوات مشتركة للاختبارات: مخزن وهمي وعشوائية حتمية.
import { mulberry32 } from '../src/shared/lib/rng.js';

export function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    key: (i) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
    dump: () => Object.fromEntries(map),
  };
}

export const seeded = (seed = 1) => mulberry32(seed);
