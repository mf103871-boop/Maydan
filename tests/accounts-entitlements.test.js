// منطق الاستحقاق على الخادم: نقي، بلا شبكة ولا قاعدة، فيُختبر مباشرة.
// العميل يملك نسخته في src/shared/account/entitlements.js؛ هذه هي التي تبني me.
import test from 'node:test';
import assert from 'node:assert/strict';
import { premiumOf, premiumActive, meResponse } from '../server/accounts/entitlements.mjs';
import { isPremium } from '../src/shared/account/entitlements.js';
import { GRACE_MS, PRODUCTS, TRIAL_GAMES } from '../src/shared/account/config.js';
import { parseSignature, productOf, subscriptionRow } from '../server/accounts/paddle.mjs';
import { readSubscriptionStatus } from '../server/accounts/apple.mjs';
import { migrationStatements } from '../server/local-d1.mjs';
import { routeRequest } from '../server/worker.mjs';

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

test('قراءة حالة آبل ترفض الحزمة والمنتج الغريبين', () => {
  const b64u = (value) => Buffer.from(value).toString('base64url');
  const jws = (payload) => `${b64u('{"alg":"ES256"}')}.${b64u(JSON.stringify(payload))}.${b64u('sig')}`;
  const env = { APPLE_BUNDLE_ID: 'com.maydan.app' };
  const status = (info, renewal = { autoRenewStatus: 1 }, entry = {}) => ({ environment: 'Sandbox', bundleId: 'com.maydan.app',
    data: [{ lastTransactions: [{ originalTransactionId: '2000', status: 1, signedTransactionInfo: jws(info), signedRenewalInfo: jws(renewal), ...entry }] }] });
  const good = readSubscriptionStatus(env, status({ bundleId: 'com.maydan.app', productId: PRODUCTS.yearly,
    originalTransactionId: '2000', expiresDate: NOW + 1000, signedDate: NOW, appAccountToken: 'ABC-DEF' }), '2000', NOW);
  assert.equal(good.external_id, '2000');
  assert.equal(good.product, PRODUCTS.yearly);
  assert.equal(good.status, 'active');
  assert.equal(good.until, NOW + 1000);
  assert.equal(good.will_renew, true);
  assert.equal(good.appAccountToken, 'abc-def'); // المقارنة بحالة موحّدة
  // فترة السماح تمدّ الاستحقاق وإن انتهى تاريخ الانتهاء.
  const grace = readSubscriptionStatus(env, status({ bundleId: 'com.maydan.app', productId: PRODUCTS.monthly,
    originalTransactionId: '2000', expiresDate: NOW - 1000 }, { autoRenewStatus: 0, gracePeriodExpiresDate: NOW + 5000 }), '2000', NOW);
  assert.equal(grace.until, NOW + 5000);
  assert.equal(grace.will_renew, false);
  for (const bad of [
    status({ bundleId: 'com.other.app', productId: PRODUCTS.monthly, originalTransactionId: '2000' }),
    status({ bundleId: 'com.maydan.app', productId: 'plus.lifetime', originalTransactionId: '2000' }),
    { data: [] },
  ]) assert.throws(() => readSubscriptionStatus(env, bad, '2000', NOW), /NOT_ELIGIBLE/);
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
