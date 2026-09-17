// الحسابات و«ميدان بلس» داخل workerd الحقيقي مع D1 ومزوّدين وهميين محليين.
// كل مزوّد خارجي (آبل، جوجل، Paddle، App Store Server API) يُستبدل بخادم node
// عبر متغيّرات الروابط، فالاختبار لا يلمس الإنترنت ولا يحتاج أسرارًا حقيقية.
import test, { after, before } from 'node:test';
import { createHash } from 'node:crypto';
import { appleChain } from './helpers-apple.js';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { migrationSql } from '../server/local-d1.mjs';
import { PRODUCTS } from '../src/shared/account/config.js';

const ORIGIN = 'http://localhost:3000';
const BUNDLE_ID = 'com.maydan.app';
const b64u = (value) => Buffer.from(value).toString('base64url');
const encoder = new TextEncoder();

// JWS بلا توقيع معتبر: الخادم يفكّه كتلميح فقط ثم يسأل آبل عن الحقيقة.
// JWS آبل موقّعة بسلسلة الاختبار (x5c حتى جذر وهمي مثبّت في APPLE_ROOT_CA_SHA256).
const appleChainSigner = appleChain();
const hintJws = (payload) => appleChainSigner.sign(payload);

async function rsaSigner(kid) {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const exported = await crypto.subtle.exportKey('jwk', pair.publicKey);
  delete exported.key_ops; delete exported.ext;
  return {
    jwk: { ...exported, kid, alg: 'RS256', use: 'sig' },
    async sign(payload) {
      const input = `${b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }))}.${b64u(JSON.stringify(payload))}`;
      const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, encoder.encode(input));
      return `${input}.${Buffer.from(signature).toString('base64url')}`;
    },
  };
}
async function es256Pem() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const body = Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64');
  return `-----BEGIN PRIVATE KEY-----\n${body.replace(/(.{64})/g, '$1\n')}\n-----END PRIVATE KEY-----\n`;
}
async function paddleSignature(secret, timestamp, raw) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}:${raw}`));
  return `ts=${timestamp};h1=${Buffer.from(signature).toString('hex')}`;
}

// حالة اشتراك كما يردّها App Store Server API.
function appStoreStatus({ originalTransactionId, productId = PRODUCTS.monthly, status = 1, expiresDate,
  appAccountToken = null, bundleId = BUNDLE_ID, environment = 'Sandbox', autoRenewStatus = 1, signedDate = Date.now() }) {
  return { environment, bundleId, data: [{ subscriptionGroupIdentifier: 'group1', lastTransactions: [{
    originalTransactionId, status,
    signedTransactionInfo: hintJws({ bundleId, productId, originalTransactionId, transactionId: `${originalTransactionId}-1`,
      expiresDate, environment, signedDate, ...(appAccountToken ? { appAccountToken } : {}) }),
    signedRenewalInfo: hintJws({ autoRenewStatus, autoRenewProductId: productId }),
  }] }] };
}

// ── المزوّدون الوهميون ───────────────────────────────────────────────────────
function startProviders(state) {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://providers');
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      state.calls.push({ method: request.method, path: url.pathname, body, auth: request.headers.authorization || null });
      const send = (status, value) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(value)); };
      if (url.pathname === '/apple/keys') return send(200, { keys: [state.appleJwk] });
      if (url.pathname === '/google/keys') return send(200, { keys: [state.googleJwk] });
      if (url.pathname === '/apple/token') return send(200, { access_token: 'apple_access', refresh_token: state.appleRefreshToken });
      if (url.pathname === '/apple/revoke') { state.revoked.push(new URLSearchParams(body).get('token')); return send(200, {}); }
      if (url.pathname === '/google/token') {
        const code = new URLSearchParams(body).get('code');
        const token = state.googleTokens.get(code);
        return token ? send(200, { id_token: token, access_token: 'g' }) : send(400, { error: 'invalid_grant' });
      }
      const appstore = /^\/appstore\/inApps\/v1\/subscriptions\/(.+)$/.exec(url.pathname);
      if (appstore) {
        const found = state.subscriptions.get(decodeURIComponent(appstore[1]));
        return found ? send(200, found) : send(404, { errorCode: 4040010 });
      }
      if (url.pathname === '/paddle/customers' && request.method === 'POST') return send(201, { data: { id: 'ctm_test_1' } });
      if (url.pathname === '/paddle/transactions' && request.method === 'POST') {
        state.transactions.push(JSON.parse(body || '{}'));
        return send(201, { data: { id: 'txn_test_1', status: 'ready' } });
      }
      if (/^\/paddle\/customers\/[^/]+\/portal-sessions$/.test(url.pathname)) {
        return send(201, { data: { urls: { general: { overview: 'https://sandbox-customer-portal.paddle.com/cpl_1' } } } });
      }
      if (/^\/paddle\/subscriptions\/[^/]+\/cancel$/.test(url.pathname)) { state.cancelled.push(url.pathname); return send(200, { data: { status: 'canceled' } }); }
      return send(404, { error: 'not_found' });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` })));
}

// ── التهيئة ─────────────────────────────────────────────────────────────────
let mf; let dir; let providers; let origin; let d1;
const state = {
  calls: [], revoked: [], transactions: [], cancelled: [],
  subscriptions: new Map(), googleTokens: new Map(),
  appleRefreshToken: 'apple_refresh_test', appleJwk: null, googleJwk: null,
};
let apple; let google;

before(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'maydan-accounts-'));
  const scriptPath = path.join(dir, 'worker.mjs');
  await build({ entryPoints: ['server/worker.mjs'], bundle: true, format: 'esm', platform: 'browser', outfile: scriptPath, logLevel: 'silent' });
  apple = await rsaSigner('apple-key-1');
  google = await rsaSigner('google-key-1');
  state.appleJwk = apple.jwk; state.googleJwk = google.jwk;
  providers = await startProviders(state);
  const [signinPem, iapPem] = await Promise.all([es256Pem(), es256Pem()]);
  mf = new Miniflare(convertV4MiniflareOptions({
    rootPath: dir, name: 'maydan-accounts', modules: true, scriptPath, compatibilityDate: '2026-09-01',
    durableObjects: { ROOMS: { className: 'Room', useSQLite: true }, LIMITERS: { className: 'RequestLimiter', useSQLite: true } },
    d1Databases: { DB: 'maydan-accounts' },
    bindings: {
      ALLOWED_ORIGINS: ORIGIN, APP_ORIGIN: ORIGIN, EXTRA_ORIGINS: 'maydan://app',
      SESSION_SECRET: 'test-session-secret', AUTH_DEV_FAKE: '1',
      APPLE_BUNDLE_ID: BUNDLE_ID, APPLE_SERVICES_ID: 'com.maydan.web',
      APPLE_TEAM_ID: 'TEAM000000', APPLE_SIGNIN_KEY_ID: 'SIGNKEY1', APPLE_SIGNIN_PRIVATE_KEY: signinPem,
      APPLE_IAP_ISSUER_ID: 'issuer-0000', APPLE_IAP_KEY_ID: 'IAPKEY1', APPLE_IAP_PRIVATE_KEY: iapPem,
      APPLE_AUTH_URL: `${providers.url}/apple/authorize`, APPLE_TOKEN_URL: `${providers.url}/apple/token`,
      APPLE_JWKS_URL: `${providers.url}/apple/keys`, APPLE_REVOKE_URL: `${providers.url}/apple/revoke`,
      APPLE_STORE_API_URL: `${providers.url}/appstore`, APPLE_ROOT_CA_SHA256: appleChainSigner.rootSha256,
      REDEEM_CODE_HASHES: createHash('sha256').update('EXTRACODE').digest('hex'),
      GOOGLE_CLIENT_ID: 'google-client-id', GOOGLE_CLIENT_SECRET: 'google-client-secret',
      GOOGLE_AUTH_URL: `${providers.url}/google/authorize`, GOOGLE_TOKEN_URL: `${providers.url}/google/token`,
      GOOGLE_JWKS_URL: `${providers.url}/google/keys`,
      PADDLE_ENV: 'sandbox', PADDLE_CLIENT_TOKEN: 'test_client_token', PADDLE_API_KEY: 'pdl_api_key',
      PADDLE_WEBHOOK_SECRET: 'pdl_webhook_secret', PADDLE_PRICE_MONTHLY: 'pri_monthly', PADDLE_PRICE_YEARLY: 'pri_yearly',
      PADDLE_API_URL: `${providers.url}/paddle`,
    },
    port: 0, host: '127.0.0.1', cf: false,
  }));
  origin = (await mf.ready).origin;
  d1 = await mf.getD1Database('DB');
  await d1.exec(migrationSql());
});
after(async () => {
  if (mf) await mf.dispose();
  if (providers) await new Promise((resolve) => providers.server.close(resolve));
  if (dir) await rm(dir, { recursive: true, force: true });
});

// عنوان متصل مختلف لكل قسم كي لا تتزاحم أقسام الاختبار على حصّة واحدة.
let addressCounter = 0;
function client(session = null) {
  const address = `10.0.0.${++addressCounter}`;
  const state_ = { token: session };
  const call = async (method, endpoint, { body, headers = {}, raw, redirect = 'manual' } = {}) => {
    const all = { origin: ORIGIN, 'cf-connecting-ip': address, ...headers };
    if (body !== undefined && !raw) all['content-type'] = 'application/json';
    if (state_.token) all.authorization = `Bearer ${state_.token}`;
    const response = await fetch(origin + endpoint, {
      method, headers: all, redirect,
      ...(body === undefined ? {} : { body: raw ? body : JSON.stringify(body) }),
    });
    const rotated = response.headers.get('x-maydan-session');
    if (rotated) state_.token = rotated;
    const text = await response.text();
    let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: response.status, data, headers: response.headers, rotated };
  };
  return {
    address, state: state_,
    get token() { return state_.token; },
    set token(value) { state_.token = value; },
    get: (endpoint, options) => call('GET', endpoint, options),
    post: (endpoint, body, options) => call('POST', endpoint, { body, ...options }),
    del: (endpoint, options) => call('DELETE', endpoint, options),
  };
}
const credentials = () => ({
  id: crypto.randomUUID().replace(/-/g, ''),
  token: Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join(''),
});
async function signInDev(subject, name = 'لاعب') {
  const api = client();
  const created = await api.post('/api/auth/dev', { subject, name });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  api.token = created.data.session.token;
  return { api, me: created.data.me, userId: created.data.me.user.id };
}

// ── الاختبارات ──────────────────────────────────────────────────────────────
test('إعداد الفوترة يعلن Paddle والمزوّدين المتاحين', { timeout: 30_000 }, async () => {
  const { status, data } = await client().get('/api/billing/config');
  assert.equal(status, 200);
  assert.deepEqual(data.products, PRODUCTS);
  assert.deepEqual(data.paddle, { clientToken: 'test_client_token', environment: 'sandbox', prices: { monthly: 'pri_monthly', yearly: 'pri_yearly' } });
  assert.deepEqual(data.providers, { apple: true, google: true, dev: true });
});

test('الأصل المجهول يُرفض، ومسارات المزوّد العامة معفاة منه', { timeout: 30_000 }, async () => {
  const blocked = await fetch(`${origin}/api/me`, { headers: { origin: 'https://evil.example' } });
  assert.equal(blocked.status, 403);
  assert.equal((await blocked.json()).error, 'ORIGIN');
  // بلا Origin أصلًا: إعادة توجيه المزوّد تصل هكذا من المتصفح.
  const start = await fetch(`${origin}/api/auth/google/start?client=web&return=${encodeURIComponent(ORIGIN)}`, { redirect: 'manual' });
  assert.equal(start.status, 302);
  const preflight = await fetch(`${origin}/api/me`, { method: 'OPTIONS', headers: { origin: ORIGIN } });
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get('access-control-allow-headers'), /Authorization/);
  assert.equal(preflight.headers.get('access-control-expose-headers'), 'x-maydan-session');
});

test('تدفق جوجل كامل: state ثم رمز لمرة واحدة ثم جلسة و/api/me', { timeout: 30_000 }, async () => {
  const api = client();
  const started = await api.get(`/api/auth/google/start?client=web&return=${encodeURIComponent(`${ORIGIN}/`)}`);
  assert.equal(started.status, 302);
  const authorize = new URL(started.headers.get('location'));
  assert.equal(authorize.origin + authorize.pathname, `${providers.url}/google/authorize`);
  assert.equal(authorize.searchParams.get('client_id'), 'google-client-id');
  assert.equal(authorize.searchParams.get('redirect_uri'), `${origin}/api/auth/google/callback`);
  const state_ = authorize.searchParams.get('state');
  const nonce = authorize.searchParams.get('nonce');
  assert.ok(state_ && nonce);

  const issued = Math.floor(Date.now() / 1000);
  state.googleTokens.set('code-google-1', await google.sign({
    iss: 'https://accounts.google.com', aud: 'google-client-id', sub: 'google-sub-1',
    email: 'player@example.com', email_verified: true, name: 'لاعب جوجل', nonce, iat: issued, exp: issued + 600,
  }));
  const callback = await api.get(`/api/auth/google/callback?code=code-google-1&state=${encodeURIComponent(state_)}`);
  assert.equal(callback.status, 302);
  const location = callback.headers.get('location');
  assert.ok(location.startsWith(`${ORIGIN}/#/auth?code=`), location);
  const code = new URL(location.replace('#/auth?', '?')).searchParams.get('code');

  const exchanged = await api.post('/api/auth/exchange', { code, client: 'web' });
  assert.equal(exchanged.status, 200, JSON.stringify(exchanged.data));
  assert.match(exchanged.data.session.token, /^mdn1\.[a-f0-9]{16}\.[A-Za-z0-9_-]{43}$/);
  assert.equal(exchanged.data.me.user.email, 'player@example.com');
  assert.equal(exchanged.data.me.user.name, 'لاعب جوجل');
  assert.equal(exchanged.data.me.premium.active, false);

  // الرمز لمرة واحدة فقط.
  const replay = await api.post('/api/auth/exchange', { code, client: 'web' });
  assert.equal(replay.status, 400);
  assert.equal(replay.data.error, 'STATE');

  // state مزوّر أو منتهٍ يُرفض قبل أي نداء للمزوّد.
  const forged = await api.get('/api/auth/google/callback?code=code-google-1&state=abc.def');
  assert.equal(forged.data.error, 'STATE');

  api.token = exchanged.data.session.token;
  const me = await api.get('/api/me');
  assert.equal(me.status, 200);
  assert.equal(me.data.user.id, exchanged.data.me.user.id);
  assert.ok(me.data.serverTime > 0);
  // وجهة عودة خارج الأصول المسموحة تُرفض.
  const bad = await api.get(`/api/auth/google/start?client=web&return=${encodeURIComponent('https://evil.example/x')}`);
  assert.equal(bad.data.error, 'STATE');
});

test('تدفق آبل على الويب: form_post ثم رمز لمرة واحدة', { timeout: 30_000 }, async () => {
  const api = client();
  const started = await api.get(`/api/auth/apple/start?client=web&return=${encodeURIComponent(ORIGIN)}`);
  assert.equal(started.status, 302);
  const authorize = new URL(started.headers.get('location'));
  assert.equal(authorize.origin + authorize.pathname, `${providers.url}/apple/authorize`);
  assert.equal(authorize.searchParams.get('response_mode'), 'form_post');
  assert.equal(authorize.searchParams.get('client_id'), 'com.maydan.web');
  const state_ = authorize.searchParams.get('state');
  const nonce = authorize.searchParams.get('nonce');

  const issued = Math.floor(Date.now() / 1000);
  const form = new URLSearchParams({
    state: state_, code: 'apple-web-code',
    id_token: await apple.sign({ iss: 'https://appleid.apple.com', aud: 'com.maydan.web', sub: 'apple-web-1',
      email: 'web@example.com', email_verified: true, nonce, iat: issued, exp: issued + 600 }),
    user: JSON.stringify({ name: { firstName: 'نورة', lastName: 'القحطاني' } }),
  });
  const callback = await api.post('/api/auth/apple/callback', String(form),
    { raw: true, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(callback.status, 302);
  const location = callback.headers.get('location');
  assert.ok(location.startsWith(`${ORIGIN}/#/auth?code=`), location); // العودة تُطبَّع إلى أصل + مسار
  const code = new URL(location.replace('#/auth?', '?')).searchParams.get('code');
  const exchanged = await api.post('/api/auth/exchange', { code, client: 'web' });
  assert.equal(exchanged.status, 200, JSON.stringify(exchanged.data));
  assert.equal(exchanged.data.me.user.name, 'نورة القحطاني');
  assert.equal(exchanged.data.me.user.email, 'web@example.com');

  // state مستعمل مع مزوّد آخر لا يصلح هنا.
  const crossed = await api.get(`/api/auth/google/start?client=web&return=${encodeURIComponent(ORIGIN)}`);
  const googleState = new URL(crossed.headers.get('location')).searchParams.get('state');
  const wrong = await api.post('/api/auth/apple/callback', String(new URLSearchParams({ state: googleState, id_token: 'x' })),
    { raw: true, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(wrong.data.error, 'STATE');
});

test('دخول آبل الأصلي عبر identityToken يُصدر جلسة مباشرة', { timeout: 30_000 }, async () => {
  const api = client();
  const issued = Math.floor(Date.now() / 1000);
  const identityToken = await apple.sign({
    iss: 'https://appleid.apple.com', aud: BUNDLE_ID, sub: 'apple-sub-native-1',
    email: 'ios@example.com', email_verified: true, iat: issued, exp: issued + 600,
  });
  const created = await api.post('/api/auth/apple/native', {
    identityToken, authorizationCode: 'apple-code-1', fullName: { givenName: 'سالم', familyName: 'العتيبي' }, client: 'ios',
  });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  assert.equal(created.data.me.user.name, 'سالم العتيبي');
  assert.equal(created.data.me.user.email, 'ios@example.com');
  // رمز التحديث خُزِّن كي نستطيع إبطاله عند حذف الحساب.
  const stored = await d1.prepare('SELECT refresh_token FROM identities WHERE provider = ? AND subject = ?').bind('apple', 'apple-sub-native-1').first();
  assert.equal(stored.refresh_token, state.appleRefreshToken);

  // الدخول ثانيةً بالهوية نفسها لا يُنشئ حسابًا ثانيًا.
  const again = await api.post('/api/auth/apple/native', { identityToken, client: 'ios' });
  assert.equal(again.data.me.user.id, created.data.me.user.id);

  // توقيع لا يطابق JWKS يُرفض.
  const rogue = await rsaSigner('apple-key-1');
  const forged = await api.post('/api/auth/apple/native', {
    identityToken: await rogue.sign({ iss: 'https://appleid.apple.com', aud: BUNDLE_ID, sub: 'intruder', iat: issued, exp: issued + 600 }),
    client: 'ios',
  });
  assert.equal(forged.status, 401);
  assert.equal(forged.data.error, 'SIGNATURE');
});

test('تدوير الجلسة بترويسة x-maydan-session، والخروج يُبطلها', { timeout: 30_000 }, async () => {
  const { api } = await signInDev('rotate-user');
  const before_ = api.token;
  const sessionId = before_.split('.')[1];
  await d1.prepare('UPDATE sessions SET last_seen = ? WHERE id = ?').bind(Date.now() - 3 * 24 * 60 * 60 * 1000, sessionId).run();
  const rotated = await api.get('/api/me');
  assert.equal(rotated.status, 200);
  assert.ok(rotated.rotated, 'انتظرنا ترويسة تدوير');
  assert.notEqual(rotated.rotated, before_);
  assert.equal(api.token, rotated.rotated);

  // الرمز الجديد يعمل، والقديم يبقى صالحًا في فترة السماح.
  assert.equal((await api.get('/api/me')).status, 200);
  const old = client(before_);
  assert.equal((await old.get('/api/me')).status, 200);
  assert.equal(old.rotated, undefined);

  assert.equal((await api.post('/api/auth/signout', {})).status, 204);
  const after_ = await api.get('/api/me');
  assert.equal(after_.status, 401);
  assert.equal(after_.data.error, 'AUTH_EXPIRED');
  // بلا رمز أصلًا: AUTH_REQUIRED لا AUTH_EXPIRED.
  assert.equal((await client().get('/api/me')).data.error, 'AUTH_REQUIRED');
  // رمز بمعرّف مجهول يُعامل كمنتهٍ.
  assert.equal((await client('mdn1.00000000deadbeef.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA').get('/api/me')).data.error, 'AUTH_EXPIRED');
});

test('التجارب: إضافة ودمج، ولعبة خارج القائمة تُرفض', { timeout: 30_000 }, async () => {
  const { api, userId } = await signInDev('trials-user');
  const first = await api.post('/api/trials/beep', {});
  assert.equal(first.status, 200);
  assert.deepEqual(first.data.trials, { beep: true });
  assert.equal((await api.post('/api/trials/beep', {})).status, 200); // إعادة الإدخال لا تُخطئ
  const merged = await api.post('/api/trials/merge', { games: ['mamnoo', 'jabeen', 'badeeha', 'beep'] });
  assert.deepEqual(merged.data.trials, { beep: true, mamnoo: true, jabeen: true });
  assert.equal((await api.post('/api/trials/nope', {})).status, 404);
  const rows = await d1.prepare('SELECT count(*) AS n FROM trials WHERE user_id = ?').bind(userId).first();
  assert.equal(rows.n, 3);
  const me = await api.get('/api/me');
  assert.deepEqual(me.data.trials, { beep: true, mamnoo: true, jabeen: true });
});

test('إنشاء الغرف: مجاني للمجهول، مباراة واحدة للمسجّل، مفتوح للمشترك', { timeout: 30_000 }, async () => {
  const anonymous = client();
  const anon = await anonymous.post('/api/rooms', { ...credentials(), name: 'ضيف', avatar: 0, rounds: 5, game: 'meenfina' });
  assert.equal(anon.status, 201, JSON.stringify(anon.data));

  const { api, userId } = await signInDev('rooms-user');
  const created = await api.post('/api/rooms', { ...credentials(), name: 'مضيف', avatar: 1, rounds: 5, game: 'meenfina' });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  // الإنشاء سجّل التجربة على الخادم.
  assert.deepEqual((await api.get('/api/me')).data.trials, { meenfina: true });

  const second = await api.post('/api/rooms', { ...credentials(), name: 'مضيف', avatar: 1, rounds: 5, game: 'meenfina' });
  assert.equal(second.status, 402);
  assert.equal(second.data.error, 'PLUS_REQUIRED');
  // لعبة أخرى ما زالت مجانية مرة واحدة.
  const other = await api.post('/api/rooms', { ...credentials(), name: 'مضيف', avatar: 1, rounds: 5, game: 'fabraka' });
  assert.equal(other.status, 201, JSON.stringify(other.data));

  // منح اشتراك يفتح الإنشاء من جديد.
  const granted = await api.post('/api/dev/grant', { until: Date.now() + 30 * 24 * 60 * 60 * 1000 });
  assert.equal(granted.status, 200);
  assert.equal(granted.data.premium.active, true);
  assert.equal(granted.data.premium.source, 'paddle');
  const premiumRoom = await api.post('/api/rooms', { ...credentials(), name: 'مضيف', avatar: 1, rounds: 5, game: 'meenfina' });
  assert.equal(premiumRoom.status, 201, JSON.stringify(premiumRoom.data));

  // الدخول إلى غرفة قائمة مجاني دائمًا، ويقبل ترويسة Bearer ويتجاهلها.
  const guest = credentials();
  const joined = await api.post(`/api/rooms/${premiumRoom.data.code}/join`, { ...guest, name: 'ضيف مسجّل', avatar: 2 });
  assert.equal(joined.status, 200, JSON.stringify(joined.data));

  // سحب الاشتراك يعيد القفل، والمجهول لا يتأثر بشيء من هذا.
  await d1.prepare('UPDATE subscriptions SET until = 0, status = ? WHERE user_id = ?').bind('canceled', userId).run();
  const refused = await api.post('/api/rooms', { ...credentials(), name: 'مضيف', avatar: 1, rounds: 5, game: 'meenfina' });
  assert.equal(refused.status, 402);
  assert.deepEqual(refused.data, { error: 'PLUS_REQUIRED' }); // العميل يقرأ الكود من الجسم
  assert.equal((await anonymous.post('/api/rooms', { ...credentials(), name: 'ضيف', avatar: 0, rounds: 5, game: 'meenfina' })).status, 201);

  // رمز جلسة تالف لا يمنع إنشاء غرفة: صاحبه يُعامل ضيفًا.
  const stale = client('mdn1.1111111111111111.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB');
  assert.equal((await stale.post('/api/rooms', { ...credentials(), name: 'ضيف', avatar: 0, rounds: 5, game: 'meenfina' })).status, 201);
});

test('Paddle: المعاملة تحمل custom_data.userId، والبوابة تُعيد رابطًا', { timeout: 30_000 }, async () => {
  const { api, userId } = await signInDev('paddle-user', 'مشترك');
  const checkout = await api.post('/api/paddle/checkout', { plan: 'yearly' });
  assert.equal(checkout.status, 200, JSON.stringify(checkout.data));
  assert.deepEqual(checkout.data, { transactionId: 'txn_test_1', clientToken: 'test_client_token', environment: 'sandbox' });
  const sent = state.transactions.at(-1);
  assert.deepEqual(sent.custom_data, { userId });
  assert.deepEqual(sent.items, [{ price_id: 'pri_yearly', quantity: 1 }]);
  assert.equal(sent.customer_id, 'ctm_test_1');

  assert.equal((await api.post('/api/paddle/checkout', { plan: 'lifetime' })).data.error, 'INVALID');
  // قواعد آبل: لا شراء ويب من داخل التطبيق.
  assert.equal((await api.post('/api/paddle/checkout', { plan: 'monthly', client: 'ios' })).data.error, 'NOT_ELIGIBLE');

  const portal = await api.get('/api/paddle/portal');
  assert.equal(portal.status, 200);
  assert.match(portal.data.url, /^https:\/\/sandbox-customer-portal\.paddle\.com\//);

  // اشتراك مدفوع سارٍ يمنع معاملة ثانية (لا فوترة مزدوجة)؛ رمز الهدية وحده لا يمنع.
  await api.post('/api/dev/grant', { until: Date.now() + 30 * 86_400_000, source: 'paddle' });
  const again = await api.post('/api/paddle/checkout', { plan: 'monthly' });
  assert.equal(again.status, 409);
  assert.equal(again.data.error, 'ALREADY_SUBSCRIBED');
  await api.post('/api/dev/grant', { until: 0, source: 'paddle' }); // انتهى → يُسمح من جديد
  assert.equal((await api.post('/api/paddle/checkout', { plan: 'monthly' })).status, 200);
  const promoOnly = await signInDev('paddle-promo', 'هدية');
  assert.equal((await promoOnly.api.post('/api/redeem', { code: '1121998' })).status, 200);
  assert.equal((await promoOnly.api.post('/api/paddle/checkout', { plan: 'monthly' })).status, 200, 'المفعَّل بالرمز يستطيع الشراء');
});

test('webhook باديل: توقيع صالح يفعّل الاشتراك، ومزوّر أو مكرّر يُرفض', { timeout: 30_000 }, async () => {
  const { api, userId } = await signInDev('webhook-user');
  const until = Date.now() + 31 * 24 * 60 * 60 * 1000;
  const event = {
    event_id: 'evt_1', event_type: 'subscription.activated', occurred_at: new Date().toISOString(),
    data: { id: 'sub_test_1', status: 'active', customer_id: 'ctm_webhook_1', custom_data: { userId },
      items: [{ price: { id: 'pri_monthly' } }], current_billing_period: { ends_at: new Date(until).toISOString() } },
  };
  const raw = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const hook = client();
  const options = { raw: true, headers: { 'content-type': 'application/json' } };

  const forged = await hook.post('/api/paddle/webhook', raw, { ...options, headers: { ...options.headers, 'paddle-signature': `ts=${timestamp};h1=${'0'.repeat(64)}` } });
  assert.equal(forged.status, 401);
  assert.equal(forged.data.error, 'SIGNATURE');
  // توقيع صحيح لكن خارج نافذة الخمس دقائق.
  const old = await hook.post('/api/paddle/webhook', raw, { ...options, headers: { ...options.headers, 'paddle-signature': await paddleSignature('pdl_webhook_secret', timestamp - 600, raw) } });
  assert.equal(old.data.error, 'SIGNATURE');

  const signature = await paddleSignature('pdl_webhook_secret', timestamp, raw);
  const accepted = await hook.post('/api/paddle/webhook', raw, { ...options, headers: { ...options.headers, 'paddle-signature': signature } });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.data));
  const me = await api.get('/api/me');
  assert.equal(me.data.premium.active, true);
  assert.equal(me.data.premium.source, 'paddle');
  assert.equal(me.data.premium.willRenew, true);
  assert.equal(me.data.premium.until, until);
  const stored = await d1.prepare('SELECT product FROM subscriptions WHERE source = ? AND external_id = ?').bind('paddle', 'sub_test_1').first();
  assert.equal(stored.product, PRODUCTS.monthly);

  // إعادة الإرسال بالحدث نفسه لا تُطبَّق مرتين.
  const duplicate = await hook.post('/api/paddle/webhook', raw, { ...options, headers: { ...options.headers, 'paddle-signature': signature } });
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.data.duplicate, true);
  const rows = await d1.prepare('SELECT count(*) AS n FROM subscriptions WHERE user_id = ?').bind(userId).first();
  assert.equal(rows.n, 1);

  // إلغاء لاحق: الحالة تتبع آخر حدث زمنيًا.
  const cancelEvent = { ...event, event_id: 'evt_2', event_type: 'subscription.updated',
    occurred_at: new Date(Date.now() + 1000).toISOString(),
    data: { ...event.data, scheduled_change: { action: 'cancel', effective_at: new Date(until).toISOString() } } };
  const cancelRaw = JSON.stringify(cancelEvent);
  const cancelTs = Math.floor(Date.now() / 1000);
  const cancelled = await hook.post('/api/paddle/webhook', cancelRaw, { ...options, headers: { ...options.headers, 'paddle-signature': await paddleSignature('pdl_webhook_secret', cancelTs, cancelRaw) } });
  assert.equal(cancelled.status, 200);
  const afterCancel = await api.get('/api/me');
  assert.equal(afterCancel.data.premium.willRenew, false);
  assert.equal(afterCancel.data.premium.active, true); // الاشتراك يسري حتى نهاية الفترة

  // حدث أقدم يصل متأخرًا لا يُرجع willRenew إلى true.
  const stale = { ...event, event_id: 'evt_0', occurred_at: new Date(Date.now() - 60_000).toISOString() };
  const staleRaw = JSON.stringify(stale);
  const staleTs = Math.floor(Date.now() / 1000);
  await hook.post('/api/paddle/webhook', staleRaw, { ...options, headers: { ...options.headers, 'paddle-signature': await paddleSignature('pdl_webhook_secret', staleTs, staleRaw) } });
  assert.equal((await api.get('/api/me')).data.premium.willRenew, false);
});

test('معاملات آبل: ربط، تكرار، وحساب آخر يُرفض بـALREADY_LINKED', { timeout: 30_000 }, async () => {
  const owner = await signInDev('apple-owner');
  const other = await signInDev('apple-other');
  const until = Date.now() + 30 * 24 * 60 * 60 * 1000;
  state.subscriptions.set('2000000111', appStoreStatus({
    originalTransactionId: '2000000111', expiresDate: until, appAccountToken: owner.userId.toUpperCase(),
  }));
  const jws = hintJws({ originalTransactionId: '2000000111', transactionId: '2000000111', bundleId: BUNDLE_ID, productId: PRODUCTS.monthly });

  const bound = await owner.api.post('/api/apple/transactions', { jws });
  assert.equal(bound.status, 200, JSON.stringify(bound.data));
  assert.equal(bound.data.premium.active, true);
  assert.equal(bound.data.premium.source, 'apple');
  assert.equal(bound.data.premium.until, until);
  assert.equal(bound.data.premium.willRenew, true);
  // الرمز الموقّع بـES256 الذي يُرسل إلى آبل يحمل معرّف الحزمة.
  const storeCall = state.calls.filter((entry) => entry.path.startsWith('/appstore/')).at(-1);
  assert.ok(storeCall.auth.startsWith('Bearer '));
  const claims = JSON.parse(Buffer.from(storeCall.auth.split('.')[1], 'base64url').toString());
  assert.equal(claims.bid, BUNDLE_ID);
  assert.equal(claims.aud, 'appstoreconnect-v1');
  assert.equal(claims.iss, 'issuer-0000');

  // التكرار لا ينشئ صفًّا ثانيًا.
  assert.equal((await owner.api.post('/api/apple/transactions', { jws })).status, 200);
  const rows = await d1.prepare('SELECT count(*) AS n FROM subscriptions WHERE source = ? AND external_id = ?').bind('apple', '2000000111').first();
  assert.equal(rows.n, 1);

  // حساب آخر يحاول ادّعاء المعاملة نفسها.
  const stolen = await other.api.post('/api/apple/transactions', { jws });
  assert.equal(stolen.status, 409);
  assert.equal(stolen.data.error, 'ALREADY_LINKED');
  assert.equal((await other.api.get('/api/me')).data.premium.active, false);

  // معاملة لا تعرفها آبل، ومنتج خارج «ميدان بلس».
  const unknown = await owner.api.post('/api/apple/transactions', { jws: hintJws({ originalTransactionId: '9999' }) });
  assert.equal(unknown.data.error, 'NOT_ELIGIBLE');
  state.subscriptions.set('2000000222', appStoreStatus({ originalTransactionId: '2000000222', productId: 'plus.lifetime', expiresDate: until }));
  const wrongProduct = await owner.api.post('/api/apple/transactions', { jws: hintJws({ originalTransactionId: '2000000222' }) });
  assert.equal(wrongProduct.data.error, 'NOT_ELIGIBLE');

  // إشعار App Store V2: يُعاد الجلب من آبل، ويُرفض المكرر بـnotificationUUID.
  const renewed = until + 30 * 24 * 60 * 60 * 1000;
  state.subscriptions.set('2000000111', appStoreStatus({
    originalTransactionId: '2000000111', expiresDate: renewed, appAccountToken: owner.userId, signedDate: Date.now() + 1000,
  }));
  const notification = hintJws({ notificationType: 'DID_RENEW', notificationUUID: 'uuid-1', version: '2.0',
    data: { bundleId: BUNDLE_ID, environment: 'Sandbox', signedTransactionInfo: hintJws({ originalTransactionId: '2000000111' }) } });
  const hook = client();
  assert.equal((await hook.post('/api/apple/notifications', { signedPayload: notification })).status, 200);
  assert.equal((await owner.api.get('/api/me')).data.premium.until, renewed);
  const replayed = await hook.post('/api/apple/notifications', { signedPayload: notification });
  assert.equal(replayed.data.duplicate, true);
  // إشعار لمعاملة لا نعرفها يُقبَل بلا أثر.
  const unrelated = hintJws({ notificationType: 'SUBSCRIBED', notificationUUID: 'uuid-2',
    data: { signedTransactionInfo: hintJws({ originalTransactionId: '7777777' }) } });
  assert.equal((await hook.post('/api/apple/notifications', { signedPayload: unrelated })).status, 202);
});

test('رمز الهدية: يفعّل بلس للمسجّل ويفتح الغرف، ويرفض الخطأ والمجهول', { timeout: 30_000 }, async () => {
  const { api } = await signInDev('redeem-1', 'هدية');
  const wrong = await api.post('/api/redeem', { code: '0000000' });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.data.error, 'REDEEM_INVALID');
  const anonymous = await client().post('/api/redeem', { code: '1121998' });
  assert.equal(anonymous.status, 401);
  const ok = await api.post('/api/redeem', { code: ' ١١٢١٩٩٨ ' });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.premium.active, true);
  assert.equal(ok.data.premium.source, 'promo');
  assert.equal(ok.data.premium.willRenew, false);
  assert.ok(ok.data.premium.until > Date.now() + 50 * 365 * 86_400_000, 'دائم عمليًا');
  const again = await api.post('/api/redeem', { code: '1121998' });
  assert.equal(again.status, 200, 'إعادة التفعيل آمنة');
  const me = await api.get('/api/me');
  assert.equal(me.data.premium.source, 'promo');
  // بصمة إضافية من البيئة تُقبل أيضًا (سرّ REDEEM_CODE_HASHES).
  const extra = await api.post('/api/redeem', { code: 'extra-code' });
  assert.equal(extra.status, 200, JSON.stringify(extra.data));
  // المشترك بالرمز ينشئ غرفًا بلا حدود حتى بعد استهلاك التجربة.
  const marked = await api.post('/api/trials/fabraka', {});
  assert.equal(marked.status, 200, JSON.stringify(marked.data));
  assert.equal(marked.data.trials.fabraka, true, 'التجربة مستهلكة فعلًا قبل فحص التجاوز');
  const room = await api.post('/api/rooms', { ...credentials(), game: 'fabraka', name: 'هدية', avatar: 0, rounds: 6 });
  assert.equal(room.status, 201, JSON.stringify(room.data));
  // جسم غير نصي يُرفض، والرمز نفسه يفعّل حسابًا ثانيًا (المفتاح يضم معرّف المستخدم).
  assert.equal((await api.post('/api/redeem', { code: 1121998 })).status, 400);
  const second = await signInDev('redeem-2', 'ثانٍ');
  const secondOk = await second.api.post('/api/redeem', { code: '1121998' });
  assert.equal(secondOk.status, 200, JSON.stringify(secondOk.data));
  assert.equal(secondOk.data.premium.source, 'promo');
  assert.equal((await api.get('/api/me')).data.premium.active, true, 'الحساب الأول لم يتأثر');
});

test('حذف الحساب يُبطل رمز آبل ويمسح كل صفوفه', { timeout: 30_000 }, async () => {
  const api = client();
  const issued = Math.floor(Date.now() / 1000);
  const created = await api.post('/api/auth/apple/native', {
    identityToken: await apple.sign({ iss: 'https://appleid.apple.com', aud: BUNDLE_ID, sub: 'apple-delete-1', iat: issued, exp: issued + 600 }),
    authorizationCode: 'apple-code-delete', client: 'ios',
  });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  api.token = created.data.session.token;
  const userId = created.data.me.user.id;
  await api.post('/api/trials/beep', {});
  await api.post('/api/dev/grant', { until: Date.now() + 86_400_000 });
  await d1.prepare('INSERT OR REPLACE INTO paddle_customers (user_id, customer_id, created_at) VALUES (?, ?, ?)').bind(userId, 'ctm_delete_1', Date.now()).run();

  const deleted = await api.del('/api/account');
  assert.equal(deleted.status, 204);
  assert.ok(state.revoked.includes(state.appleRefreshToken), 'لم يُبطل رمز آبل');
  assert.ok(state.cancelled.some((entry) => entry.includes(`dev_${userId}`)), 'لم يُطلب إلغاء اشتراك Paddle');
  for (const table of ['users', 'identities', 'sessions', 'trials', 'subscriptions', 'paddle_customers']) {
    const column = table === 'users' ? 'id' : 'user_id';
    const rows = await d1.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${column} = ?`).bind(userId).first();
    assert.equal(rows.n, 0, `${table} لم يُنظَّف`);
  }
  assert.equal((await api.get('/api/me')).data.error, 'AUTH_EXPIRED');
});
