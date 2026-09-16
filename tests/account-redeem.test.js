// رموز الهدايا: التجزئة النقية، التطبيع، المخزن، وأثر الرمز على الاستحقاق في الواجهة
// (المزوّد والجدار وبطاقة الحساب). لا شبكة: fetch وهمي ومتصفح صغير كما في account-client.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { sha256Hex } from '../src/shared/lib/sha256.js';
import { normalizeCode, codeHash, isValidCode } from '../src/shared/account/redeem.js';
import { REDEEM_CODE_HASHES, REDEEM_ON_IOS } from '../src/shared/account/config.js';
import { ACCOUNT_ERRORS } from '../src/shared/account/errors.js';
import { createAccountStore } from '../src/shared/account/store.js';
import { fakeStorage } from './helpers.js';

const windowListeners = new Map();
globalThis.window = {
  addEventListener(type, fn) { windowListeners.set(type, [...(windowListeners.get(type) || []), fn]); },
  removeEventListener(type, fn) { windowListeners.set(type, (windowListeners.get(type) || []).filter((f) => f !== fn)); },
};
globalThis.location = { protocol: 'https:', origin: 'https://maydan.test', pathname: '/', hash: '', assign() {} };
globalThis.fetch = async () => { throw new Error('لا شبكة في الاختبارات'); };

const root = process.cwd();
mkdirSync(path.join(root, '.cache'), { recursive: true });
const temp = mkdtempSync(path.join(root, '.cache', 'account-redeem-'));
after(() => rmSync(temp, { recursive: true, force: true }));

await build({
  stdin: {
    contents: `
      import React from 'react';
      import { renderToStaticMarkup } from 'react-dom/server';
      import { accountStore } from './src/shared/account/store.js';
      import { AccountProvider } from './src/shared/account/AccountProvider.jsx';
      import { Paywall } from './src/shared/account/Paywall.jsx';
      import { AccountCard, subscriptionLine } from './src/shared/account/AccountCard.jsx';
      import { AccountContext, NULL_ACCOUNT, useAccount } from './src/shared/account/context.js';
      export { accountStore, subscriptionLine, NULL_ACCOUNT };
      function Probe() {
        const a = useAccount();
        return React.createElement('i', { 'data-premium': String(a.premium), 'data-promo': String(!!a.promo), 'data-locked': String(a.lockedPack('anime')), 'data-access': a.gameAccess('beep') }, 'PROBE');
      }
      export const renderProvider = () => renderToStaticMarkup(React.createElement(AccountProvider, null, React.createElement(Probe)));
      export const renderPaywall = (value) => renderToStaticMarkup(React.createElement(AccountContext.Provider, { value: { ...NULL_ACCOUNT, ...value } }, React.createElement(Paywall, { open: true, onClose() {} })));
      export const renderCard = (value) => renderToStaticMarkup(React.createElement(AccountContext.Provider, { value: { ...NULL_ACCOUNT, ...value } }, React.createElement(AccountCard)));
    `,
    resolveDir: root,
    loader: 'jsx',
  },
  outfile: path.join(temp, 'redeem.mjs'),
  bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic',
  loader: { '.js': 'jsx', '.css': 'text', '.json': 'json', '.webp': 'dataurl', '.png': 'dataurl', '.woff2': 'dataurl' },
  logLevel: 'silent',
});
const mod = await import(pathToFileURL(path.join(temp, 'redeem.mjs')).href);

const CODE = '1121998';

test('sha256 النقي يطابق node:crypto على نصوص متنوعة', () => {
  for (const text of ['', 'abc', CODE, 'رمز الهدية 🎁', 'a'.repeat(55), 'b'.repeat(56), 'c'.repeat(64), 'd'.repeat(1000)]) {
    assert.equal(sha256Hex(text), createHash('sha256').update(text).digest('hex'), JSON.stringify(text.slice(0, 20)));
  }
});

test('التطبيع: أرقام عربية وفارسية ومسافات وشرطات وحالة الأحرف كلها تصل إلى الرمز نفسه', () => {
  assert.equal(normalizeCode(' ١١٢١٩٩٨ '), CODE);
  assert.equal(normalizeCode('۱۱۲۱۹۹۸'), CODE);
  assert.equal(normalizeCode('112-1998'), CODE);
  assert.equal(normalizeCode('112 1998'), CODE);
  assert.equal(normalizeCode('abc-def'), 'ABCDEF');
  assert.equal(codeHash('١١٢١٩٩٨'), codeHash(CODE));
});

test('الرمز المتفق عليه صحيح وكل ما عداه مرفوض، والبصمة في الإعداد لا الرمز', () => {
  assert.equal(isValidCode(CODE), true);
  assert.equal(isValidCode(' ١١٢١٩٩٨ '), true);
  for (const bad of ['1121999', '', '112', '0000000', null, undefined, 12345678, CODE + '0']) assert.equal(isValidCode(bad), false, String(bad));
  assert.ok(REDEEM_CODE_HASHES.includes(sha256Hex(CODE)));
  assert.ok(!JSON.stringify(REDEEM_CODE_HASHES).includes(CODE), 'الرمز نفسه لا يظهر في الحزمة');
  assert.equal(isValidCode(CODE, []), false);
  assert.equal(isValidCode('other', [sha256Hex('OTHER')]), true, 'قائمة خارجية + حالة الأحرف');
  assert.ok('REDEEM_INVALID' in ACCOUNT_ERRORS);
});

test('المخزن: الرمز يُحفظ ببصمته، وبصمة أُلغيت من الإعداد تُعامل كأن لا رمز', () => {
  const store = createAccountStore(fakeStorage());
  assert.equal(store.readPromo(), null);
  const entry = store.writePromo(CODE, codeHash(CODE), 1000);
  assert.deepEqual(entry, { code: CODE, hash: codeHash(CODE), redeemedAt: 1000, syncedFor: null });
  assert.deepEqual(store.readPromo(), entry);
  store.writePromo(CODE, 'deadbeef');
  assert.equal(store.readPromo(), null, 'بصمة غير معروفة');
  store.writePromo('x', codeHash(CODE));
  store.clearAuth();
  assert.ok(store.readPromo(), 'الخروج لا يمسح رمز الجهاز');
  assert.equal(store.readPromo().syncedFor, null);
  assert.equal(store.markPromoSynced('user-1').syncedFor, 'user-1');
  assert.equal(store.markPromoSynced('').syncedFor, null);
  store.clearPromo();
  assert.equal(store.readPromo(), null);
  assert.equal(store.markPromoSynced('user-1'), null, 'لا رمز = لا شيء يُعلَّم');
  // أشكال تالفة أو غريبة لا تُسقط الواجهة.
  for (const raw of ['nope', ['a'], { hash: 42 }, { code: CODE }, null]) {
    store.storage.set('promo', raw);
    assert.equal(store.readPromo(), null, JSON.stringify(raw));
  }
  store.storage.set('promo', { code: CODE, hash: codeHash(CODE).toUpperCase(), redeemedAt: 'x' });
  assert.deepEqual(store.readPromo(), { code: CODE, hash: codeHash(CODE), redeemedAt: 0, syncedFor: null }, 'بصمة بأحرف كبيرة تُقبل والتاريخ التالف يصير صفرًا');
  assert.equal(store.writePromo(CODE, ''), null, 'بصمة فارغة تمسح المفتاح');
  assert.equal(store.readPromo(), null);
  // حدود الطول والتطبيع.
  assert.equal(isValidCode('a'.repeat(65), [sha256Hex('A'.repeat(65))]), false, 'أطول من CODE_MAX');
  assert.equal(isValidCode('a'.repeat(64), [sha256Hex('A'.repeat(64))]), true);
  assert.equal(normalizeCode('a_b.c d-e'), 'ABCDE');
});

test('المزوّد: رمز مفعَّل على الجهاز = مشترك، بلا جلسة وبلا شبكة', () => {
  const before = mod.renderProvider();
  assert.match(before, /data-premium="false"/);
  assert.match(before, /data-locked="true"/);
  mod.accountStore.writePromo(CODE, codeHash(CODE));
  try {
    const html = mod.renderProvider();
    assert.match(html, /data-premium="true"/);
    assert.match(html, /data-promo="true"/);
    assert.match(html, /data-locked="false"/);
    assert.match(html, /data-access="premium"/);
  } finally {
    mod.accountStore.clearPromo();
  }
});

test('الجدار وبطاقة الحساب: رابط الرمز على الويب فقط، والسطر يذكر «برمز هدية»', () => {
  const web = mod.renderPaywall({ platform: 'web', signedIn: false });
  assert.match(web, /class="btn btn-ghost btn-full paywall-redeem"/);
  assert.ok(web.indexOf('paywall-redeem') < web.indexOf('paywall-legal'), 'زر الرمز فوق النص القانوني لا تحته');
  assert.match(web, /لديك رمز هدية؟/);
  // قواعد App Store 3.1.1: العلم مغلق والرابط غائب على iOS فعلًا (لا مقارنة بالعلم نفسه).
  assert.equal(REDEEM_ON_IOS, false);
  const ios = mod.renderPaywall({ platform: 'ios', signedIn: true });
  assert.doesNotMatch(ios, /paywall-redeem/);
  assert.doesNotMatch(ios, /لديك رمز هدية؟/);
  const promo = { code: CODE, hash: codeHash(CODE), redeemedAt: 1 };
  assert.equal(mod.subscriptionLine(null, true, promo), 'ميدان بلس فعّال · برمز هدية');
  assert.match(mod.subscriptionLine({ premium: { until: 4102444800000, source: 'promo' } }, true, null), /برمز هدية$/);
  assert.doesNotMatch(mod.subscriptionLine({ premium: { until: 4102444800000, source: 'promo' } }, true, null), /حتى/, 'لا تاريخ للرمز');
  const cardAnon = mod.renderCard({ platform: 'web', user: null, premium: true, promo });
  assert.match(cardAnon, /على هذا الجهاز/);
  assert.doesNotMatch(cardAnon, /إدارة الاشتراك/);
  const cardFree = mod.renderCard({ platform: 'web', user: { id: 'u', name: 'س' }, premium: false, promo: null, me: { user: { id: 'u' }, premium: { until: 0 } } });
  assert.match(cardFree, /لديك رمز هدية؟/);
  const cardIos = mod.renderCard({ platform: 'ios', user: { id: 'u', name: 'س' }, premium: false, promo: null });
  assert.doesNotMatch(cardIos, /لديك رمز هدية؟/);
  // مسجَّل واشتراكه من الخادم برمز: لا «إدارة الاشتراك» ولا زر رمز؛ ومدفوع سارٍ: تظهر الإدارة.
  const far = Date.now() + 50 * 365 * 86_400_000;
  const cardPromo = mod.renderCard({ platform: 'web', user: { id: 'u', name: 'س' }, premium: true, promo: null, me: { user: { id: 'u' }, premium: { active: true, until: far, source: 'promo' } } });
  assert.doesNotMatch(cardPromo, /إدارة الاشتراك/);
  assert.doesNotMatch(cardPromo, /لديك رمز هدية؟/);
  assert.match(cardPromo, /برمز هدية/);
  const cardPaid = mod.renderCard({ platform: 'web', user: { id: 'u', name: 'س' }, premium: true, promo: null, me: { user: { id: 'u' }, premium: { active: true, until: Date.now() + 86_400_000, source: 'paddle', willRenew: true } } });
  assert.match(cardPaid, /إدارة الاشتراك/);
  assert.match(cardPaid, /عبر الويب/);
  // اشتراك مدفوع منتهٍ (بعد سماح GRACE_MS) + رمز على الجهاز: السطر يذكر الرمز لا تاريخًا ماضيًا، ولا زر إدارة.
  const lapsed = { user: { id: 'u' }, premium: { active: false, until: Date.now() - 10 * 86_400_000, source: 'paddle' } };
  const inGrace = { user: { id: 'u' }, premium: { active: false, until: Date.now() - 86_400_000, source: 'paddle', willRenew: true } };
  assert.match(mod.subscriptionLine(inGrace, true, promo), /عبر الويب/, 'داخل السماح ما زال المدفوع هو المعروض');
  assert.equal(mod.subscriptionLine(lapsed, true, promo), 'ميدان بلس فعّال · برمز هدية');
  assert.doesNotMatch(mod.renderCard({ platform: 'web', user: { id: 'u', name: 'س' }, premium: true, promo, me: lapsed }), /إدارة الاشتراك/);
  // زر الرمز يجاور «اشترك» لا يلي «حذف الحساب».
  const order = mod.renderCard({ platform: 'web', user: { id: 'u', name: 'س' }, premium: false, promo: null, me: { user: { id: 'u' }, premium: { until: 0 } } });
  assert.ok(order.indexOf('لديك رمز هدية؟') < order.indexOf('تسجيل الخروج'), 'قبل الخروج والحذف');
  assert.ok(order.indexOf('لديك رمز هدية؟') > order.indexOf('اشترك في'), 'بعد زر الاشتراك');
});
