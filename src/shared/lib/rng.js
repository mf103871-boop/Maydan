// مولّد أرقام عشوائية قابل للبذر (mulberry32) — للاختبارات الحتمية ولإعادة إنتاج جولة.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSeed() {
  try {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      const buf = new Uint32Array(1);
      crypto.getRandomValues(buf);
      return buf[0];
    }
  } catch (error) {
    // fall through
  }
  return Math.floor(Math.random() * 4294967296);
}

export function randInt(random, min, max) {
  return min + Math.floor(random() * (max - min + 1));
}

export function pick(random, items) {
  if (!items.length) return undefined;
  return items[Math.floor(random() * items.length)];
}
