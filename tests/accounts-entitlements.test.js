// منطق الاستحقاق على الخادم: نقي، بلا شبكة ولا قاعدة، فيُختبر مباشرة.
// العميل يملك نسخته في src/shared/account/entitlements.js؛ هذه هي التي تبني me.
import test from 'node:test';
import assert from 'node:assert/strict';
import { premiumOf, premiumActive, meResponse } from '../server/accounts/entitlements.mjs';
import { isPremium } from '../src/shared/account/entitlements.js';
import { GRACE_MS, PRODUCTS, TRIAL_GAMES } from '../src/shared/account/config.js';
import { parseSignature, productOf, subscriptionRow } from '../server/accounts/paddle.mjs';
import { readSubscriptionStatus } from '../server/accounts/apple.mjs';
import { verifyAppleJws, verifyChain, parseCertificate, APPLE_ROOT_CA_G3_SHA256, APPLE_LEAF_OID, APPLE_INTERMEDIATE_OID } from '../server/accounts/x509.mjs';
import { cleanup } from '../server/accounts/cleanup.mjs';
import { createLocalD1 } from '../server/local-d1.mjs';
import { appleChain } from './helpers-apple.js';
import { migrationStatements } from '../server/local-d1.mjs';
import { routeRequest } from '../server/worker.mjs';
import { limitKind } from '../server/accounts/router.mjs';

const NOW = 1_800_000_000_000;
const row = (extra) => ({ source: 'paddle', external_id: 'sub_1', product: PRODUCTS.monthly, status: 'active', until: NOW + 1000, will_renew: 1, ...extra });

test('premiumOf يختار الأبعد انتهاءً ويتجاهل الملغى قسرًا', () => {
  assert.deepEqual(premiumOf([], NOW), { active: false, until: 0, source: null, status: null, willRenew: false });
  assert.deepEqual(premiumOf([row()], NOW), { active: true, until: NOW + 1000, source: 'paddle', status: 'active', willRenew: true });
  // صفّان لنفس الحساب (آبل وPaddle): الأبعد يفوز.
  const both = premiumOf([row({ until: NOW + 1000 }), row({ source: 'apple', external_id: '2000', until: NOW + 90_000 })], NOW);
  assert.equal(both.source, 'apple');
  assert.equal(both.until, NOW + 90_000);
  // مسترجع أو مسحوب لا يمنح شيئًا حتى لو بقي تاريخه في المستقبل.
  assert.equal(premiumOf([row({ status: 'revoked', until: NOW + 99_000 })], NOW).active, false);
  assert.equal(premiumOf([row({ status: 'refunded', until: NOW + 99_000 })], NOW).active, false);
  // المنتهي يظل يحمل تاريخه كي يعرف العميل متى انتهى.
  const expired = premiumOf([row({ until: NOW - 1 })], NOW);
  assert.equal(expired.active, false);
  assert.equal(expired.until, NOW - 1);
  assert.equal(premiumOf([row({ will_renew: 0 })], NOW).willRenew, false);
  // رمز هدية (100 سنة) مع اشتراك مدفوع سارٍ: المدفوع يبقى ظاهرًا (المصدر والتجديد) كي تظهر «إدارة الاشتراك»، والرمز احتياط بعد انقضائه.
  const promo = { source: 'promo', external_id: 'promo:x:u1', status: 'active', until: NOW + 100 * 365 * 86_400_000, will_renew: 0 };
  const withPaid = premiumOf([promo, row({ until: NOW + 1000 })], NOW);
  assert.equal(withPaid.source, 'paddle');
  assert.equal(withPaid.willRenew, true);
  assert.equal(withPaid.until, NOW + 1000);
  const lapsed = premiumOf([promo, row({ until: NOW - 1, will_renew: 0 })], NOW);
  assert.equal(lapsed.source, 'promo');
  assert.equal(lapsed.active, true);
  // صف تجديد قديم لم يصل إشعاره لا يُفضَّل: لا يسحب الاستحقاق إلى الماضي.
  assert.equal(premiumOf([promo, row({ until: NOW - 10 * 86_400_000, will_renew: 1 })], NOW).source, 'promo');
  assert.equal(premiumOf([promo], NOW).source, 'promo');
});

test('limitKind: رمز الهدية ضمن حصة billing (حماية التخمين) لا حصة auth', () => {
  assert.equal(limitKind('/api/redeem'), 'billing');
  assert.equal(limitKind('/api/me'), 'me');
  assert.equal(limitKind('/api/trials/beep'), 'trial');
  assert.equal(limitKind('/api/auth/exchange'), 'auth');
});

test('السماح بعد الانتهاء يطابق ما يحسبه العميل', () => {
  const premium = premiumOf([row({ until: NOW - 1000 })], NOW);
  assert.equal(premium.active, false);
  assert.equal(premiumActive(premium, NOW), true); // داخل السماح
  assert.equal(premiumActive(premium, NOW + GRACE_MS), false);
  assert.equal(premiumActive({ until: 0 }, NOW), false);
  // النتيجة نفسها التي يصل إليها العميل من me مباشرة.
  assert.equal(isPremium({ premium }, NOW), premiumActive(premium, NOW));
  assert.equal(isPremium({ premium }, NOW + GRACE_MS), premiumActive(premium, NOW + GRACE_MS));
});

test('meResponse يطابق عقد العميل ولا يسرّب حقول القاعدة', () => {
  const me = meResponse({ user: { id: 'u1', name: 'أحمد', email: null, created_at: 1 }, subscriptions: [row()], trials: { beep: true }, now: NOW });
  assert.deepEqual(Object.keys(me).sort(), ['premium', 'serverTime', 'trials', 'user']);
  assert.deepEqual(me.user, { id: 'u1', name: 'أحمد', email: null });
  assert.deepEqual(Object.keys(me.premium).sort(), ['active', 'source', 'status', 'until', 'willRenew']);
  assert.deepEqual(me.trials, { beep: true });
  assert.equal(me.serverTime, NOW);
  assert.equal(JSON.stringify(me).includes('external_id'), false);
  // حساب بلا اسم ولا بريد: الحقول موجودة بقيمة null لا مفقودة.
  const bare = meResponse({ user: { id: 'u2' }, now: NOW });
  assert.deepEqual(bare.user, { id: 'u2', name: null, email: null });
  assert.deepEqual(bare.trials, {});
});

test('صف اشتراك Paddle يُقرأ من الحدث بحالة رتيبة', () => {
  const env = { PADDLE_ENV: 'sandbox', PADDLE_PRICE_MONTHLY: 'pri_m', PADDLE_PRICE_YEARLY: 'pri_y' };
  assert.equal(productOf(env, 'pri_y'), PRODUCTS.yearly);
  assert.equal(productOf(env, 'pri_other'), null);
  assert.equal(productOf(env, undefined), null);
  const ends = new Date(NOW + 86_400_000).toISOString();
  const event = { event_id: 'evt', event_type: 'subscription.activated', occurred_at: new Date(NOW).toISOString(),
    data: { id: 'sub_9', status: 'active', customer_id: 'ctm_9', custom_data: { userId: 'u1' },
      items: [{ price: { id: 'pri_m' } }], current_billing_period: { ends_at: ends } } };
  const parsed = subscriptionRow(env, event, NOW);
  assert.equal(parsed.source, 'paddle');
  assert.equal(parsed.external_id, 'sub_9');
  assert.equal(parsed.product, PRODUCTS.monthly);
  assert.equal(parsed.until, Date.parse(ends));
  assert.equal(parsed.will_renew, true);
  assert.equal(parsed.occurred_at, NOW);
  assert.equal(parsed.userId, 'u1');
  // إلغاء مجدول: ما زال ساريًا حتى نهاية الفترة لكنه لن يتجدّد.
  const cancelling = subscriptionRow(env, { ...event, data: { ...event.data, scheduled_change: { action: 'cancel', effective_at: ends } } }, NOW);
  assert.equal(cancelling.will_renew, false);
  assert.equal(cancelling.until, Date.parse(ends));
  // أحداث غير اشتراكية تُتجاهل بلا خطأ.
  assert.equal(subscriptionRow(env, { ...event, event_type: 'transaction.completed' }, NOW), null);
  assert.equal(subscriptionRow(env, { event_type: 'subscription.updated' }, NOW), null);
});

test('ترويسة توقيع Paddle تُفكَّك، والقيم الناقصة لا تُسقط الخادم', () => {
  assert.deepEqual(parseSignature('ts=1671552777;h1=abc'), { ts: '1671552777', h1: 'abc' });
  assert.deepEqual(parseSignature('h1=abc;ts=99'), { ts: '99', h1: 'abc' });
  assert.deepEqual(parseSignature(null), { ts: undefined, h1: undefined });
  assert.deepEqual(parseSignature('garbage'), { ts: undefined, h1: undefined });
});

test('قراءة حالة آبل ترفض الحزمة والمنتج الغريبين', async () => {
  const chain = appleChain();
  const jws = (payload) => chain.sign(payload);
  const env = { APPLE_BUNDLE_ID: 'com.maydan.app', APPLE_ROOT_CA_SHA256: chain.rootSha256 };
  const status = (info, renewal = { autoRenewStatus: 1 }, entry = {}) => ({ environment: 'Sandbox', bundleId: 'com.maydan.app',
    data: [{ lastTransactions: [{ originalTransactionId: '2000', status: 1, signedTransactionInfo: jws(info), signedRenewalInfo: jws(renewal), ...entry }] }] });
  const good = await readSubscriptionStatus(env, status({ bundleId: 'com.maydan.app', productId: PRODUCTS.yearly,
    originalTransactionId: '2000', expiresDate: NOW + 1000, signedDate: NOW, appAccountToken: 'ABC-DEF' }), '2000', NOW);
  assert.equal(good.external_id, '2000');
  assert.equal(good.product, PRODUCTS.yearly);
  assert.equal(good.status, 'active');
  assert.equal(good.until, NOW + 1000);
  assert.equal(good.will_renew, true);
  assert.equal(good.appAccountToken, 'abc-def'); // المقارنة بحالة موحّدة
  // فترة السماح تمدّ الاستحقاق وإن انتهى تاريخ الانتهاء.
  const grace = await readSubscriptionStatus(env, status({ bundleId: 'com.maydan.app', productId: PRODUCTS.monthly,
    originalTransactionId: '2000', expiresDate: NOW - 1000 }, { autoRenewStatus: 0, gracePeriodExpiresDate: NOW + 5000 }), '2000', NOW);
  assert.equal(grace.until, NOW + 5000);
  assert.equal(grace.will_renew, false);
  for (const bad of [
    status({ bundleId: 'com.other.app', productId: PRODUCTS.monthly, originalTransactionId: '2000' }),
    status({ bundleId: 'com.maydan.app', productId: 'plus.lifetime', originalTransactionId: '2000' }),
    { data: [] },
  ]) await assert.rejects(readSubscriptionStatus(env, bad, '2000', NOW), /NOT_ELIGIBLE/);
  // توقيع بسلسلة لا تنتهي بالجذر المثبّت يُرفض قبل أي قراءة.
  const foreign = { ...env, APPLE_ROOT_CA_SHA256: APPLE_ROOT_CA_G3_SHA256 };
  await assert.rejects(readSubscriptionStatus(foreign, status({ bundleId: 'com.maydan.app', productId: PRODUCTS.monthly, originalTransactionId: '2000' }), '2000', NOW), /SIGNATURE/);
});

// ── سلسلة x5c: توقيعات آبل تُقبل فقط بسلسلة صالحة حتى الجذر المثبّت ─────────
test('x509: السلسلة الوهمية تُحلَّل وتُتحقق، والامتدادات في مكانها', async () => {
  const chain = appleChain();
  const leaf = parseCertificate(chain.leafDer);
  assert.equal(leaf.curve, 'P-256');
  assert.equal(leaf.hash, 'SHA-256');
  assert.ok(leaf.extensions.has(APPLE_LEAF_OID));
  const intermediate = parseCertificate(chain.intermediateDer);
  assert.equal(intermediate.curve, 'P-384');
  assert.equal(intermediate.hash, 'SHA-384');
  assert.ok(intermediate.extensions.has(APPLE_INTERMEDIATE_OID));
  assert.ok(leaf.notBefore < Date.now() && leaf.notAfter > Date.now());
  const parsed = await verifyChain([chain.leafDer, chain.intermediateDer, chain.rootDer], { rootSha256: chain.rootSha256 });
  assert.equal(parsed.length, 3);
  // جذر مختلف، أو ترتيب معكوس، أو خارج فترة الصلاحية → SIGNATURE.
  await assert.rejects(verifyChain([chain.leafDer, chain.intermediateDer, chain.rootDer], { rootSha256: APPLE_ROOT_CA_G3_SHA256 }), /SIGNATURE/);
  const other = appleChain({ root: 'other-root.pem' });
  await assert.rejects(verifyChain([chain.leafDer, chain.intermediateDer, other.rootDer], { rootSha256: other.rootSha256 }), /SIGNATURE/);
  await assert.rejects(verifyChain([chain.rootDer, chain.intermediateDer, chain.leafDer], { rootSha256: chain.rootSha256 }), /SIGNATURE/);
  await assert.rejects(verifyChain([chain.leafDer, chain.intermediateDer, chain.rootDer], { rootSha256: chain.rootSha256, now: Date.UTC(2090, 0, 1) }), /SIGNATURE/);
  assert.equal(APPLE_ROOT_CA_G3_SHA256, '63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179');
});

test('x509: JWS آبل يُقبل موقّعًا، ويُرفض معدَّلًا أو بلا x5c أو بخوارزمية أخرى', async () => {
  const chain = appleChain();
  const options = { rootSha256: chain.rootSha256 };
  const token = chain.sign({ notificationUUID: 'n-1', data: { originalTransactionId: '42' } });
  assert.deepEqual((await verifyAppleJws(token, options)).data, { originalTransactionId: '42' });
  const [head, body, signature] = token.split('.');
  const tampered = `${head}.${Buffer.from(JSON.stringify({ notificationUUID: 'n-2' })).toString('base64url')}.${signature}`;
  await assert.rejects(verifyAppleJws(tampered, options), /SIGNATURE/);
  await assert.rejects(verifyAppleJws(chain.sign({ a: 1 }, { header: { alg: 'ES256' } }), options), /SIGNATURE/);
  await assert.rejects(verifyAppleJws(chain.sign({ a: 1 }, { header: { alg: 'RS256', x5c: chain.x5c } }), options), /SIGNATURE/);
  await assert.rejects(verifyAppleJws(chain.sign({ a: 1 }, { x5c: chain.x5c.slice(1) }), options), /SIGNATURE/, 'الوسيط ليس ورقة توقيع');
  await assert.rejects(verifyAppleJws(`${head}.${body}.${Buffer.from('short').toString('base64url')}`, options), /SIGNATURE/);
  await assert.rejects(verifyAppleJws('garbage', options), /INVALID/);
});

// ── التنظيف الدوري ────────────────────────────────────────────────────────────
test('cleanup يحذف الجلسات المنتهية قديمًا ورموز الدخول وأحداث webhooks القديمة فقط', async () => {
  const db = createLocalD1();
  const env = { DB: db };
  const now = Date.UTC(2026, 8, 16);
  const day = 86_400_000;
  const session = (id, expires, revoked = null) => db.prepare('INSERT INTO sessions (id, user_id, secret_hash, client, created_at, last_seen, expires_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(id, 'u1', 'h', 'web', now - 200 * day, now, expires, revoked).run();
  await session('live', now + 10 * day);
  await session('just-expired', now - 5 * day);
  await session('long-expired', now - 40 * day);
  await session('revoked-recent', now + 10 * day, now - 2 * day);
  await session('revoked-old', now + 10 * day, now - 45 * day);
  await db.prepare('INSERT INTO auth_codes (code_hash, user_id, client, expires_at) VALUES (?, ?, ?, ?)').bind('fresh', 'u1', 'web', now + 60_000).run();
  await db.prepare('INSERT INTO auth_codes (code_hash, user_id, client, expires_at) VALUES (?, ?, ?, ?)').bind('stale', 'u1', 'web', now - 2 * 3_600_000).run();
  await db.prepare('INSERT INTO webhook_events (id, received_at) VALUES (?, ?)').bind('recent', now - day).run();
  await db.prepare('INSERT INTO webhook_events (id, received_at) VALUES (?, ?)').bind('ancient', now - 100 * day).run();
  const result = await cleanup(env, now);
  assert.deepEqual(result, { sessions: 2, authCodes: 1, webhookEvents: 1 });
  const ids = (await db.prepare('SELECT id FROM sessions ORDER BY id').all()).results.map((r) => r.id);
  assert.deepEqual(ids, ['just-expired', 'live', 'revoked-recent']);
  assert.equal((await db.prepare('SELECT count(*) AS n FROM auth_codes').first()).n, 1);
  assert.equal((await db.prepare('SELECT id FROM webhook_events').first()).id, 'recent');
  assert.deepEqual(await cleanup({}, now), { skipped: true });
  db.close();
});

test('ترحيلات D1 جمل مستقلة بسطر واحد يقبلها exec', () => {
  const statements = migrationStatements();
  assert.ok(statements.length >= 10, 'الترحيل الأول ينشئ جداول الحسابات كلها');
  for (const statement of statements) {
    assert.equal(statement.includes('\n'), false, `جملة متعددة الأسطر يرفضها D1 exec: ${statement.slice(0, 40)}`);
    assert.equal(statement.includes('--'), false, 'التعليقات تُزال قبل التنفيذ');
    assert.match(statement, /^CREATE (TABLE|INDEX) IF NOT EXISTS /);
  }
  for (const table of ['users', 'identities', 'sessions', 'auth_codes', 'subscriptions', 'trials', 'webhook_events', 'paddle_customers']) {
    assert.ok(statements.some((statement) => statement.includes(`CREATE TABLE IF NOT EXISTS ${table} `)), `جدول ${table} مفقود`);
  }
  // معاملة آبل الواحدة لا تُربط بحسابين: المفتاح الأساسي يمنع ذلك.
  assert.ok(statements.some((s) => s.includes('subscriptions') && s.includes('PRIMARY KEY (source, external_id)')));
  assert.ok(TRIAL_GAMES.length === 5);
});

// بلا ربط D1 (قبل إنشاء القاعدة) ينشر العامل ويعمل: الحسابات 404 والغرف كما كانت.
test('بلا DB: مسارات الحسابات تردّ 404 و/health يعلن accounts:false', async () => {
  const env = { ALLOWED_ORIGINS: 'https://maydan.test' };
  const headers = { origin: 'https://maydan.test' };
  const health = await (await routeRequest(new Request('https://maydan.test/health'), env)).json();
  assert.equal(health.accounts, false);
  for (const path of ['/api/me', '/api/billing/config', '/api/auth/apple/start']) {
    const response = await routeRequest(new Request(`https://maydan.test${path}`, { headers }), env);
    assert.equal(response.status, 404, path);
    assert.equal((await response.json()).error, 'NOT_FOUND', path);
  }
});

// النشر الكامل: الصفحة والـAPI على الأصل نفسه، وGET من الصفحة لا يحمل Origin.
test('GET من الأصل نفسه بلا Origin يُقبل بـSec-Fetch-Site أو Referer، والغريب يُرفض', async () => {
  const env = { ALLOWED_ORIGINS: 'https://maydan.test' };
  const status = async (path, headers, method = 'GET') => (await routeRequest(new Request(`https://maydan.test${path}`, { method, headers }), env)).status;
  // بلا DB يردّ /api/me بـ404 لا 403: الأصل قُبل.
  assert.equal(await status('/api/me', { 'sec-fetch-site': 'same-origin' }), 404);
  assert.equal(await status('/api/me', { referer: 'https://maydan.test/#/settings' }), 404);
  assert.equal(await status('/api/me', {}), 403, 'بلا أي دليل على الأصل');
  assert.equal(await status('/api/me', { 'sec-fetch-site': 'cross-site' }), 403);
  assert.equal(await status('/api/me', { referer: 'https://evil.test/' }), 403);
  assert.equal(await status('/api/me', { origin: 'https://evil.test', 'sec-fetch-site': 'same-origin' }), 403, 'Origin صريح غير مسموح يغلب');
  assert.equal(await status('/api/trials/beep', { 'sec-fetch-site': 'same-origin' }, 'POST'), 403, 'الكتابة تحتاج Origin');
  // أصل غير مسموح أصلًا (عامل الغرف وحده مع صفحة على مضيف آخر) لا يُقبل ولو كان الطلب من صفحته.
  const other = await routeRequest(new Request('https://rooms.test/api/me', { headers: { 'sec-fetch-site': 'same-origin' } }), env);
  assert.equal(other.status, 403);
});
