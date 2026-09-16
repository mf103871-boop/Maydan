// اختبارات وحدة الحساب في العميل: التخزين، خرائط أخطاء الشبكة، جسر الغلاف،
// وتصيير المزوّد والجدار. لا شبكة حقيقية ولا متصفح: fetch وهمي ومتصفح صغير.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { fakeStorage } from './helpers.js';
import { clearAllPlatformData, createStorage } from '../src/shared/lib/storage.js';
import { post, ClientError } from '../src/online/client.js';

// ── متصفح وهمي: يُركَّب قبل تحميل الحزمة (router و native يقرآنه عند الاستيراد) ──
const windowListeners = new Map();
globalThis.window = {
  addEventListener(type, fn) { windowListeners.set(type, [...(windowListeners.get(type) || []), fn]); },
  removeEventListener(type, fn) { windowListeners.set(type, (windowListeners.get(type) || []).filter((f) => f !== fn)); },
};
globalThis.location = { protocol: 'https:', origin: 'https://maydan.test', pathname: '/', hash: '', assigned: '', assign(url) { this.assigned = url; } };
let fetchCalls = 0;
globalThis.fetch = async () => { fetchCalls += 1; throw new Error('لا شبكة في الاختبارات'); };

const root = process.cwd();
mkdirSync(path.join(root, '.cache'), { recursive: true });
const temp = mkdtempSync(path.join(root, '.cache', 'account-client-'));
after(() => rmSync(temp, { recursive: true, force: true }));

await build({
  stdin: {
    contents: `
      import React from 'react';
      import { renderToStaticMarkup } from 'react-dom/server';
      import * as store from './src/shared/account/store.js';
      import * as api from './src/shared/account/api.js';
      import * as native from './src/shared/account/native.js';
      import { AccountProvider } from './src/shared/account/AccountProvider.jsx';
      import { Paywall } from './src/shared/account/Paywall.jsx';
      import { NULL_ACCOUNT, useAccount } from './src/shared/account/context.js';
      export { store, api, native, NULL_ACCOUNT };
      function Probe() {
        const a = useAccount();
        return React.createElement('i', {
          'data-ready': String(a.ready), 'data-platform': a.platform, 'data-premium': String(a.premium),
          'data-signed': String(!!a.signedIn), 'data-auth': JSON.stringify(a.authHeaders()),
          'data-trials': JSON.stringify(a.trials || {}), 'data-locked': String(a.lockedPack('anime')),
        }, 'PROBE_TOKEN');
      }
      export const renderProvider = () => renderToStaticMarkup(React.createElement(AccountProvider, null, React.createElement(Probe)));
      export const renderBare = () => renderToStaticMarkup(React.createElement(Probe));
      export const renderPaywall = (props) => renderToStaticMarkup(React.createElement(Paywall, { open: true, onClose() {}, ...props }));
    `,
    resolveDir: root,
    loader: 'jsx',
  },
  outfile: path.join(temp, 'account.mjs'),
  bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic',
  loader: { '.js': 'jsx', '.css': 'text', '.json': 'json', '.webp': 'dataurl', '.png': 'dataurl', '.woff2': 'dataurl' },
  logLevel: 'silent',
});
const mod = await import(pathToFileURL(path.join(temp, 'account.mjs')).href);
const { store, api, native } = mod;

// ── store.js ────────────────────────────────────────────────────────────────
test('مخزن الحساب: ذهاب وإياب لكل مفتاح فوق مخزن في الذاكرة', () => {
  const backend = fakeStorage();
  const s = store.createAccountStore(backend);
  assert.equal(s.prefix, store.ACCOUNT_PREFIX);
  assert.equal(s.readSession(), null);

  s.writeSession('mdn1.0123456789abcdef.secret');
  assert.equal(s.readSession(), 'mdn1.0123456789abcdef.secret');

  assert.deepEqual(s.readMe(), { data: null, fetchedAt: 0 });
  s.writeMe({ user: { id: 'u1', name: 'ريم' }, premium: { until: 0 } }, 1234);
  assert.deepEqual(s.readMe(), { data: { user: { id: 'u1', name: 'ريم' }, premium: { until: 0 } }, fetchedAt: 1234 });

  assert.deepEqual(s.readTrials(), { marks: {}, pending: [] });
  s.addMark('beep');
  s.addMark('beep');
  s.addMark('لعبة-غير-موجودة');
  assert.deepEqual(s.readTrials().marks, { beep: true });
  s.addPending('mamnoo');
  s.addPending('mamnoo');
  assert.deepEqual(s.readTrials().pending, ['mamnoo']);
  s.clearPending(['mamnoo']);
  assert.deepEqual(s.readTrials().pending, []);

  // الخروج يمسح الجلسة والنسخة فقط: علامات هذا الجهاز تبقى فلا تُستعاد تجربة بالخروج.
  s.clearAuth();
  assert.equal(s.readSession(), null);
  assert.deepEqual(s.readMe(), { data: null, fetchedAt: 0 });
  assert.deepEqual(s.readTrials().marks, { beep: true });
});

test('مخزن الحساب: JSON تالف أو شكل غريب يعود إلى الشكل الافتراضي', () => {
  const backend = fakeStorage();
  const s = store.createAccountStore(backend);
  backend.setItem(`${store.ACCOUNT_PREFIX}trials`, '{{{ ليس JSON');
  assert.deepEqual(s.readTrials(), { marks: {}, pending: [] });
  backend.setItem(`${store.ACCOUNT_PREFIX}trials`, JSON.stringify({ marks: { beep: true, zzz: true }, pending: 'nope' }));
  assert.deepEqual(s.readTrials(), { marks: { beep: true }, pending: [] });
  backend.setItem(`${store.ACCOUNT_PREFIX}me`, '"نص لا كائن"');
  assert.deepEqual(s.readMe(), { data: null, fetchedAt: 0 });
  backend.setItem(`${store.ACCOUNT_PREFIX}session`, JSON.stringify({ token: 'x' }));
  assert.equal(s.readSession(), null);
});

test('مسح كل البيانات يحترم keep ويبقي مفاتيح الحساب', () => {
  const backend = fakeStorage();
  createStorage('platform', backend).set('roster', ['أ']);
  const account = store.createAccountStore(backend);
  account.writeSession('mdn1.a.b');
  account.addMark('beep');
  backend.setItem('other-app', '1');

  const removed = clearAllPlatformData({ keep: [store.ACCOUNT_PREFIX] });
  assert.equal(removed, 0, 'بلا localStorage حقيقي لا يُمسح شيء');
  assert.equal(clearAllPlatformData(backend, { keep: [store.ACCOUNT_PREFIX] }), 1);
  assert.equal(account.readSession(), 'mdn1.a.b');
  assert.deepEqual(account.readTrials().marks, { beep: true });
  assert.equal(backend.getItem('other-app'), '1');
  // بلا خيارات: السلوك القديم يمسح الحساب أيضًا.
  assert.equal(clearAllPlatformData(backend), 2);
  assert.equal(account.readSession(), null);
});

// ── api.js ──────────────────────────────────────────────────────────────────
const SERVER = 'https://api.test';
const fakeResponse = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (key) => headers[String(key).toLowerCase()] ?? null },
  json: async () => { if (body === undefined) throw new Error('لا جسم'); return body; },
});
const callWith = (status, body, headers, extra = {}) => api.request('/api/me', {
  server: SERVER, fetchImpl: async () => fakeResponse(status, body, headers), ...extra,
});

test('api: الحالات تُترجم إلى أكواد أخطاء الحساب', async () => {
  await assert.rejects(callWith(401, { error: 'AUTH_EXPIRED' }), (e) => e.code === 'AUTH_EXPIRED');
  await assert.rejects(callWith(401, {}), (e) => e.code === 'AUTH_REQUIRED');
  await assert.rejects(callWith(401, { error: 'SIGNATURE' }), (e) => e.code === 'SIGNATURE');
  await assert.rejects(callWith(402, { error: 'PLUS_REQUIRED' }), (e) => e.code === 'PLUS_REQUIRED');
  await assert.rejects(callWith(402, {}), (e) => e.code === 'PLUS_REQUIRED');
  await assert.rejects(callWith(429, {}), (e) => e.code === 'RATE_LIMIT');
  await assert.rejects(callWith(409, { error: 'ALREADY_LINKED' }), (e) => e.code === 'ALREADY_LINKED');
  await assert.rejects(callWith(500, undefined), (e) => e.code === 'NETWORK');
  await assert.rejects(api.request('/api/me', { server: SERVER, fetchImpl: async () => { throw new Error('انقطاع'); } }), (e) => e.code === 'NETWORK');
  // بلا خادم مضبوط: الطبقة «دون اتصال» ولا تحاول الشبكة أصلًا.
  await assert.rejects(api.request('/api/me', { server: '' }), (e) => e.code === 'OFFLINE');
  assert.equal(api.resolveAccountServer(), '', 'online.config.json فارغ في المستودع');
  assert.equal(api.accountOffline(), true);
});

test('api: الطلب مجهول ولا يُخزَّن، ويقرأ تدوير الجلسة', async () => {
  let seen = null;
  const result = await api.request('/api/trials/beep', {
    server: SERVER, method: 'POST', token: 'tok-1',
    fetchImpl: async (url, init) => { seen = { url, init }; return fakeResponse(200, { trials: { beep: true } }, { 'x-maydan-session': 'mdn1.new.token' }); },
    onSession: (token) => { seen.rotated = token; },
  });
  assert.deepEqual(result, { trials: { beep: true } });
  assert.equal(seen.url, `${SERVER}/api/trials/beep`);
  assert.equal(seen.init.credentials, 'omit');
  assert.equal(seen.init.cache, 'no-store');
  assert.equal(seen.init.headers.authorization, 'Bearer tok-1');
  assert.equal(seen.rotated, 'mdn1.new.token');

  // التدوير يُقرأ حتى مع خطأ (الخادم قد يدوّر ثم يرفض الطلب).
  let rotated = null;
  await assert.rejects(api.request('/api/me', {
    server: SERVER, fetchImpl: async () => fakeResponse(402, { error: 'PLUS_REQUIRED' }, { 'x-maydan-session': 'mdn1.rot.2' }),
    onSession: (t) => { rotated = t; },
  }), (e) => e.code === 'PLUS_REQUIRED');
  assert.equal(rotated, 'mdn1.rot.2');

  // 204 بلا جسم، و raw يعيد الاستجابة كما هي.
  assert.equal(await api.request('/api/auth/signout', { server: SERVER, method: 'POST', fetchImpl: async () => fakeResponse(204, undefined) }), null);
  const raw = await api.request('/api/account', { server: SERVER, method: 'DELETE', raw: true, fetchImpl: async () => fakeResponse(204, undefined) });
  assert.equal(raw.status, 204);
});

test('api: المهلة تُجهض الطلب وتعيد NETWORK، ورابط بدء الدخول يحمل return', async () => {
  await assert.rejects(api.request('/api/me', {
    server: SERVER, timeout: 5,
    fetchImpl: (url, init) => new Promise((_, reject) => { init.signal.addEventListener('abort', () => reject(new Error('aborted'))); }),
  }), (e) => e.code === 'NETWORK');

  const url = api.authStartUrl('google', { client: 'web', server: SERVER });
  assert.equal(url, `${SERVER}/api/auth/google/start?client=web&return=${encodeURIComponent('https://maydan.test/')}`);
  assert.equal(api.authStartUrl('apple', { client: 'ios', returnUrl: 'maydan://auth', server: SERVER }),
    `${SERVER}/api/auth/apple/start?client=ios&return=${encodeURIComponent('maydan://auth')}`);
  assert.equal(api.authStartUrl('apple', { server: '' }), '');
});

// ── native.js ───────────────────────────────────────────────────────────────
test('جسر الغلاف: وعد لكل نداء، ورفض بالكود، ومهلة تعيد NETWORK', async () => {
  const sent = [];
  globalThis.window.webkit = { messageHandlers: { maydan: { postMessage: (message) => sent.push(message) } } };
  globalThis.location.protocol = 'maydan:';
  try {
    native.installNativeBridge(globalThis.window);
    assert.equal(native.isNativeShell(), true);

    const products = native.callNative('products');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].type, 'products');
    assert.ok(sent[0].id, 'كل رسالة تحمل معرّفًا');
    globalThis.window.maydanNative.resolve(sent[0].id, { ok: true, result: [{ id: 'plus.monthly', price: '٢٫٩٩ $', period: 'شهريًا' }] });
    assert.equal((await products)[0].id, 'plus.monthly');

    const purchase = native.callNative('purchase', { productId: 'plus.monthly' });
    globalThis.window.maydanNative.resolve(sent[1].id, { ok: false, error: 'PURCHASE_CANCELLED' });
    await assert.rejects(purchase, (e) => e.code === 'PURCHASE_CANCELLED');

    await assert.rejects(native.callNative('restore', {}, { timeout: 5 }), (e) => e.code === 'NETWORK');

    // ردّ لمعرّف مجهول لا يرمي ولا يحلّ شيئًا.
    assert.equal(globalThis.window.maydanNative.resolve('لا-يوجد', { ok: true }), false);

    let received = null;
    const off = native.onNativeEvent('authReturn', (payload) => { received = payload; });
    globalThis.window.maydanNative.event('authReturn', { code: 'one-time-code' });
    assert.deepEqual(received, { code: 'one-time-code' });
    off();
    globalThis.window.maydanNative.event('authReturn', { code: 'ثانٍ' });
    assert.deepEqual(received, { code: 'one-time-code' }, 'الإلغاء يفصل المستمع');
  } finally {
    delete globalThis.window.webkit;
    globalThis.location.protocol = 'https:';
    native.resetNativeForTests();
  }
});

test('كشف الغلاف: الويب ليس غلافًا، و MaydanNative احتياط مقبول', () => {
  assert.equal(native.isNativeShell(), false);
  globalThis.window.webkit = { messageHandlers: { maydan: { postMessage: () => {} } } };
  assert.equal(native.isNativeShell(), false, 'الجسر وحده بلا مخطط maydan: لا يكفي');
  delete globalThis.window.webkit;
  globalThis.window.MaydanNative = { postMessage: () => {} };
  assert.equal(native.isNativeShell(), true);
  delete globalThis.window.MaydanNative;
  assert.equal(native.isNativeShell(), false);
});

// ── العميل المشترك: ترويسات الحساب على طلبات الغرف ──────────────────────────
test('post في online/client يقبل ترويسات إضافية دون كسر المستدعين القدامى', async () => {
  let seen = null;
  const fetchImpl = async (url, init) => { seen = { url, init }; return { ok: true, status: 200, json: async () => ({ code: '123456' }) }; };
  await post('https://rooms.test', '/api/rooms', { game: 'meenfina' }, { headers: { Authorization: 'Bearer tok' }, fetchImpl });
  assert.equal(seen.init.headers.Authorization, 'Bearer tok');
  assert.equal(seen.init.headers['content-type'], 'application/json');
  await post('https://rooms.test', '/api/rooms', {}, fetchImpl);
  assert.equal(seen.init.headers.Authorization, undefined, 'الشكل القديم (دالة fetch) يبقى يعمل');
  await assert.rejects(post('ftp://nope', '/api/rooms', {}, fetchImpl), (e) => e instanceof ClientError && e.code === 'CONFIG');
});

// ── التصيير ─────────────────────────────────────────────────────────────────
test('AccountProvider يصيّر أبناءه ويقدّم قيمة السياق كاملة بلا شبكة', () => {
  const before = fetchCalls;
  const html = mod.renderProvider();
  assert.match(html, /PROBE_TOKEN/);
  assert.match(html, /data-platform="web"/);
  assert.match(html, /data-premium="false"/);
  assert.match(html, /data-signed="false"/);
  assert.match(html, /data-auth="\{\}"/);
  assert.match(html, /data-trials="\{\}"/);
  assert.match(html, /data-locked="true"/, 'بلا اشتراك تبقى الحزم غير المجانية مقفولة');
  assert.equal(fetchCalls, before, 'التصيير وحده لا يلمس الشبكة');
});

test('NULL_ACCOUNT هو الافتراضي حين لا مزوّد: لا قفل ولا جدار', () => {
  const html = mod.renderBare();
  assert.match(html, /data-ready="true"/);
  assert.match(html, /data-locked="false"/);
  assert.equal(mod.NULL_ACCOUNT.lockedPack('anime'), false);
  assert.equal(mod.NULL_ACCOUNT.trialAvailable('beep'), true);
  assert.equal(mod.NULL_ACCOUNT.gameAccess('beep'), 'premium');
  assert.deepEqual(mod.NULL_ACCOUNT.authHeaders(), {});
});

test('الجدار يعرض السبب والخطتين والشروط وروابطها', () => {
  const html = mod.renderPaywall({ reason: 'trial', game: 'beep' });
  assert.match(html, /افتح كل ميدان مع ميدان بلس/);
  assert.match(html, /لعبت مباراتك المجانية في قبل ما يطق!/);
  for (const bullet of ['كل فئات بَديهة', 'مباريات بلا حدود', 'غرف جماعية بلا حدود', 'اشتراك واحد على كل أجهزتك']) assert.match(html, new RegExp(bullet));
  assert.match(html, /data-plan="monthly"/);
  assert.match(html, /data-plan="yearly"/);
  assert.match(html, /الأوفر/);
  assert.match(html, /يُعرض السعر عند الشراء/, 'بلا أسعار من المتجر يبقى السعر صادقًا');
  assert.match(html, /يتجدد الاشتراك تلقائيًا ما لم يُلغَ قبل نهاية الفترة/);
  assert.match(html, /data-legal="terms"[^>]*>شروط الاستخدام</);
  assert.match(html, /data-legal="privacy"[^>]*>سياسة الخصوصية</);
  // الويب وغير مسجّل: الدخول قبل الشراء مع سبب واضح.
  assert.match(html, /data-provider="apple"/);
  assert.match(html, /data-provider="google"/);
  assert.match(html, /الاشتراك يُربط بحسابك ليعمل على كل أجهزتك/);
  assert.doesNotMatch(html, /استعادة المشتريات/, 'الاستعادة لأجهزة iOS فقط');
});

test('نص السبب يتبدّل مع كل باب من أبواب الجدار', () => {
  assert.match(mod.renderPaywall({ reason: 'pack', pack: 'anime' }), /هذه الفئة ضمن ميدان بلس/);
  assert.match(mod.renderPaywall({ reason: 'room' }), /الدخول برمز مجاني دائمًا/);
  assert.match(mod.renderPaywall({ reason: 'resume' }), /هذه المباراة المحفوظة تحتوي فئات ضمن ميدان بلس/);
  const settings = mod.renderPaywall({ reason: 'settings' });
  assert.doesNotMatch(settings, /paywall-reason/, 'الفتح من الإعدادات بلا سطر سبب');
});
