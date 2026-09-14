// اختبارات انحدار للمنصة: تحليل المسارات، والملاحة، وحارس الخروج مع زر الرجوع.
// router.js نقي بما يكفي ليُستورد في Node فوق متصفح وهمي صغير.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// ── متصفح وهمي: سجل مُدخلات + hashchange غير متزامن كما في المتصفح ──────────
function createEnv() {
  const listeners = new Map();
  let entries = ['#/'];
  let index = 0;
  const dispatch = () => { (listeners.get('hashchange') || []).forEach((fn) => fn()); };
  const queue = () => { setTimeout(dispatch, 0); };
  const location = {
    get hash() { return entries[index]; },
    set hash(value) {
      const next = String(value).startsWith('#') ? String(value) : `#${value}`;
      if (next === entries[index]) return; // لا حدث لنفس العنوان
      entries = entries.slice(0, index + 1);
      entries.push(next);
      index += 1;
      queue();
    },
  };
  const history = {
    get length() { return entries.length; },
    replaceState(_state, _title, url) { entries[index] = String(url); }, // بلا حدث
    pushState(_state, _title, url) { entries = entries.slice(0, index + 1); entries.push(String(url)); index += 1; },
    back() { if (index > 0) { index -= 1; queue(); } },
    forward() { if (index < entries.length - 1) { index += 1; queue(); } },
  };
  const window = {
    addEventListener(type, fn) { listeners.set(type, [...(listeners.get(type) || []), fn]); },
    removeEventListener(type, fn) { listeners.set(type, (listeners.get(type) || []).filter((f) => f !== fn)); },
  };
  return {
    window, location, history,
    get entries() { return entries; },
    get index() { return index; },
    reset(hash = '#/') { entries = [hash]; index = 0; },
    pressBack() { history.back(); },
  };
}

const env = createEnv();
globalThis.window = env.window;
globalThis.location = env.location;
globalThis.history = env.history;

const router = await import('../src/platform/router.js');
const { parseHash, navigate, back, getRoute, getDirection, setExitGuard, useRoute, resetRouterForTests } = router;

const flush = async (times = 4) => { for (let i = 0; i < times; i += 1) await new Promise((r) => setTimeout(r, 1)); };
const start = (hash = '#/') => { env.reset(hash); resetRouterForTests(); };

// ── parseHash ───────────────────────────────────────────────────────────────
test('parseHash يغطي كل مسار مدعوم', () => {
  const cases = [
    ['', 'home', {}],
    ['#', 'home', {}],
    ['#/', 'home', {}],
    ['#/game/badeeha', 'game', { id: 'badeeha' }],
    ['#/game/meen-fina', 'game', { id: 'meen-fina' }],
    ['#/play/fabraka', 'play', { id: 'fabraka' }],
    ['#/online', 'online', {}],
    ['#/online/meenfina', 'online', { id: 'meenfina' }],
    ['#/online/fabraka', 'online', { id: 'fabraka' }],
    ['#/room/123456', 'room', { id: '123456' }],
    ['#/players', 'players', {}],
    ['#/settings', 'settings', {}],
    ['#/about', 'about', {}],
  ];
  for (const [hash, name, params] of cases) {
    const route = parseHash(hash);
    assert.equal(route.name, name, `${hash} → ${route.name}`);
    assert.deepEqual(route.params, params, `${hash} params`);
  }
  // بلا # وبلا / بادئة
  assert.equal(parseHash('/settings').name, 'settings');
  assert.equal(parseHash('settings').name, 'settings');
  assert.equal(parseHash('settings').path, '/settings');
});

test('المسارات المجهولة ترجع إلى الرئيسية، والمعرّف المجهول يبقى معرّفًا', () => {
  for (const hash of ['#/nope', '#/game', '#/game/', '#/play/', '#/room/12', '#/online/zzz', '#/game/Bad Id', '#/a/b/c']) {
    const route = parseHash(hash);
    assert.equal(route.name, 'home', `${hash} يجب أن يرجع للرئيسية`);
    assert.equal(route.path, '/');
  }
  // معرّف غير موجود في السجل يبقى مسار لعبة صالح الشكل: الشاشة هي التي تعرض
  // «لعبة غير موجودة» بدل الملاحة أثناء التصيير (التي كانت تترك صفحة بيضاء).
  assert.deepEqual(parseHash('#/game/nosuchgame'), { name: 'game', path: '/game/nosuchgame', params: { id: 'nosuchgame' } });
  assert.deepEqual(parseHash('#/play/nosuchgame'), { name: 'play', path: '/play/nosuchgame', params: { id: 'nosuchgame' } });
});

// ── الملاحة والرجوع ─────────────────────────────────────────────────────────
test('navigate يدفع مُدخلًا ويُبلغ المشتركين، و back يرجع خطوة', async () => {
  start('#/');
  navigate('/game/badeeha');
  await flush();
  assert.equal(env.location.hash, '#/game/badeeha');
  assert.equal(getRoute().path, '/game/badeeha');
  assert.equal(getDirection(), 'forward');

  navigate('/play/badeeha');
  await flush();
  assert.equal(getRoute().path, '/play/badeeha');
  assert.equal(env.entries.length, 3);

  back();
  await flush();
  assert.equal(getRoute().path, '/game/badeeha');
  assert.equal(getDirection(), 'back');
});

test('navigate بـ replace يستبدل المُدخل ولا يزيد السجل', async () => {
  start('#/');
  navigate('/settings');
  await flush();
  const before = env.entries.length;
  navigate('/about', { replace: true });
  await flush();
  assert.equal(env.entries.length, before, 'replace يجب ألا يضيف مُدخلًا');
  assert.equal(env.location.hash, '#/about');
  assert.equal(getRoute().path, '/about');
});

test('المسار الحالي يبقى صحيحًا حتى لو لم يشترك أحد بعد (الشاشة البيضاء)', async () => {
  start('#/game/nosuchgame');
  assert.equal(getRoute().path, '/game/nosuchgame');
  // ملاحة قبل اشتراك أي مستمع: الإشارة تضيع، لذلك يقرأ useRoute الحالة عند الاشتراك.
  navigate('/', { replace: true });
  await flush();
  assert.equal(getRoute().path, '/', 'الحالة الداخلية يجب أن تكون محدّثة');
  assert.equal(typeof useRoute, 'function');
  assert.match(readFileSync(path.resolve('src/platform/router.js'), 'utf8'), /listeners\.add\(setRoute\);\s*\n\s*\/\/[^\n]*\n\s*setRoute\(current\);/, 'useRoute يجب أن يزامن الحالة عند الاشتراك');
});

// ── حارس الخروج وزر الرجوع ──────────────────────────────────────────────────
async function enterGame() {
  start('#/');
  navigate('/game/badeeha');
  await flush();
  navigate('/play/badeeha');
  await flush();
}

test('حارس الخروج يعترض زر الرجوع ويعيد المسار كما كان', async () => {
  await enterGame();
  const targets = [];
  setExitGuard((target) => { targets.push(target); return true; });
  env.pressBack();
  await flush();
  assert.deepEqual(targets, ['/game/badeeha'], 'الحارس يستلم وجهة الرجوع');
  assert.equal(env.location.hash, '#/play/badeeha', 'اللاعب يبقى داخل اللعبة حتى يؤكد');
  assert.equal(getRoute().path, '/play/badeeha');
  setExitGuard(null);
});

test('بعد الخروج بزر الرجوع، ضغطة الرجوع التالية تعمل (لا مُدخلان متطابقان)', async () => {
  await enterGame();
  let pending = null;
  setExitGuard((target) => { pending = target; return true; });
  env.pressBack();
  await flush();
  assert.equal(pending, '/game/badeeha');

  // ما يفعله GameFrame عند تأكيد الخروج
  setExitGuard(null);
  navigate(pending, { replace: true });
  await flush();

  assert.equal(getRoute().path, '/game/badeeha', 'الخروج يصل إلى وجهة الرجوع');
  assert.equal(env.location.hash, '#/game/badeeha');
  assert.equal(getDirection(), 'back');
  const here = env.entries[env.index];
  const behind = env.index > 0 ? env.entries[env.index - 1] : null;
  assert.notEqual(here, behind, 'مُدخلان متتاليان بنفس العنوان يبتلعان ضغطة الرجوع');

  // ضغطة الرجوع التالية يجب أن تنقل فعلًا
  env.pressBack();
  await flush();
  assert.equal(getRoute().path, '/', 'الرجوع بعد الخروج يجب أن يصل إلى الرئيسية');
  assert.equal(env.location.hash, '#/');
});

test('الخروج من زر المنصة (لا من الرجوع) لا يمرّ بالحارس ويستبدل المُدخل', async () => {
  await enterGame();
  setExitGuard(() => true);
  setExitGuard(null); // GameFrame يرفع الحارس قبل الملاحة
  const before = env.entries.length;
  navigate('/', { replace: true });
  await flush();
  assert.equal(getRoute().path, '/');
  assert.equal(env.entries.length, before);
});

// ── فحوص مصدرية للإصلاحات غير القابلة للتشغيل في Node ───────────────────────
const read = (rel) => readFileSync(path.resolve(rel), 'utf8');

test('نافذة «لاعب جديد» لا تعيد التركيز مع كل حرف', () => {
  const src = read('src/shared/ui/components.jsx');
  assert.ok(!/document\.addEventListener\('keydown', onKey\);[\s\S]{0,400}\}, \[onClose\]\);/.test(src), 'تأثير التركيز يجب ألا يعتمد على onClose');
  assert.match(src, /const closeRef = useRef\(onClose\)/);
  assert.match(src, /\}, \[host\]\);/, 'تأثير الحوار يعمل عند الفتح فقط');
  assert.match(src, /function focusFirst/);
  assert.match(src, /function trapTab/);
  assert.match(src, /el\.inert = true/);
});

test('لا ملاحة أثناء التصيير في شاشات اللعبة', () => {
  for (const rel of ['src/platform/screens/GameDetails.jsx', 'src/platform/screens/Play.jsx']) {
    const src = read(rel);
    assert.ok(!/if \(!game\) \{ navigate\(/.test(src), `${rel}: ملاحة أثناء التصيير`);
    assert.match(src, /if \(!game\) return <MissingGame id=\{id\} \/>;/, `${rel}: يجب أن يعرض شاشة «لعبة غير موجودة»`);
  }
  assert.match(read('src/platform/screens/GameDetails.jsx'), /لعبة غير موجودة/);
});

test('حدود الخطأ موجودة حول الشاشات وحول اللعبة', () => {
  assert.match(read('src/shared/ui/components.jsx'), /export class ErrorBoundary extends React\.Component/);
  assert.match(read('src/platform/PlatformApp.jsx'), /<ErrorBoundary[\s\S]{0,400}<ScreenHost route=\{route\} \/>[\s\S]{0,80}<\/ErrorBoundary>/);
  assert.match(read('src/platform/GameFrame.jsx'), /<ErrorBoundary[\s\S]{0,500}\{children\}[\s\S]{0,80}<\/ErrorBoundary>/);
  assert.match(read('src/main.jsx'), /onUncaughtError/);
  assert.match(read('src/index.template.html'), /fatal-clear/);
});

test('الافتتاحية تملأ الشاشة وتحترم تقليل الحركة و splashSeen', () => {
  assert.match(read('src/platform/platform.css'), /\.splash \.splash-world \{[^}]*height: 100%/);
  const splash = read('src/platform/screens/Splash.jsx');
  assert.match(splash, /reducedMotion = false/);
  assert.match(splash, /const reduced = reducedMotion/);
  const app = read('src/platform/PlatformApp.jsx');
  assert.match(app, /reducedMotion=\{settings\.reducedMotion\}/);
  assert.match(app, /settings\.splashSeen \? 900 : 2200/);
  assert.match(app, /setSettings\(\{ splashSeen: true \}\)/);
});

test('shareText يفصل الإلغاء عن الفشل ويجرّب الحافظة', async () => {
  const { shareText } = await import('../src/shared/fx/haptics.js');
  const original = globalThis.navigator;
  const withNavigator = async (nav, fn) => {
    Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true });
    try { return await fn(); } finally { Object.defineProperty(globalThis, 'navigator', { value: original, configurable: true, writable: true }); }
  };
  const abort = Object.assign(new Error('cancelled'), { name: 'AbortError' });
  let copied = null;
  assert.equal(await withNavigator({ share: async () => {} }, () => shareText('t', 'x')), 'shared');
  assert.equal(await withNavigator({ share: async () => { throw abort; }, clipboard: { writeText: async () => { copied = 'nope'; } } }, () => shareText('t', 'x')), 'cancelled');
  assert.equal(copied, null, 'الإلغاء لا ينسخ');
  assert.equal(await withNavigator({ share: async () => { throw new Error('NotAllowedError'); }, clipboard: { writeText: async (v) => { copied = v; } } }, () => shareText('t', 'نص')), 'copied');
  assert.equal(copied, 'نص', 'فشل المشاركة يجب أن يجرّب الحافظة');
  assert.equal(await withNavigator({ share: async () => { throw new Error('boom'); } }, () => shareText('t', 'x')), 'failed');
  assert.equal(await withNavigator({ clipboard: { writeText: async () => { throw new Error('denied'); } } }, () => shareText('t', 'x')), 'failed');
});

test('tokens.css يعرّف --warning بلون مقروء على الأرضية', () => {
  const tokens = read('src/shared/theme/tokens.css');
  const warning = tokens.match(/--warning:\s*(#[0-9A-Fa-f]{6})/);
  assert.ok(warning, 'tokens.css ينقصه --warning');
  const bg = tokens.match(/--bg:\s*(#[0-9A-Fa-f]{6})/)[1];
  const luminance = (hex) => {
    const parts = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2];
  };
  const a = luminance(warning[1]) + 0.05;
  const b = luminance(bg) + 0.05;
  const ratio = Math.max(a, b) / Math.min(a, b);
  assert.ok(ratio >= 4.5, `--warning ${warning[1]} على ${bg} = ${ratio.toFixed(2)}:1`);
});

test('الشاشة تحجز مكان الشريط اللاصق وزره معتم', () => {
  assert.match(read('src/shared/ui/ui.css'), /--screen-bottom-reserve/);
  const setup = read('src/shared/setup/setup.css');
  assert.match(setup, /\.screen:has\(\.setup-sticky\) \{ --screen-bottom-reserve/);
  assert.match(setup, /\.setup-sticky \.btn-secondary \{ --btn-bg: linear-gradient\(180deg, #FFFEF8, #F9EFDD\); \}/);
});
