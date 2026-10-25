// سحب عناصر دون تكرار داخل اللعبة الواحدة، مع أولوية للعناصر التي لم تُعرض في جلسات سابقة.
//
//   const draw = createNoRepeat(items, { random, seen: storage.get('seen', {}) });
//   draw.next()      → عنصر جديد (أو null عند النفاد)
//   draw.remaining   → كم بقي
//   draw.cursor      → موضع السحب (يُحفظ مع جلسة اللعبة)
//   draw.seek(n)     → يتقدّم إلى الموضع n بعد إعادة بناء المصدر بنفس البذرة والعناصر
//   draw.seen()      → خريطة المعرّفات المعروضة لحفظها
import { shuffle } from './shuffle.js';

export function createNoRepeat(items, { random = Math.random, seen = {}, idOf = (item) => item.id } = {}) {
  const fresh = items.filter((item) => !seen[idOf(item)]);
  const old = items.filter((item) => seen[idOf(item)]);
  // العناصر غير المعروضة سابقًا أولًا، ثم القديمة — كل مجموعة مخلوطة عشوائيًا.
  let queue = [...shuffle(fresh, random), ...shuffle(old, random)];
  const drawn = new Set();
  const nowSeen = { ...seen };
  let cursor = 0;
  let cycle = 0;

  return {
    get remaining() {
      return queue.length - cursor;
    },
    get total() {
      return queue.length;
    },
    get cursor() {
      return cursor;
    },
    get cycle() {
      return cycle;
    },
    // استئناف جلسة محفوظة: المصدر يُبنى من جديد بنفس البذرة وخريطة «المعروض سابقًا» فيعطي
    // الطابور نفسه، ثم يُسحب حتى الموضع المحفوظ كي تبقى «المعروض» و«المسحوب» متسقة.
    seek(position, { cycles = 0 } = {}) {
      // Replaying seeded complete cycles restores both the queue and RNG position.
      // Callers validate persisted cycle counts before using this bounded path.
      const targetCycle = Number.isInteger(cycles) && cycles >= 0 && cycles <= 2000 ? cycles : 0;
      while (cycle < targetCycle && queue.length) {
        while (cursor < queue.length) this.next();
        this.reset({ reshuffle: true });
      }
      const target = Math.min(Math.max(0, Math.floor(Number(position) || 0)), queue.length);
      while (cursor < target) this.next();
      return cursor;
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
    reset({ reshuffle = false } = {}) {
      if (reshuffle && queue.length) {
        const previous = queue, last = cursor > 0 ? idOf(previous[cursor - 1]) : null;
        queue = shuffle(previous, random);
        // Never immediately repeat the last visible word when another exists.
        if (queue.length > 1 && idOf(queue[0]) === last) {
          const next = queue.findIndex((item) => idOf(item) !== last);
          if (next > 0) [queue[0], queue[next]] = [queue[next], queue[0]];
        }
        // Fisher–Yates can coincidentally reproduce the old permutation. Swap
        // the tail so the boundary stays safe; with two items both guarantees
        // are impossible, so avoiding the immediate repeat takes precedence.
        if (queue.length > 2 && queue.every((item, index) => idOf(item) === idOf(previous[index]))) {
          const end = queue.length - 1;
          [queue[end - 1], queue[end]] = [queue[end], queue[end - 1]];
        }
        cycle += 1;
      }
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
