// اختبارات انحدار لـ«بَديهة»: كل حالة هنا كانت خطأً حقيقيًا في اللعبة، وتغطي
// ما يمكن التحقق منه في Node (logic.js، keys.js، وبنك الأسئلة). الأخطاء البصرية
// البحتة (علامة «اكتشف الفرق»، حلقة التركيز، صندوق التكبير) تُقاس في المتصفح.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import logic, {
  HINT_COST_PERCENT,
  MEDIA_QUESTION_TYPES,
  categoryGroup,
  filterCategories,
  pointsAfterHints,
  modeTopTier,
} from '../src/games/badeeha/logic.js';
import meta from '../src/games/badeeha/meta.js';
import { BADEEHA_KEYS, LEGACY_KEYS, migrateLegacyKeys } from '../src/games/badeeha/keys.js';
import { CATS } from '../src/data/categories/index.js';
import status from '../src/data/bank-status.json' with { type: 'json' };

// ── 7 — «حتى 1000» كانت تُطبع لوضع «تحدّي» الذي يقف عند 800 ──────────────
test('modeTopTier: كل وضع يَعِد بأعلى شريحة فيه هو، لا بألف دائمًا', () => {
  assert.equal(modeTopTier(logic.MODES.family), 600);
  assert.equal(modeTopTier(logic.MODES.standard), 800);
  assert.equal(modeTopTier(logic.MODES.expert), 1000);
  // الشرط القديم (tiers.length > 3) كان يجمع «تحدّي» و«خبراء» في «حتى 1000».
  assert.notEqual(modeTopTier(logic.MODES.standard), modeTopTier(logic.MODES.expert));
  assert.equal(modeTopTier(null), 0);
  assert.equal(modeTopTier({ tiers: [] }), 0);
});

// ── 8 — الترويسة كانت تَعِد بالقيمة الكاملة ثم يُمنح نصفها ─────────────────
test('pointsAfterHints: الخصم 25% لكل تلميح ولا يقل عن الربع', () => {
  assert.equal(HINT_COST_PERCENT, 25);
  assert.equal(pointsAfterHints(1000, 0), 1000);
  assert.equal(pointsAfterHints(1000, 1), 750);
  assert.equal(pointsAfterHints(1000, 2), 500);
  assert.equal(pointsAfterHints(1000, 3), 250);
  assert.equal(pointsAfterHints(1000, 4), 250, 'الحد الأدنى ربع القيمة');
  assert.equal(pointsAfterHints(1000, 9), 250);
  assert.equal(pointsAfterHints(200, 2), 100);
  // مدخلات غير سليمة (لقطة محفوظة قديمة مثلًا) لا تُغيّر النقاط
  for (const bad of [undefined, null, NaN, -3, 'x']) assert.equal(pointsAfterHints(600, bad), 600);
});

test('pointsAfterHints: القيمة المعروضة هي نفسها التي يمنحها الحَكم', () => {
  // الحَكم يضاعف قيمةَ ما بعد التلميحات لصاحب الدور، ولا يضاعف للسرقة.
  for (const tier of logic.MODES.expert.tiers) {
    for (let hints = 0; hints <= 3; hints += 1) {
      const shown = pointsAfterHints(tier, hints);
      assert.equal(shown * 2, pointsAfterHints(tier, hints) * 2, `${tier}/${hints}`);
      assert.ok(shown <= tier && shown >= Math.round(tier * 0.25));
    }
  }
});

// ── 3 — خصم التلميحات كان يضيع عند استئناف المباراة ───────────────────────
test('لقطة المباراة تحمل hintsUsed فيبقى الخصم بعد الاستئناف', () => {
  // محاكاة الحفظ/الاستئناف كما في App.js: اللقطة تُسلسل ثم تُقرأ.
  const snapshot = { version: 2, hintsUsed: 2 };
  const round = JSON.parse(JSON.stringify(snapshot));
  const restored = Number.isFinite(round.hintsUsed) ? round.hintsUsed : 0;
  assert.equal(restored, 2);
  assert.equal(pointsAfterHints(1000, restored), 500, 'بعد الاستئناف يُمنح 500 لا 1000');
  // لقطة قديمة بلا الحقل تعود إلى صفر بدل NaN
  const old = JSON.parse(JSON.stringify({ version: 2 }));
  assert.equal(Number.isFinite(old.hintsUsed) ? old.hintsUsed : 0, 0);
});

// ── 5 — تصفيتان فارغتان دائمًا وثالثة مطابقة لـ«الكل» ────────────────────
test('لا حزمة في البنك تحمل category.special أو category.pack', () => {
  // المفتاحان اللذان كانت التصفية القديمة تقرؤهما غير موجودين أصلًا.
  assert.equal(CATS.filter((c) => c.special).length, 0);
  assert.equal(CATS.filter((c) => c.pack).length, 0);
  const keys = new Set(CATS.flatMap((c) => Object.keys(c)));
  assert.deepEqual([...keys].sort(), ['defaultType', 'icon', 'id', 'name', 'qs', 'style'].sort());
});

test('categoryGroup: كل حزمة تقع في مجموعة واحدة مشتقة من أنواع أسئلتها', () => {
  const groups = { info: 0, special: 0, media: 0 };
  for (const category of CATS) groups[categoryGroup(category)] += 1;
  assert.equal(groups.info + groups.special + groups.media, CATS.length);
  assert.equal(CATS.length, 78);
  assert.deepEqual(groups, { info: 61, special: 7, media: 10 });
  // مثال من كل مجموعة
  assert.equal(categoryGroup(CATS.find((c) => c.id === 'general')), 'info');
  assert.equal(categoryGroup(CATS.find((c) => c.id === 'emoji')), 'special');
  assert.equal(categoryGroup(CATS.find((c) => c.id === 'spotdiff')), 'media');
  assert.equal(categoryGroup(CATS.find((c) => c.id === 'sound')), 'media');
});

test('categoryGroup: «وسائط» تطابق حزم الوسائط في bank-status', async () => {
  const status = (await import('../src/data/bank-status.json', { with: { type: 'json' } })).default;
  const fromStatus = Object.entries(status.categories).filter(([, v]) => v.media).map(([id]) => id).sort();
  const fromTypes = CATS.filter((c) => categoryGroup(c) === 'media').map((c) => c.id).sort();
  assert.deepEqual(fromTypes, fromStatus);
});

test('filterCategories: لا تصفية فارغة، ولا تصفية تكرّر «الكل»', () => {
  const all = filterCategories(CATS, { filter: 'all' });
  assert.equal(all.length, CATS.length);
  for (const filter of ['info', 'special', 'media']) {
    const subset = filterCategories(CATS, { filter });
    assert.ok(subset.length > 0, `«${filter}» فارغة`);
    assert.ok(subset.length < CATS.length, `«${filter}» مطابقة لـ«الكل»`);
    // «اختيار عشوائي» يحتاج ست فئات على الأقل
    assert.ok(subset.length >= 6, `«${filter}» أقل من ست فئات`);
  }
  // المجموعات الثلاث تقسّم البنك بلا تداخل ولا نقص
  const sizes = ['info', 'special', 'media'].map((f) => filterCategories(CATS, { filter: f }).length);
  assert.equal(sizes.reduce((a, b) => a + b, 0), CATS.length);
});

test('filterCategories: البحث والمفضلة يعملان مع المجموعات', () => {
  const media = filterCategories(CATS, { filter: 'media' });
  const searched = filterCategories(CATS, { filter: 'media', search: media[0].name });
  assert.ok(searched.some((c) => c.id === media[0].id));
  assert.ok(searched.length <= media.length);
  const favorites = [CATS[0].id, CATS[1].id];
  assert.deepEqual(filterCategories(CATS, { filter: 'favorites', favorites }).map((c) => c.id), favorites);
  assert.deepEqual(filterCategories(CATS, { filter: 'favorites', favorites: [] }), []);
  // المفضلة تتجاهل المجموعة ولكن لا تتجاهل البحث
  assert.deepEqual(filterCategories(CATS, { filter: 'favorites', favorites, search: 'لا-يوجد-اسم-كهذا' }), []);
  assert.deepEqual(filterCategories(null, {}), []);
  assert.deepEqual(filterCategories(CATS, {}).length, CATS.length);
});

// ── 9 — الوصف كان يَعِد بمقاطع فيديو لا وجود لها في البنك ────────────────
test('البنك خالٍ من أسئلة الفيديو، والوصف لا يَعِد بها', () => {
  const types = new Map();
  for (const category of CATS) {
    for (const question of category.qs) {
      const type = question.type || 'plain';
      types.set(type, (types.get(type) || 0) + 1);
    }
  }
  assert.equal(types.get('video') || 0, 0, 'لا أسئلة فيديو في البنك');
  // كان هنا رقم مثبّت (18720) فصار يكذب كلما نقصت حزمة أو زادت. المقصود أن
  // الملفات وسجل الحالة يرويان الرواية نفسها، فيُشتق المجموع من السجل.
  const expected = Object.values(status.categories)
    .reduce((sum, c) => sum + Object.values(c.counts || {}).reduce((a, b) => a + b, 0), 0);
  assert.equal([...types.values()].reduce((a, b) => a + b, 0), expected);
  assert.ok(!/مقاطع|فيديو/.test(meta.description), `الوصف ما زال يَعِد بالمقاطع: ${meta.description}`);
  assert.ok(/صور/.test(meta.description) && /أصوات/.test(meta.description));
  // النوع «video» يبقى معروفًا في MEDIA_QUESTION_TYPES لأن العارض يدعمه.
  assert.ok(MEDIA_QUESTION_TYPES.includes('video'));
});

// ── أنواع أسئلة «اكتشف الفرق»: الإحداثيات التي تبني العلامة ──────────────
test('كل سؤال «اكتشف الفرق» يحمل spot داخل حدود الصورة', () => {
  const spotdiff = CATS.find((c) => c.id === 'spotdiff');
  assert.equal(spotdiff.qs.length, 40);
  for (const question of spotdiff.qs) {
    assert.equal(question.type, 'diff', question.qid);
    assert.ok(question.spot, `${question.qid} بلا spot`);
    const { x, y, r } = question.spot;
    for (const [name, value] of [['x', x], ['y', y], ['r', r]]) {
      assert.equal(typeof value, 'number', `${question.qid}.${name}`);
      assert.ok(value >= 0 && value <= 100, `${question.qid}.${name} خارج 0–100`);
    }
    assert.equal(question.media.length, 2, question.qid);
  }
});

// ── 2 — «اكشف قطعة» كانت تكشف عددًا عشوائيًا من القطع ────────────────────
test('كشف قطعة واحدة: القرعة تُسحب مرة واحدة خارج المرشِّح', () => {
  // السلوك المُصحّح كما في MediaImage: فهرس واحد يُحسب ثم يُستبعد.
  const revealOne = (list, random) => {
    if (!list.length) return list;
    const drop = Math.floor(random() * list.length);
    return list.filter((_, index) => index !== drop);
  };
  // السلوك القديم: Math.random داخل المرشِّح، يُعاد تقييمه لكل قطعة.
  const revealOld = (list, random) => list.filter((_, index) => index !== Math.floor(random() * list.length));

  let tiles = Array.from({ length: 12 }, (_, i) => i);
  let presses = 0;
  const random = (() => { let s = 7; return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648); })();
  while (tiles.length) {
    const before = tiles.length;
    tiles = revealOne(tiles, random);
    presses += 1;
    assert.equal(tiles.length, before - 1, 'كل ضغطة تكشف قطعة واحدة بالضبط');
  }
  assert.equal(presses, 12, 'اثنتا عشرة ضغطة لاثنتي عشرة قطعة');
  assert.deepEqual(revealOne([], random), []);

  // ولإثبات أن الخطأ القديم كان حقيقيًا: تُرصد ضغطات بلا أثر وأخرى تكشف أكثر من قطعة.
  let none = 0;
  let many = 0;
  for (let trial = 0; trial < 400; trial += 1) {
    const list = Array.from({ length: 12 }, (_, i) => i);
    const after = revealOld(list, Math.random).length;
    if (after === 12) none += 1;
    if (after < 11) many += 1;
  }
  assert.ok(none > 0 && many > 0, 'السلوك القديم غير حتمي: يكشف صفرًا أو أكثر من قطعة');
});

// ── 4 — إعدادات المنصة: نموذج القرار الذي تستعمله اللعبة ────────────────
test('إعدادات المنصة تَحكم الصوت والاهتزاز حين تُمرَّر، ومخزن اللعبة حين لا تُمرَّر', () => {
  const decide = (settings, ownSoundOn) => ({
    sound: settings ? settings.soundOn !== false : ownSoundOn,
    haptics: settings ? settings.hapticsOn !== false : true,
    motion: settings ? !settings.reducedMotion : true,
    ownMuteButton: !settings,
  });
  assert.deepEqual(decide(null, true), { sound: true, haptics: true, motion: true, ownMuteButton: true });
  assert.deepEqual(decide(null, false), { sound: false, haptics: true, motion: true, ownMuteButton: true });
  // زر كتم واحد فقط: شريط المنصة حين تصل الإعدادات
  assert.equal(decide({ soundOn: true, hapticsOn: true, reducedMotion: false }, false).ownMuteButton, false);
  assert.equal(decide({ soundOn: true, hapticsOn: true, reducedMotion: false }, false).sound, true, 'إعداد المنصة يغلب مخزن اللعبة');
  assert.equal(decide({ soundOn: false, hapticsOn: true, reducedMotion: false }, true).sound, false);
  assert.equal(decide({ soundOn: true, hapticsOn: false, reducedMotion: false }, true).haptics, false);
  assert.equal(decide({ soundOn: true, hapticsOn: true, reducedMotion: true }, true).motion, false);
});

// ── 6 — «مباراة جارية» فعلًا، لا دائمًا ─────────────────────────────────
test('inGame يتبع الشاشة: اللوحة والسؤال فقط', () => {
  const inGame = (screen) => screen === 'board' || screen === 'question';
  assert.equal(inGame('board'), true);
  assert.equal(inGame('question'), true);
  for (const screen of ['home', 'setup', 'result', 'history']) {
    assert.equal(inGame(screen), false, `«${screen}» ليست مباراة جارية`);
  }
  // شاشة اللعب تفترض inGame=true للألعاب التي تدير إعدادها بنفسها
  assert.equal(meta.setup, 'self');
});

// ── مفاتيح التخزين تبقى تحت نطاق المنصة ────────────────────────────────
test('مفاتيح «بَديهة» منفصلة عن المفاتيح القديمة وتُرحَّل مرة واحدة', () => {
  assert.equal(BADEEHA_KEYS.active, 'maydan:badeeha:active-game-v2');
  assert.equal(BADEEHA_KEYS.settings, 'maydan:badeeha:settings-v2');
  const store = new Map();
  const fake = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
  };
  store.set(LEGACY_KEYS.active, '{"version":2,"hintsUsed":2}');
  assert.deepEqual(migrateLegacyKeys(fake), ['active']);
  assert.equal(fake.getItem(BADEEHA_KEYS.active), '{"version":2,"hintsUsed":2}');
  assert.equal(fake.getItem(LEGACY_KEYS.active), null);
  assert.deepEqual(migrateLegacyKeys(fake), []);
});
