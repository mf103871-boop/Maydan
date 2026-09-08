// Original, category-local visual-search boards. No external facts or media.
// This pure helper reproduces the checked-in data; it never writes files.
export const TARGET = '🦆';
export const SEED_VERSION = 'hidden-duck-v1';
export const HIDDEN_TIERS = [
  { p: 200, side: 4, nearFraction: 0.20 },
  { p: 400, side: 5, nearFraction: 0.40 },
  { p: 600, side: 6, nearFraction: 0.60 },
  { p: 800, side: 7, nearFraction: 0.80 },
  { p: 1000, side: 8, nearFraction: 1.00 },
];
export const HIDDEN_THEMES = [
  {
    topic: 'المزرعة وطيورها',
    distinct: ['🐄', '🐖', '🐑', '🐐', '🐎'],
    similar: ['🐔', '🐓', '🐤', '🐥', '🐣', '🦃'],
  },
  {
    topic: 'كائنات مائية',
    distinct: ['🐟', '🐠', '🐸', '🐢', '🦀'],
    similar: ['🦢', '🦩', '🐧'],
  },
  {
    topic: 'الغابة وطيورها',
    distinct: ['🐻', '🦊', '🦝', '🐿️', '🐇'],
    similar: ['🦜', '🦚', '🐦', '🕊️', '🦉', '🦅'],
  },
  {
    topic: 'زواحف وبرمائيات',
    distinct: ['🦕', '🦖'],
    similar: ['🐢', '🐸', '🐍', '🦎', '🐊'],
  },
  {
    topic: 'أوراق وأشجار',
    distinct: ['🌵', '🌴', '🌲', '🌳'],
    similar: ['🍃', '🌿', '☘️', '🍀', '🌱', '🎍', '🎋'],
  },
  {
    topic: 'خضار وفواكه',
    distinct: ['🍎', '🍊', '🍋', '🍅', '🥕', '🌽'],
    similar: ['🍐', '🍏', '🥑', '🥒', '🥬', '🥦', '🥝'],
  },
];

function seedHash(text) {
  let hash = 2166136261;
  for (const char of text) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function randomFrom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(values, random) {
  const out = [...values];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function targetQuadrant(row, column, side) {
  const split = Math.ceil(side / 2);
  return (row >= split ? 2 : 0) + (column >= split ? 1 : 0);
}

function targetsForTier({ p, side }) {
  const random = randomFrom(seedHash(`${SEED_VERSION}:targets:${p}`));
  const cells = Array.from({ length: side * side }, (_, index) => index);
  const corners = [0, side - 1, side * (side - 1), side * side - 1];
  const quadrants = corners.map((corner, quadrant) => [corner, ...shuffle(cells.filter((index) =>
    index !== corner && targetQuadrant(Math.floor(index / side), index % side, side) === quadrant), random)]);
  const used = [0, 0, 0, 0];
  return Array.from({ length: 48 }, (_, i) => {
    const themeIndex = i % HIDDEN_THEMES.length;
    const variant = Math.floor(i / HIDDEN_THEMES.length);
    const quadrant = (themeIndex + variant) % 4;
    return quadrants[quadrant][used[quadrant]++ % quadrants[quadrant].length];
  });
}

function patternScore(row, column, side, variant, random) {
  const jitter = random();
  switch (variant) {
    case 1: return (row % 2) * 2 + jitter;
    case 2: return (column % 2) * 2 + jitter;
    case 3: return ((row + column) % 2) * 2 + jitter;
    case 4: return ((row - column + side) % side) + jitter;
    case 5: return ((Math.floor(row / 2) + Math.floor(column / 2)) % 2) * 2 + jitter;
    case 6: return Math.min(row, column, side - 1 - row, side - 1 - column) + jitter;
    case 7: return Math.abs(row - (side - 1) / 2) + Math.abs(column - (side - 1) / 2) + jitter;
    default: return jitter;
  }
}

function paletteSubset(values, variant, tierIndex) {
  const start = variant % values.length;
  const count = Math.min(values.length, 2 + tierIndex + variant % 2);
  return Array.from({ length: count }, (_, i) => values[(start + i) % values.length]);
}

function createBoard(tier, tierIndex, theme, variant, qid, targetIndex) {
  const random = randomFrom(seedHash(`${SEED_VERSION}:${qid}`));
  const { side, nearFraction } = tier;
  const length = side * side;
  const ranked = Array.from({ length }, (_, index) => ({
    index,
    score: patternScore(Math.floor(index / side), index % side, side, variant, random),
  })).filter(({ index }) => index !== targetIndex).sort((a, b) => a.score - b.score);
  const nearCount = Math.round((length - 1) * nearFraction);
  const nearPositions = ranked.slice(0, nearCount).map(({ index }) => index);
  const distinctPositions = ranked.slice(nearCount).map(({ index }) => index);
  const cells = Array(length);
  for (const [positions, palette] of [
    [nearPositions, paletteSubset(theme.similar, variant, tierIndex)],
    [distinctPositions, paletteSubset(theme.distinct, variant, tierIndex)],
  ]) {
    const symbols = shuffle(positions.map((_, i) => palette[i % palette.length]), random);
    positions.forEach((index, i) => { cells[index] = symbols[i]; });
  }
  cells[targetIndex] = TARGET;
  return Array.from({ length: side }, (_, row) => cells.slice(row * side, (row + 1) * side));
}

export function buildHiddenPack() {
  const qs = HIDDEN_TIERS.flatMap((tier, tierIndex) => {
    const targetPositions = targetsForTier(tier);
    return Array.from({ length: 48 }, (_, i) => {
      const theme = HIDDEN_THEMES[i % HIDDEN_THEMES.length];
      const variant = Math.floor(i / HIDDEN_THEMES.length);
      const qid = `hidden-${tier.p}-${String(i + 1).padStart(3, '0')}`;
      const row = '٠١٢٣٤٥٦٧٨٩'[Math.floor(targetPositions[i] / tier.side) + 1];
      const column = '٠١٢٣٤٥٦٧٨٩'[targetPositions[i] % tier.side + 1];
      return {
        p: tier.p,
        q: '',
        a: `الصف ${row}، العمود ${column} من اليسار`,
        qid,
        type: 'grid',
        topic: theme.topic,
        verified: true,
        target: TARGET,
        grid: createBoard(tier, tierIndex, theme, variant, qid, targetPositions[i]),
      };
    });
  });
  return { id: 'hidden', name: 'البطة المخفية', icon: TARGET, qs };
}
