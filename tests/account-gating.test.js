// قفل المحتوى في الواجهة: الحزم المجانية في «بَديهة»، وشارات الرئيسية، وجدار «ميدان بلس»
// في تفاصيل اللعبة. تُبنى الشاشات بـ esbuild وتُصيَّر بـ react-dom/server كما في بقية اختبارات الواجهة.
import { test, after } from 'node:test';
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
test('lockedPack: المجاني مفتوح للجميع والباقي للمشترك فقط', () => {
  for (const id of FREE_PACKS) {
    assert.equal(lockedPack(id, false), false);
    assert.equal(lockedPack(id, true), false);
  }
  const paid = CATS.map((c) => c.id).filter((id) => !FREE_PACKS.includes(id));
  assert.equal(paid.length, CATS.length - FREE_PACKS.length);
  for (const id of paid) {
    assert.equal(lockedPack(id, false), true, id);
    assert.equal(lockedPack(id, true), false, id);
  }
});

test('gameAccess: مباراة واحدة مجانية لكل لعبة ثم القفل، والمشترك بلا قفل', () => {
  const premiumMe = { premium: { until: Date.now() + 86_400_000 }, trials: { beep: true } };
  for (const game of TRIAL_GAMES) {
    assert.equal(gameAccess(null, {}, game), 'trial', game);
    assert.equal(gameAccess(null, { [game]: true }, game), 'locked', game);
    assert.equal(gameAccess({ trials: { [game]: true } }, {}, game), 'locked', game);
    assert.equal(gameAccess(premiumMe, { [game]: true }, game), 'premium', game);
  }
  // بَديهة ليست ضمن التجارب: لا تُقفل أبدًا مهما كانت العلامات المحلية.
  assert.ok(!TRIAL_GAMES.includes('badeeha'));
  assert.equal(gameAccess(null, { badeeha: true }, 'badeeha'), 'trial');
  assert.equal(trialAvailable(null, { badeeha: true }, 'badeeha', false), true);
  assert.equal(isPremium(premiumMe), true);
  assert.equal(isPremium(null), false);
});

test('NULL_ACCOUNT لا يقفل شيئًا: بلا مزوّد تبقى اللعبة كما كانت', () => {
  assert.equal(NULL_ACCOUNT.lockedPack('worldcup'), false);
  assert.equal(NULL_ACCOUNT.gameAccess('beep'), 'premium');
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
after(() => rmSync(temp, { recursive: true, force: true }));
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
const stripStyle = (html) => html.replace(/<style>[\s\S]*?<\/style>/g, '');
const setupMarkup = (account) => { forceSetup = true; try { return stripStyle(ui.badeeha(account)); } finally { forceSetup = false; } };
const count = (html, needle) => html.split(needle).length - 1;

// شجرة عناصر React: بحث عن أول عنصر يحمل نصًا معيّنًا بين أبنائه.
function findByText(node, text) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) { for (const child of node) { const hit = findByText(child, text); if (hit) return hit; } return null; }
  const children = node.props && node.props.children;
  if (children === text) return node;
  return findByText(children, text);
}

// ── ٣) مُنتقي «بَديهة»: كل حزمة غير مجانية تحمل is-locked، والمشترك لا يرى قفلًا ──
test('مُنتقي بَديهة: 68 حزمة مقفولة للمجاني، وصفر للمشترك', () => {
  const free = fakeAccount();
  const html = setupMarkup(free);
  assert.match(html, /m-category-pick/);
  assert.equal(count(html, 'is-locked'), CATS.length - FREE_PACKS.length);
  assert.equal(count(html, 'is-locked'), 68);
  assert.equal(count(html, 'm-lock'), CATS.length - FREE_PACKS.length);
  assert.match(html, /aria-disabled="true"/);
  assert.match(html, /🔒 بلس/);
  assert.match(html, /m-favorite/, 'زر المفضلة يبقى كما هو');
  assert.match(html, /مجاني<\/button>/, 'مرشّح «مجاني» موجود بين الرقائق');

  const plus = fakeAccount({ premium: true });
  const premiumHtml = setupMarkup(plus);
  assert.equal(count(premiumHtml, 'is-locked'), 0);
  assert.equal(count(premiumHtml, 'm-lock'), 0);
  assert.doesNotMatch(premiumHtml, /aria-disabled="true"/);
  assert.equal(count(premiumHtml, 'm-category-pick'), count(html, 'm-category-pick'));
});

test('بلا حساب (NULL_ACCOUNT) لا يظهر أي قفل في المُنتقي', () => {
  const html = setupMarkup(NULL_ACCOUNT);
  assert.equal(count(html, 'is-locked'), 0);
  assert.equal(count(html, 'm-lock'), 0);
});

// ── ٤) شارات الرئيسية ─────────────────────────────────────────────────────
test('الرئيسية: شارة لكل حالة، ولا شارة للمشترك، والبطاقات تبقى مفعّلة', () => {
  const fresh = ui.home(fakeAccount());
  assert.match(fresh, /١٠ فئات مجانية/);
  assert.equal(count(fresh, 'مباراة مجانية'), TRIAL_GAMES.length);
  assert.doesNotMatch(fresh, /card-badge[^>]*>بلس/);

  const used = ui.home(fakeAccount({ trials: { beep: true, mamnoo: true } }));
  assert.equal(count(used, '>بلس<'), 2);
  assert.equal(count(used, 'مباراة مجانية'), TRIAL_GAMES.length - 2);
  assert.equal(count(used, 'disabled'), 0, 'القفل لا يعطّل البطاقات');

  const plus = ui.home(fakeAccount({ premium: true }));
  assert.doesNotMatch(plus, /card-badge/);
  assert.doesNotMatch(plus, /١٠ فئات مجانية/);
});

// ── ٥) تفاصيل اللعبة: زر العب يفتح الجدار حين تُستهلك المباراة المجانية ────
test('تفاصيل اللعبة: زر العب يفتح جدار «ميدان بلس» بعد المباراة المجانية', () => {
  const locked = fakeAccount({ trials: { beep: true } });
  const { tree, markup } = ui.detailsTree('beep', locked);
  assert.match(markup, /لعبت مباراتك المجانية — اشترك للمتابعة/);
  const play = findByText(tree, 'العب');
  assert.ok(play && typeof play.props.onClick === 'function', 'زر العب موجود وله onClick');
  play.props.onClick();
  assert.deepEqual(locked.calls, [{ type: 'paywall', reason: 'trial', game: 'beep' }]);
});

test('تفاصيل اللعبة: المباراة المجانية الأولى تمر بلا جدار، والملاحظات تختفي للمشترك', () => {
  const fresh = fakeAccount();
  const { tree, markup } = ui.detailsTree('beep', fresh);
  assert.match(markup, /مباراة واحدة مجانية، ثم ميدان بلس/);
  findByText(tree, 'العب').props.onClick();
  assert.deepEqual(fresh.calls, [], 'لا جدار قبل استهلاك المباراة المجانية');

  const badeeha = ui.detailsTree('badeeha', fakeAccount());
  assert.match(badeeha.markup, /١٠ فئات مجانية، والباقي ضمن ميدان بلس/);

  const plus = ui.detailsTree('beep', fakeAccount({ premium: true }));
  assert.doesNotMatch(plus.markup, /details-plus-note/);
  const plusBadeeha = ui.detailsTree('badeeha', fakeAccount({ premium: true }));
  assert.doesNotMatch(plusBadeeha.markup, /details-plus-note/);
});
