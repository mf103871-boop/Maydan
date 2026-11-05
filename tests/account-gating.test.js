// مجانية اللعب: حزم «بَديهة» وبطاقات الرئيسية والانتقال من التعليمات دون استهلاك تجربة أو طلب بلس.
// تُبنى الشاشات بـ esbuild وتُصيَّر بـ react-dom/server كما في بقية اختبارات الواجهة.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import React from 'react';
import { FREE_PACKS, TRIAL_GAMES } from '../src/shared/account/config.js';
import { lockedPack, gameAccess, isPremium, trialAvailable } from '../src/shared/account/entitlements.js';
import { NULL_ACCOUNT } from '../src/shared/account/context.js';
import { CATS } from '../src/data/categories/index.js';

const root = process.cwd();
const bank = JSON.parse(readFileSync(path.join(root, 'src/data/bank-status.json'), 'utf8'));

// ── ١) الحزم المجانية = أول عشر حزم بترتيب بنك الأسئلة ─────────────────────
test('FREE_PACKS هي أول عشر حزم بترتيب bank-status وكلها موجودة في البنك', () => {
  const ordered = Object.entries(bank.categories)
    .map(([id, category]) => ({ id, order: category.order }))
    .sort((a, b) => a.order - b.order);
  assert.equal(ordered.filter((c) => !Number.isFinite(c.order)).length, 0, 'كل حزمة لها order');
  assert.deepEqual(FREE_PACKS, ordered.slice(0, 10).map((c) => c.id));
  assert.ok(FREE_PACKS.length >= 6, 'المجاني يجب أن يكفي لمباراة كاملة (ست فئات)');
  const known = new Set(CATS.map((c) => c.id));
  for (const id of FREE_PACKS) assert.ok(known.has(id), `${id} غير موجود في CATS`);
  assert.equal(new Set(FREE_PACKS).size, FREE_PACKS.length, 'لا تكرار');
});

// ── ٢) منطق القفل النقي كما تستعمله الواجهة ───────────────────────────────
test('all Badeeha packs are free regardless of subscription', () => {
  for (const id of FREE_PACKS) {
    assert.equal(lockedPack(id, false), false);
    assert.equal(lockedPack(id, true), false);
  }
  const paid = CATS.map((c) => c.id).filter((id) => !FREE_PACKS.includes(id));
  assert.equal(paid.length, CATS.length - FREE_PACKS.length);
  for (const id of paid) {
    assert.equal(lockedPack(id, false), false, id);
    assert.equal(lockedPack(id, true), false, id);
  }
});

test('spent trials and paid membership never change free gameplay access', () => {
  const premiumMe = { premium: { until: Date.now() + 86_400_000 }, trials: { beep: true } };
  for (const game of TRIAL_GAMES) {
    assert.equal(gameAccess(null, {}, game), 'free', game);
    assert.equal(gameAccess(null, { [game]: true }, game), 'free', game);
    assert.equal(gameAccess({ trials: { [game]: true } }, {}, game), 'free', game);
    assert.equal(gameAccess(premiumMe, { [game]: true }, game), 'free', game);
  }
  // بَديهة ليست ضمن التجارب: لا تُقفل أبدًا مهما كانت العلامات المحلية.
  assert.ok(!TRIAL_GAMES.includes('badeeha'));
  assert.equal(gameAccess(null, { badeeha: true }, 'badeeha'), 'free');
  assert.equal(trialAvailable(null, { badeeha: true }, 'badeeha', false), true);
  assert.equal(isPremium(premiumMe), true);
  assert.equal(isPremium(null), false);
});

test('NULL_ACCOUNT لا يقفل شيئًا: بلا مزوّد تبقى اللعبة كما كانت', () => {
  assert.equal(NULL_ACCOUNT.lockedPack('worldcup'), false);
  assert.equal(NULL_ACCOUNT.gameAccess('beep'), 'free');
  assert.equal(NULL_ACCOUNT.premium, false);
  assert.deepEqual(NULL_ACCOUNT.authHeaders(), {});
});

// ── حساب وهمي يطابق عقد src/shared/account/context.js ─────────────────────
function fakeAccount({ premium = false, trials = {} } = {}) {
  const calls = [];
  const me = premium ? { premium: { until: Date.now() + 86_400_000 }, trials: {} } : null;
  return {
    ...NULL_ACCOUNT,
    ready: true, me, premium, trials,
    calls,
    lockedPack: (id) => lockedPack(id, premium),
    gameAccess: (game) => gameAccess(me, trials, game),
    trialAvailable: (game) => trialAvailable(me, trials, game),
    markTrial: (game) => calls.push({ type: 'markTrial', game }),
    openPaywall: (info) => calls.push({ type: 'paywall', ...info }),
    authHeaders: () => ({}),
  };
}

// ── بناء الشاشات مرة واحدة ────────────────────────────────────────────────
// «بَديهة» تفتح على شاشتها الرئيسية؛ لا نقر في التصيير الثابت، فنبدّل القيمة
// الابتدائية لحالة الشاشة وحدها (useState("home") موجود في App.js فقط) كي يُصيَّر المُنتقي.
const realUseState = React.useState;
let forceSetup = false;
React.useState = function useState(initial) {
  return realUseState(forceSetup && initial === 'home' ? 'setup' : initial);
};

mkdirSync(path.join(root, '.cache'), { recursive: true });
const temp = mkdtempSync(path.join(root, '.cache', 'account-gating-'));
// التنظيف عند خروج العملية لا في after(): خطّاف after() في المستوى الأعلى كان يعمل قبل أن
// تنتهي الانتظارات العليا (بناء esbuild ثم الاستيراد)، فيحذف المجلد وهو فارغ ويعيده esbuild
// (مجلدات متروكة في .cache)، وعلى عامل macOS سبق الحذفُ قراءةَ الاستيراد فسقط الملف كله
// بـ ERR_MODULE_NOT_FOUND. الخروج يأتي بعد كل نشاط، ولا مخلّفات.
process.once('exit', () => rmSync(temp, { recursive: true, force: true }));
await build({
  stdin: { loader: 'jsx', resolveDir: root, contents: `
    import React from 'react';
    import { renderToStaticMarkup } from 'react-dom/server';
    import { PlatformContext } from './src/platform/context.js';
    import { AccountContext } from './src/shared/account/context.js';
    import MaydanBeta from './src/games/badeeha/App.js';
    import { Home } from './src/platform/screens/Home.jsx';
    import { GameDetails } from './src/platform/screens/GameDetails.jsx';
    const noop = () => {};
    const platform = { roster: [], setRoster: noop, version: '0.0.0', toast: noop,
      sound: { play: noop }, haptics: { vibrate: noop }, confetti: { fire: noop, burst: noop },
      settings: { soundOn: false, hapticsOn: false, reducedMotion: true } };
    const wrap = (account, node) => React.createElement(PlatformContext.Provider, { value: platform },
      React.createElement(AccountContext.Provider, { value: account }, node));
    export const badeeha = (account) => renderToStaticMarkup(
      React.createElement(MaydanBeta, { api: { account, settings: platform.settings } }));
    export const home = (account) => renderToStaticMarkup(wrap(account, React.createElement(Home)));
    // الخطّاف يُشغَّل داخل مكوّن حقيقي، فنلتقط شجرة GameDetails ونستدعي onClick لزر العب.
    export const detailsTree = (id, account) => {
      let tree = null;
      const Probe = () => { tree = GameDetails({ id }); return tree; };
      const markup = renderToStaticMarkup(wrap(account, React.createElement(Probe)));
      return { tree, markup };
    };
  ` },
  outfile: path.join(temp, 'render.mjs'), bundle: true, platform: 'node', format: 'esm', packages: 'external',
  jsx: 'automatic', loader: { '.css': 'text', '.webp': 'dataurl', '.woff2': 'dataurl', '.mp3': 'dataurl' }, logLevel: 'silent',
});
const ui = await import(pathToFileURL(path.join(temp, 'render.mjs')));
// ورقة أنماط اللعبة تُصيَّر داخل الشجرة؛ نحذفها كي لا تُحسب أسماء الأصناف مرتين.
const stripStyle = (html) => html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, '');
const setupMarkup = (account) => { forceSetup = true; try { return stripStyle(ui.badeeha(account)); } finally { forceSetup = false; } };
const count = (html, needle) => html.split(needle).length - 1;

// هوية الإجراء مستقرة حتى عندما تتغير تسميته بين الإعداد المحلي والغرف الأونلاين.
function findByDesignId(node, id) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) { for (const child of node) { const hit = findByDesignId(child, id); if (hit) return hit; } return null; }
  const children = node.props && node.props.children;
  if (node.props?.['data-design-id'] === id) return node;
  return findByDesignId(children, id);
}

function assertFreeStart(tree, account, target, label) {
  const button = findByDesignId(tree, 'skip-instructions');
  assert.ok(button, 'يوجد إجراء رئيسي للانتقال من التعليمات');
  assert.equal(button.props.disabled, false, 'الانتقال متاح دون بلس');
  assert.equal(button.props.children, label);
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'location');
  const location = { hash: '#/' };
  Object.defineProperty(globalThis, 'location', { value: location, configurable: true });
  try {
    button.props.onClick();
    assert.equal(location.hash, target, 'الإجراء ينتقل فعلًا إلى إعداد اللعبة أو غرفها');
    assert.deepEqual(account.calls, [], 'لا جدار دفع ولا استهلاك تجربة قديمة');
  } finally {
    if (previous) Object.defineProperty(globalThis, 'location', previous);
    else delete globalThis.location;
  }
}

// ── ٣) مُنتقي «بَديهة»: كل حزمة غير مجانية تحمل is-locked، والمشترك لا يرى قفلًا ──
test('Badeeha renders all 78 packs unlocked for free, expired and subscribed players', () => {
  for (const account of [fakeAccount(), fakeAccount({trials:{beep:true}}), fakeAccount({premium:true})]) {
    const html=setupMarkup(account);
    assert.equal((html.match(/class="m-category-pick(?: |")/g) || []).length, CATS.length);
    assert.equal(count(html, 'is-locked'), 0);
    assert.equal(count(html, 'm-lock'), 0);
    assert.doesNotMatch(html, /aria-disabled="true"|🔒 بلس/);
    assert.match(html, /m-favorite/);
  }
});

test('بلا حساب (NULL_ACCOUNT) لا يظهر أي قفل في المُنتقي', () => {
  const html = setupMarkup(NULL_ACCOUNT);
  assert.equal(count(html, 'is-locked'), 0);
  assert.equal(count(html, 'm-lock'), 0);
});

// ── ٤) شارات الرئيسية ─────────────────────────────────────────────────────
test('Home advertises free games consistently, including exhausted legacy trials', () => {
  for (const account of [fakeAccount(),fakeAccount({trials:{beep:true,mamnoo:true}}),fakeAccount({premium:true})]) {
    const html=stripStyle(ui.home(account));
    const cards=[...html.matchAll(/<button\b[^>]*\bdata-design-id="game-card\.([a-z0-9-]+)"[^>]*>/g)];
    assert.deepEqual(cards.map(match=>match[1]).sort(), ['badeeha',...TRIAL_GAMES].sort());
    for (const [tag,id] of cards) assert.doesNotMatch(tag,/\bdisabled(?:\s|=|>)/,`${id} متاحة`);
    assert.doesNotMatch(html,/١٠ فئات مجانية|مباراة مجانية|card-badge[^>]*>بلس/);
  }
});

test('game details start previously locked games without a paywall', () => {
  for (const account of [fakeAccount({trials:{beep:true}}),fakeAccount({premium:true})]) {
    const {tree,markup}=ui.detailsTree('beep',account);
    assert.match(markup,/اللعب واستضافة الغرف والانضمام مجانًا/);
    assertFreeStart(tree, account, '/play/beep?mode=local', 'إلى إعداد اللعبة');
  }
  assert.match(ui.detailsTree('badeeha',fakeAccount()).markup,/كل الفئات مجانية/);
});

test('ارسمها تعرض استضافة الغرف والانضمام المجاني ولا تعرض جهازًا واحدًا أو حزم بديهة', () => {
  const account = fakeAccount({ trials: { ersomha: true } });
  const { tree, markup } = ui.detailsTree('ersomha', account);
  assert.match(markup, /الانضمام مجانًا/);
  assert.match(markup, /أونلاين/);
  assert.match(markup, /إلى غرف اللعبة/);
  assertFreeStart(tree, account, '/online/ersomha?mode=online', 'إلى غرف اللعبة');
  assert.doesNotMatch(markup, /العب على جهاز واحد|١٠ فئات مجانية/);
  assert.doesNotMatch(stripStyle(markup), /disabled/);
});
