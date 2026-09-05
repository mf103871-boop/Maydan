// سحب عناصر دون تكرار داخل اللعبة الواحدة، مع أولوية للعناصر التي لم تُعرض في جلسات سابقة.
//
//   const draw = createNoRepeat(items, { random, seen: storage.get('seen', {}) });
//   draw.next()      → عنصر جديد (أو null عند النفاد)
//   draw.remaining   → كم بقي
//   draw.seen()      → خريطة المعرّفات المعروضة لحفظها
import { shuffle } from './shuffle.js';

export function createNoRepeat(items, { random = Math.random, seen = {}, idOf = (item) => item.id } = {}) {
  const fresh = items.filter((item) => !seen[idOf(item)]);
  const old = items.filter((item) => seen[idOf(item)]);
  // العناصر غير المعروضة سابقًا أولًا، ثم القديمة — كل مجموعة مخلوطة عشوائيًا.
  const queue = [...shuffle(fresh, random), ...shuffle(old, random)];
  const drawn = new Set();
  const nowSeen = { ...seen };
  let cursor = 0;

  return {
    get remaining() {
      return queue.length - cursor;
    },
    get total() {
      return queue.length;
    },
    next() {
      if (cursor >= queue.length) return null;
      const item = queue[cursor];
      cursor += 1;
      drawn.add(idOf(item));
      nowSeen[idOf(item)] = Date.now();
      return item;
    },
    peek() {
      return cursor < queue.length ? queue[cursor] : null;
    },
    drawn() {
      return [...drawn];
    },
    seen() {
      return { ...nowSeen };
    },
    reset() {
      cursor = 0;
      drawn.clear();
    },
  };
}

// يسحب n عنصرًا فريدًا دفعة واحدة (مثلًا 3 جولات من فبركة).
export function drawUnique(items, count, options = {}) {
  const draw = createNoRepeat(items, options);
  const out = [];
  while (out.length < count) {
    const item = draw.next();
    if (!item) break;
    out.push(item);
  }
  return out;
}

// خريطة «المعروض سابقًا» تنمو بلا حدود؛ نقصّها لآخر limit عنصرًا بحسب الوقت.
export function trimSeen(seen, limit = 2000) {
  const entries = Object.entries(seen || {});
  if (entries.length <= limit) return { ...seen };
  entries.sort((a, b) => Number(b[1]) - Number(a[1]));
  return Object.fromEntries(entries.slice(0, limit));
}
