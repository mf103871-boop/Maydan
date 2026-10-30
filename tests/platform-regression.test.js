// اختبارات انحدار للمنصة: تحليل المسارات، والملاحة، وحارس الخروج مع زر الرجوع.
// router.js نقي بما يكفي ليُستورد في Node فوق متصفح وهمي صغير.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
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
const { parseHash, navigate, back, getRoute, getDirection, setExitGuard, registerBackLayer, installNativeBackBridge, useRoute, resetRouterForTests } = router;

const flush = async (times = 4) => { for (let i = 0; i < times; i += 1) await new Promise((r) => setTimeout(r, 1)); };
const start = (hash = '#/') => { env.reset(hash); resetRouterForTests(); };

test('selected family mode survives Back through roster/instructions, reload and repeated navigation', async () => {
  start();
  navigate('/game/badeeha?mode=local'); await flush();
  navigate('/players'); await flush();
  back(); await flush();
  assert.equal(location.hash, '#/game/badeeha?mode=local');
  assert.equal(getRoute().params.mode, 'local');
  navigate('/play/badeeha?mode=local'); await flush();
  const length = history.length;
  navigate('/play/badeeha?mode=local'); await flush();
  assert.equal(history.length, length);
  assert.equal(router.getPreviousPath(), '/game/badeeha?mode=local');
  resetRouterForTests();
  assert.equal(getRoute().params.mode, 'local');
  assert.equal(getRoute().params.id, 'badeeha');
});

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
    ['#/online/ersomha', 'online', { id: 'ersomha' }],
    ['#/room/123456', 'room', { id: '123456' }],
    ['#/players', 'players', {}],
    ['#/store', 'store', {}],
    ['#/friends', 'friends', {}],
    ['#/friends/person_123', 'friends', { id: 'person_123' }],
    ['#/friends/group/group-123', 'friend-group', { id: 'group-123' }],
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

test('query parameters cannot replace the game, room or friend identity in a direct link', () => {
  for (const [hash,id] of [['#/play/beep?id=badeeha','beep'],['#/room/123456?id=654321','123456'],['#/friends/alice?id=bob','alice']]) assert.equal(parseHash(hash).params.id,id);
  assert.equal(parseHash('#/auth?code=fixture-code').params.code,'fixture-code');
});

test('the last rapid menu selection wins even before the first hash event is delivered', async () => {
  start(); navigate('/store'); navigate('/'); await flush();
  assert.equal(env.location.hash,'#/'); assert.equal(getRoute().path,'/');
});

test('a browser Back can cancel a pending tab navigation without leaving stale app history', async () => {
  start(); navigate('/store'); env.pressBack(); await flush();
  assert.equal(getRoute().path,'/'); assert.equal(router.getPreviousPath(),null);
  navigate('/settings'); await flush(); back(); await flush();
  assert.equal(getRoute().path,'/'); assert.equal(getDirection(),'back');
});

test('changing directly between local games preserves the running match until exit confirmation', async () => {
  await enterGame(); const targets=[];
  setExitGuard(target=>{targets.push(target);return true;});
  navigate('/play/beep'); await flush();
  assert.deepEqual(targets,['/play/beep']); assert.equal(getRoute().path,'/play/badeeha'); assert.equal(env.location.hash,'#/play/badeeha');
  setExitGuard(null); navigate(targets[0],{replace:true}); await flush(); assert.equal(getRoute().path,'/play/beep');
});

test('an explicit replacement exit clears a previously cancelled Back destination', async () => {
  await enterGame(); setExitGuard(()=>true);env.pressBack();await flush();
  setExitGuard(null);navigate('/',{replace:true});await flush();const index=env.index;
  navigate('/game/badeeha',{replace:true});await flush();
  assert.equal(getRoute().path,'/game/badeeha');assert.equal(env.index,index,'the new replacement must not unexpectedly traverse old browser history');
});

test('Back dismisses the top dialog, then the friends drawer, then asks the game exit guard', async () => {
  await enterGame(); const events=[];
  setExitGuard(target=>{events.push('exit:'+target);return true;});
  let removeDrawer=registerBackLayer(()=>{events.push('drawer');removeDrawer();},{priority:10});
  let removeFirst=registerBackLayer(()=>{events.push('dialog');removeFirst();},{priority:20});
  let removeTop=registerBackLayer(()=>{events.push('confirmation');removeTop();},{priority:20});
  for(const expected of ['confirmation','dialog','drawer']) {env.pressBack();await flush();assert.equal(events.at(-1),expected);assert.equal(getRoute().path,'/play/badeeha');assert.equal(env.location.hash,'#/play/badeeha');}
  env.pressBack();await flush();assert.equal(events.at(-1),'exit:/game/badeeha');
});

test('busy dialog consumes Back and explicit successful navigation does not dismiss a layer', async () => {
  start();navigate('/settings');await flush();let count=0;
  const remove=registerBackLayer(()=>{count++;},{priority:20});
  back();assert.equal(count,1);assert.equal(getRoute().path,'/settings');
  env.pressBack();await flush();assert.equal(count,2);assert.equal(getRoute().path,'/settings');
  navigate('/store');await flush();assert.equal(getRoute().path,'/store');assert.equal(count,2);
  remove();remove();back();await flush();assert.equal(getRoute().path,'/settings');
});

test('a second browser Back before the restoration event dismisses the next layer', async () => {
  await enterGame();const events=[];
  setExitGuard(target=>{events.push('exit:'+target);return true;});
  let removeDrawer=registerBackLayer(()=>{events.push('drawer');removeDrawer();},{priority:10});
  let removeDialog=registerBackLayer(()=>{
    events.push('dialog');removeDialog();
    // The second Back is already in flight when WebKit reports the restored hash.
    env.pressBack();
  },{priority:20});
  env.pressBack();await flush();
  assert.deepEqual(events,['dialog','drawer']);
  assert.equal(getRoute().path,'/play/badeeha');assert.equal(env.location.hash,'#/play/badeeha');
  env.pressBack();await flush();assert.equal(events.at(-1),'exit:/game/badeeha');
});

test('native Back bridge respects modal priority and IME, then releases its lifecycle listeners', async () => {
  start();navigate('/settings');await flush();
  const document=new EventTarget(),host={document},events=[];
  const dispose=installNativeBackBridge(host),bridge=host.maydanNavigateBack;
  let remove=registerBackLayer(()=>{events.push('dialog');remove();},{priority:20});
  document.dispatchEvent(new Event('compositionstart'));
  assert.equal(bridge(),true);assert.deepEqual(events,[]);assert.equal(getRoute().path,'/settings');
  document.dispatchEvent(new Event('compositionend'));
  assert.equal(bridge(),true);assert.deepEqual(events,['dialog']);
  assert.equal(bridge(),true);await flush();assert.equal(getRoute().path,'/');
  dispose();dispose();assert.equal(host.maydanNavigateBack,undefined);assert.equal(bridge(),false);
  const prior=()=>false;host.maydanNavigateBack=prior;const restore=installNativeBackBridge(host);restore();assert.equal(host.maydanNavigateBack,prior);
});

test('Back from a cold direct game or room entry cannot bypass its exit guard', async () => {
  for(const initial of ['#/play/beep','#/room/123456']) {
    start(initial);let target=null;setExitGuard(value=>{target=value;return true;});
    back();await flush();assert.equal(target,'/');assert.equal(env.location.hash,initial);assert.equal(getRoute().path,initial.slice(1));
    setExitGuard(null);navigate(target,{replace:true});assert.equal(getRoute().path,'/');
  }
});

test('native edge and accessibility Back enter the mounted router bridge instead of the legacy game handler', () => {
  const native=readFileSync(path.resolve('ios/Maydan/GameViewController.swift'),'utf8');
  const invoke=native.match(/private func invokeWebBack\(\) \{([\s\S]*?)\n    \}/)?.[1];
  assert.match(invoke,/window\.maydanNavigateBack\(\)/);
  assert.doesNotMatch(invoke,/window\.maydanBack\(/);
  assert.match(native,/override func accessibilityPerformEscape\(\)[\s\S]{0,160}invokeWebBack\(\)/);
  assert.match(native,/private func handleEdgeBackGesture[\s\S]{0,220}invokeWebBack\(\)/);
  assert.match(readFileSync(path.resolve('src/platform/PlatformApp.jsx'),'utf8'),/useEffect\(\(\) => installNativeBackBridge\(\), \[\]\)/);
  assert.match(readFileSync(path.resolve('src/platform/GameFrame.jsx'),'utf8'),/fromBack && typeof window\.maydanBack === 'function' && window\.maydanBack\(\)/);
});

// ── فحوص مصدرية للإصلاحات غير القابلة للتشغيل في Node ───────────────────────
const read = (rel) => readFileSync(path.resolve(rel), 'utf8');

// غلاف iOS لا ينفّذ runJavaScriptConfirmPanel/AlertPanel/TextInputPanel، فيعامل WKWebView
// confirm كـ«إلغاء» ويتجاهل alert وprompt: زرّا المسح في بَديهة لم يفعلا شيئًا على iPhone.
test('shipped code uses in-app dialogs, never the native JavaScript panels the iOS shell lacks', () => {
  const native = read('ios/Maydan/GameViewController.swift');
  assert.doesNotMatch(native, /runJavaScript(Confirm|Alert|TextInput)Panel/, 'إن نُفّذت الألواح في الغلاف فحدّث هذا الاختبار');
  const files = [];
  const walk = (dir) => { for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (!['data', 'vendor'].includes(entry.name)) walk(full); }
    else if (/\.(js|jsx)$/.test(entry.name)) files.push(full);
  } };
  walk(path.resolve('src'));
  const offenders = files.filter((file) => /(^|[^.\w])(window\.)?(confirm|alert|prompt)\(\s*["'`]/.test(readFileSync(file, 'utf8')));
  assert.deepEqual(offenders.map((file) => path.relative(process.cwd(), file)), []);
});

test('نافذة «لاعب جديد» لا تعيد التركيز مع كل حرف', () => {
  const src = read('src/shared/ui/components.jsx');
  const interaction = read('src/shared/ui/dialog-interaction.js');
  assert.match(src, /handler=useRef\(onClose\)/, 'الإغلاق يقرأ آخر معالج دون تغيير أثر التركيز');
  assert.match(src, /handler\.current=onClose/);
  assert.match(src, /\},\[ref,host,syncVars,close,open\]\);/, 'أثر التركيز لا يعتمد على onClose أو نص الحقل');
  assert.match(src, /activateDialog\(\{node:ref\.current,host,close\}\)/);
  assert.match(interaction, /function focusFirst/);
  assert.match(interaction, /event\.key!=='Tab'/);
  assert.match(interaction, /event\.shiftKey && active===list\[0\]/);
  assert.match(interaction, /child\.inert=active\?/);
  assert.match(interaction, /document\.removeEventListener\('keydown',onKey,true\)/);
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

test('الافتتاحية تملأ الشاشة وتنتظر جاهزية الأصول قبل تركيب اللعبة', () => {
  assert.match(read('src/platform/platform.css'), /\.splash \.splash-world \{[^}]*height: 100%/);
  const splash = read('src/platform/screens/Splash.jsx');
  assert.match(splash, /reducedMotion = false/);
  assert.match(splash, /useVisualReadiness\(\{ includeWorld: true \}\)/);
  assert.doesNotMatch(splash, /role="button"|setTimeout\(finish|duration = 2200/);
  const app = read('src/platform/PlatformApp.jsx');
  assert.match(app, /reducedMotion=\{settings\.reducedMotion\}/);
  assert.match(app, /booted && <ErrorBoundary/);
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

// الصوت 3.2: صوت لكل لمسة يأتي من مفوِّض واحد، ولا تكرار في المعالجات.
test('مفوِّض اللمسات مسجَّل، وتغيير الشاشة يُبقي صوت اللمسة الأخيرة', () => {
  const bus = read('src/shared/fx/sound.js');
  assert.match(bus, /document\.addEventListener\('click', onTap, true\)/, 'المفوِّض يُسجَّل على click في مرحلة الالتقاط');
  assert.match(bus, /document\.removeEventListener\('click', onTap, true\)/, 'dispose يزيل المفوِّض');
  assert.match(bus, /const GESTURE_EVENTS = \[[^\]]*'pointerup'[^\]]*'touchend'[^\]]*'click'[^\]]*\]/, 'إيماءات الفتح تشمل pointerup/touchend/click');
  assert.match(read('src/platform/PlatformApp.jsx'), /sound\.stop\(\{ spare: \d+ \}\)/, 'تغيير الشاشة يستعمل stop({ spare })');
});

test('المعالجات لا تكرّر صوت النقرة الذي يقدّمه المفوِّض', () => {
  for (const rel of ['src/platform/screens/Home.jsx', 'src/platform/screens/Play.jsx', 'src/shared/setup/PlayersSetup.jsx', 'src/shared/setup/TeamsSetup.jsx', 'src/platform/GameFrame.jsx',
    'src/games/beep/Game.jsx', 'src/games/mamnoo/Game.jsx', 'src/games/jabeen/Game.jsx', 'src/games/meenfina/Game.jsx', 'src/games/fabraka/Game.jsx']) {
    assert.doesNotMatch(read(rel), /sound\.play\('click'\)/, `${rel} يعتمد على المفوِّض`);
  }
  const settings = read('src/platform/screens/Settings.jsx');
  assert.equal((settings.match(/onPointerUp=\{\(\) => sound\.play\('pop'\)\}/g) || []).length, 2, 'منزلقا الصوت والموسيقى يؤكدان بـ pop');
  assert.equal((settings.match(/onKeyUp=\{\(event\) => \{ if \(event\.key\.startsWith\('Arrow'\)/g) || []).length, 2, 'المنزلقان يؤكدان بالأسهم أيضًا');
});

test('زر التحميل يبقى معطّلًا حتى لو مرّر المستدعي disabled={false}', () => {
  const ui = read('src/shared/ui/components.jsx');
  assert.match(ui, /export function Button\(\{[^}]*\bdisabled = false\b[^}]*\}\)/);
  assert.match(ui, /disabled=\{disabled \|\| loading\}/);
  assert.doesNotMatch(ui, /rest\.disabled/);
});
