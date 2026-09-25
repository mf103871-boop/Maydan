// موجّه مسارات الحسابات: يُستدعى من routeRequest قبل مسارات الغرف.
// يُعيد Response إن كان المسار له، أو null ليكمل الموجّه الأصلي طريقه.
import { TRIAL_GAMES, PRODUCTS, PROMO_DURATION_MS } from '../../src/shared/account/config.js';
import { codeHash, isValidCode } from '../../src/shared/account/redeem.js';
import { json, readJson } from '../protocol.mjs';
import { failure, RoomError } from './errors.mjs';
import * as db from './db.mjs';
import * as apple from './apple.mjs';
import * as google from './google.mjs';
import * as paddle from './paddle.mjs';
import { assertPaddleWebhookIp } from './paddle-ips.mjs';
import { premiumOf, premiumActive } from './entitlements.mjs';
import { inBillingEnvironment } from './billing-environment.mjs';
import {
  bearer, issueAuthCode, issueSession, me as meOf, readSession, readState, redeemAuthCode,
  requireSession, returnRedirect, safeReturn, signState, withRotation,
} from './session.mjs';
import { randomHex } from './jwt.mjs';

// مسارات لا تحمل Origin أصلًا: إعادة توجيه المزوّد وwebhooks الخوادم.
export const PUBLIC_PATHS = new Set([
  '/api/auth/apple/start', '/api/auth/apple/callback',
  '/api/auth/google/start', '/api/auth/google/callback',
  '/api/apple/notifications', '/api/paddle/webhook',
]);
const PREFIXES = ['/api/auth/', '/api/trials/', '/api/apple/', '/api/paddle/', '/api/billing/', '/api/dev/'];
const EXACT = new Set(['/api/me', '/api/account', '/api/redeem']);
export const isAccountPath = (pathname) => EXACT.has(pathname) || PREFIXES.some((prefix) => pathname.startsWith(prefix));
export const isPublicAccountPath = (pathname) => PUBLIC_PATHS.has(pathname);

const devFake = (env) => env.AUTH_DEV_FAKE === '1';
const MAX_BODY = 32_768; // JWS آبل وإشعاراتها أكبر بكثير من أجسام الغرف.

export function limitKind(pathname) {
  if (pathname === '/api/me') return 'me';
  if (pathname.startsWith('/api/trials/')) return 'trial';
  if (pathname.startsWith('/api/billing/') || pathname.startsWith('/api/paddle/') || pathname === '/api/apple/transactions' || pathname === '/api/redeem') return 'billing';
  return 'auth';
}

// ── نقطة الدخول ─────────────────────────────────────────────────────────────
export async function routeAccounts(request, env, url, charge) {
  const path = url.pathname;
  if (!isAccountPath(path)) return null;
  if (!env.DB) failure('NOT_FOUND'); // لم تُربط قاعدة D1: الحسابات معطّلة، والغرف تعمل كما كانت.
  // الـwebhooks لا تُحسب على حصّة عنوان المتصل: المزوّد قد يعيد الإرسال دفعة واحدة.
  if (charge && path !== '/api/paddle/webhook' && path !== '/api/apple/notifications') await charge(limitKind(path));
  const method = request.method;
  const now = Date.now();

  if (path === '/api/billing/config' && method === 'GET') return billingConfig(env);
  if (path === '/api/auth/apple/start' && method === 'GET') return startApple(request, env, url, now);
  if (path === '/api/auth/apple/callback' && method === 'POST') return callbackApple(request, env, url, now);
  if (path === '/api/auth/google/start' && method === 'GET') return startGoogle(request, env, url, now);
  if (path === '/api/auth/google/callback' && method === 'GET') return callbackGoogle(request, env, url, now);
  if (path === '/api/auth/apple/native' && method === 'POST') return appleNative(request, env, now);
  if (path === '/api/auth/exchange' && method === 'POST') return exchange(request, env, now);
  if (path === '/api/auth/signout' && method === 'POST') return signout(request, env, now);
  if (path === '/api/auth/dev' && method === 'POST') return devSignIn(request, env, now);
  if (path === '/api/dev/grant' && method === 'POST') return devGrant(request, env, now);
  if (path === '/api/me' && method === 'GET') return meRoute(request, env, now);
  if (path === '/api/trials/merge' && method === 'POST') return mergeTrials(request, env, now);
  if (path.startsWith('/api/trials/') && method === 'POST') return addTrial(request, env, path.slice('/api/trials/'.length), now);
  if (path === '/api/apple/transactions' && method === 'POST') return appleTransactions(request, env, now);
  if (path === '/api/apple/notifications' && method === 'POST') return appleNotifications(request, env, now);
  if (path === '/api/paddle/checkout' && method === 'POST') return paddleCheckout(request, env, now);
  if (path === '/api/paddle/webhook' && method === 'POST') return paddleWebhook(request, env, now);
  if (path === '/api/paddle/portal' && method === 'GET') return paddlePortal(request, env, now);
  if (path === '/api/account' && method === 'DELETE') return deleteAccount(request, env, now);
  if (path === '/api/redeem' && method === 'POST') return redeem(request, env, now);
  return failure('NOT_FOUND');
}

// ── الإعداد ─────────────────────────────────────────────────────────────────
function billingConfig(env) {
  return json({
    paddle: paddle.publicConfig(env),
    apple: { purchasesConfigured: apple.purchasesConfigured(env) },
    products: PRODUCTS,
    providers: { apple: apple.configured(env), google: google.configured(env), dev: devFake(env) },
  });
}

// ── بداية تدفقات OAuth ──────────────────────────────────────────────────────
const clientOf = (value) => (value === 'ios' ? 'ios' : 'web');
const redirectUri = (url, provider) => `${url.origin}/api/auth/${provider}/callback`;

async function startApple(request, env, url, now) {
  const client = clientOf(url.searchParams.get('client'));
  const target = safeReturn(env, url.searchParams.get('return'), client);
  const nonce = randomHex(16);
  const state = await signState(env, { p: 'apple', c: client, r: target, nonce }, now);
  const location = apple.authorizeUrl(env, { redirectUri: redirectUri(url, 'apple'), state, nonce });
  return new Response(null, { status: 302, headers: { location, 'cache-control': 'no-store' } });
}
async function startGoogle(request, env, url, now) {
  const client = clientOf(url.searchParams.get('client'));
  const target = safeReturn(env, url.searchParams.get('return'), client);
  const nonce = randomHex(16);
  const state = await signState(env, { p: 'google', c: client, r: target, nonce }, now);
  const location = google.authorizeUrl(env, { redirectUri: redirectUri(url, 'google'), state, nonce });
  return new Response(null, { status: 302, headers: { location, 'cache-control': 'no-store' } });
}

// أرسلنا nonce في بدء الدخول، فلا نقبل إسقاطه من رمز الهوية.
function checkNonce(payload, state) {
  if (!state.nonce || payload.nonce !== state.nonce) failure('STATE');
}

async function callbackApple(request, env, url, now) {
  const form = new URLSearchParams(await request.text());
  const state = await readState(env, form.get('state'), now);
  if (state.p !== 'apple') failure('STATE');
  const idToken = form.get('id_token');
  if (!idToken) failure('STATE');
  const payload = await apple.verifyIdentityToken(env, idToken, { client: 'web', now });
  checkNonce(payload, state);
  // التبادل اختياري: نحتفظ برمز التحديث كي نستطيع إبطاله عند حذف الحساب.
  let refreshToken = null;
  if (form.get('code')) {
    const tokens = await apple.exchangeCode(env, { code: form.get('code'), redirectUri: redirectUri(url, 'apple'), client: 'web' });
    refreshToken = tokens?.refresh_token || null;
  }
  const user = await db.linkIdentity(env, {
    provider: 'apple', subject: payload.sub, name: apple.nameFromForm(form.get('user')),
    email: payload.email_verified === false ? null : (payload.email || null), refreshToken, now,
  });
  return returnRedirect(state.r, await issueAuthCode(env, user.id, state.c, now));
}

async function callbackGoogle(request, env, url, now) {
  const state = await readState(env, url.searchParams.get('state'), now);
  if (state.p !== 'google') failure('STATE');
  const code = url.searchParams.get('code');
  if (!code) failure('STATE');
  const tokens = await google.exchangeCode(env, { code, redirectUri: redirectUri(url, 'google') });
  const payload = await google.verifyIdentityToken(env, tokens.id_token, { now });
  checkNonce(payload, state);
  const profile = google.profileOf(payload);
  const user = await db.linkIdentity(env, { provider: 'google', subject: profile.subject, name: profile.name, email: profile.email, now });
  return returnRedirect(state.r, await issueAuthCode(env, user.id, state.c, now));
}

// ── تحويل الهوية إلى جلسة ───────────────────────────────────────────────────
async function sessionResponse(env, user, client, now, status = 200) {
  const session = await issueSession(env, user.id, client, now);
  return json({ session: { token: session.token, expiresAt: session.expiresAt }, me: await meOf(env, user, now) }, status);
}

async function exchange(request, env, now) {
  const body = await readJson(request);
  const row = await redeemAuthCode(env, body.code, now);
  const user = await db.userById(env, row.user_id);
  if (!user) failure('STATE');
  return sessionResponse(env, user, clientOf(body.client || row.client), now);
}

// الدخول الأصلي على iOS: identityToken من ASAuthorization مباشرة، بلا إعادة توجيه.
async function appleNative(request, env, now) {
  const body = await readJson(request, MAX_BODY);
  if (!body.identityToken) failure('INVALID');
  const payload = await apple.verifyIdentityToken(env, body.identityToken, { client: 'ios', now });
  let refreshToken = null;
  if (body.authorizationCode) {
    const tokens = await apple.exchangeCode(env, { code: body.authorizationCode, client: 'ios' });
    refreshToken = tokens?.refresh_token || null;
  }
  const name = apple.nameFromForm(body.fullName);
  const user = await db.linkIdentity(env, {
    provider: 'apple', subject: payload.sub, name,
    email: payload.email_verified === false ? null : (payload.email || null), refreshToken, now,
  });
  return sessionResponse(env, user, 'ios', now);
}

async function signout(request, env, now) {
  const found = await readSession(env, request, { now, rotate: false });
  if (found) await db.revokeSession(env, found.session.id, now);
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}

// ── مزوّد وهمي للتطوير والاختبارات فقط ──────────────────────────────────────
async function devSignIn(request, env, now) {
  if (!devFake(env)) failure('NOT_FOUND');
  const body = await readJson(request);
  const subject = String(body.subject || '').trim();
  if (!subject) failure('INVALID');
  const user = await db.linkIdentity(env, { provider: 'dev', subject, name: body.name || null, email: body.email || null, now });
  return sessionResponse(env, user, clientOf(body.client), now);
}
async function devGrant(request, env, now) {
  if (!devFake(env)) failure('NOT_FOUND');
  const { user, rotated } = await requireSession(env, request, { now });
  const body = await readJson(request);
  const until = body.until === null || body.until === undefined ? 0 : Number(body.until);
  if (!Number.isFinite(until)) failure('INVALID');
  await db.upsertSubscription(env, {
    source: body.source === 'apple' ? 'apple' : 'paddle', external_id: `dev_${user.id}`, user_id: user.id,
    product: body.product || PRODUCTS.monthly, status: until > now ? 'active' : 'canceled',
    until, will_renew: until > now, environment: 'sandbox', occurred_at: now,
  });
  return withRotation(json(await meOf(env, user, now)), rotated);
}

// ── الحساب والتجارب ─────────────────────────────────────────────────────────
async function meRoute(request, env, now) {
  const { user, rotated } = await requireSession(env, request, { now });
  return withRotation(json(await meOf(env, user, now)), rotated);
}
async function addTrial(request, env, game, now) {
  if (!TRIAL_GAMES.includes(game)) failure('NOT_FOUND');
  const { user, rotated } = await requireSession(env, request, { now });
  await db.addTrial(env, user.id, game, now);
  return withRotation(json({ trials: await db.trialsOf(env, user.id) }), rotated);
}
// الدمج اتحاد: علامة محلية من زمن المجهول لا تُمحى بالدخول ولا تُستعاد تجربة مستهلكة.
async function mergeTrials(request, env, now) {
  const { user, rotated } = await requireSession(env, request, { now });
  const body = await readJson(request);
  const games = Array.isArray(body.games) ? body.games.filter((game) => TRIAL_GAMES.includes(game)) : [];
  for (const game of games) await db.addTrial(env, user.id, game, now);
  return withRotation(json({ trials: await db.trialsOf(env, user.id) }), rotated);
}

// ── آبل: المشتريات ──────────────────────────────────────────────────────────
async function appleTransactions(request, env, now) {
  const { user, rotated } = await requireSession(env, request, { now });
  const body = await readJson(request, MAX_BODY);
  if (!body.jws) failure('INVALID');
  await apple.bindTransaction(env, user, body.jws, now);
  return withRotation(json(await meOf(env, user, now)), rotated);
}
async function appleNotifications(request, env, now) {
  const body = await readJson(request, MAX_BODY);
  if (!body.signedPayload) failure('INVALID');
  return apple.handleNotification(env, body.signedPayload, now);
}

// ── Paddle ──────────────────────────────────────────────────────────────────
async function paddleCheckout(request, env, now) {
  const { user, rotated } = await requireSession(env, request, { now });
  const body = await readJson(request);
  // قواعد آبل: لا شراء ويب داخل التطبيق. المصدر يُعرف من الجسم أو من أصل التطبيق.
  const origin = request.headers.get('origin') || '';
  if (body.client === 'ios' || origin.startsWith('maydan:')) failure('NOT_ELIGIBLE');
  if (!paddle.configured(env)) failure('NOT_ELIGIBLE');
  if (body.plan !== 'monthly' && body.plan !== 'yearly') failure('INVALID');
  // اشتراك مدفوع سارٍ (Paddle أو آبل) يمنع معاملة ثانية: لا فوترة مزدوجة؛ الرمز لا يمنع.
  const current = premiumOf(await db.subscriptionsOf(env, user.id), now, env);
  if (premiumActive(current, now) && current.source !== 'promo') failure('ALREADY_SUBSCRIBED');
  return withRotation(json(await paddle.createTransaction(env, user, body.plan)), rotated);
}
async function paddlePortal(request, env, now) {
  const { user, rotated } = await requireSession(env, request, { now });
  return withRotation(json({ url: await paddle.portalUrl(env, user) }), rotated);
}
async function paddleWebhook(request, env, now) {
  await assertPaddleWebhookIp(request, env);
  const raw = await request.text();
  if (raw.length > 262_144) failure('INVALID');
  await paddle.verifySignature(env, request.headers.get('paddle-signature'), raw, now);
  let event;
  try { event = JSON.parse(raw); } catch { return failure('INVALID'); }
  if (!event?.event_id) failure('INVALID');
  const eventId = `paddle:${paddle.environmentOf(env)}:${event.event_id}`;
  if (await db.webhookEvent(env, eventId)) return json({ ok: true, duplicate: true });
  if (await paddle.recoverCheckoutEvent(env, event)) {
    await db.markWebhookEvent(env, eventId, now);
    return json({ ok: true, recovered: true });
  }
  const row = paddle.subscriptionRow(env, event, now);
  if (!row) {
    await db.markWebhookEvent(env, eventId, now);
    return json({ ok: true, ignored: event.event_type || 'unknown' });
  }
  const existing = await db.subscriptionByExternal(env, 'paddle', row.external_id);
  if (existing?.environment && !inBillingEnvironment(env, existing)) failure('NOT_ELIGIBLE');
  let userId = row.userId;
  if (!userId && row.customerId) userId = (await db.paddleUserOf(env, row.customerId))?.user_id || null;
  if (!userId) {
    userId = existing?.user_id || null;
  }
  if (!userId || !(await db.userById(env, userId))) return json({ ok: true, ignored: 'unknown-user' });
  if (existing && existing.user_id !== userId) failure('ALREADY_LINKED');
  if (row.customerId) await db.setPaddleCustomer(env, userId, row.customerId, now);
  await db.upsertSubscription(env, { ...row, user_id: userId });
  // لا نؤكد المعالجة قبل نجاح كل الكتابات: يسمح ذلك بإعادة المحاولة بعد أي عطل.
  await db.markWebhookEvent(env, eventId, now);
  return json({ ok: true });
}

// ── حذف الحساب ──────────────────────────────────────────────────────────────
async function deleteAccount(request, env, now) {
  const { user } = await requireSession(env, request, { now, rotate: false });
  const deletionId = db.uuid();
  if (!await db.reserveAccountDeletion(env, user.id, deletionId)) failure('CHECKOUT_REVIEW');
  try {
    await paddle.checkDeletionCheckout(env, user);
    const [identities, subscriptions] = await Promise.all([db.identitiesOf(env, user.id), db.subscriptionsOf(env, user.id)]);
    // A sandbox worker must not delete a real renewal it cannot cancel.
    if (subscriptions.some((s) => s.source === 'paddle' && paddle.mayResumeBilling(s)
      && !inBillingEnvironment(env, s) && s.environment !== 'sandbox')) failure('BILLING_CANCEL_FAILED');
    for (const subscription of subscriptions) {
      if (subscription.source === 'paddle' && paddle.mayResumeBilling(subscription) && inBillingEnvironment(env, subscription)) {
        await paddle.cancelSubscription(env, subscription.external_id, { verifyFirst: !subscription.will_renew });
      }
    }
    for (const identity of identities) {
      if (identity.provider === 'apple' && identity.refresh_token) await apple.revokeToken(env, identity.refresh_token);
    }
    await db.deleteUser(env, user.id);
    return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
  } finally {
    // Failure keeps the checkout reservation, but does not strand account management.
    await db.releaseAccountDeletion(env, user.id, deletionId).catch(() => {});
  }
}

// ── رموز الهدايا ────────────────────────────────────────────────────────────
// التطبيع والتجزئة في src/shared/account/redeem.js. البصمات المقبولة كلها
// تأتي من السرّ REDEEM_CODE_HASHES بلا نشر جديد. الرمز الصحيح يمنح صف اشتراك
// مصدره promo (دائم عمليًا) فيراه /api/me على كل أجهزة الحساب.
export function redeemHashes(env) {
  const extra = String(env.REDEEM_CODE_HASHES || '').split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  return extra.filter((entry) => /^[a-f0-9]{64}$/.test(entry));
}
async function redeem(request, env, now) {
  const { user, rotated } = await requireSession(env, request, { now });
  const body = await readJson(request);
  const code = typeof body.code === 'string' ? body.code : '';
  if (!isValidCode(code, redeemHashes(env))) failure('REDEEM_INVALID');
  await db.upsertSubscription(env, {
    source: 'promo', external_id: `promo:${codeHash(code).slice(0, 16)}:${user.id}`, user_id: user.id,
    product: PRODUCTS.yearly, status: 'active', until: now + PROMO_DURATION_MS, will_renew: false,
    environment: 'promo', occurred_at: now,
  });
  return withRotation(json(await meOf(env, user, now)), rotated);
}

// ── بوابة إنشاء الغرف ───────────────────────────────────────────────────────
export const gameOf = (input) => (TRIAL_GAMES.includes(input?.game) ? input.game : 'meenfina');
// المجهول يبقى مسموحًا (العلامة محلية)؛ المسجّل غير المشترك يُحسب له إنشاء واحد لكل لعبة.
export async function roomGate(request, env, input, now = Date.now()) {
  if (!env.DB || !bearer(request)) return null;
  let found = null;
  try { found = await readSession(env, request, { now, rotate: false }); }
  catch (error) { if (error instanceof RoomError) return null; throw error; } // رمز قديم = ضيف، لا رفض
  if (!found) return null;
  const game = gameOf(input);
  const [subscriptions, trials] = await Promise.all([db.subscriptionsOf(env, found.user.id), db.trialsOf(env, found.user.id)]);
  const premium = premiumActive(premiumOf(subscriptions, now, env), now);
  if (!premium && trials[game]) failure('PLUS_REQUIRED');
  return { userId: found.user.id, game, premium };
}
export async function markRoomTrial(env, gate, now = Date.now()) {
  if (!gate) return;
  try { await db.addTrial(env, gate.userId, gate.game, now); } catch { /* الغرفة أُنشئت فعلًا */ }
}
