// آبل: تسجيل الدخول (الويب والأصلي) واشتراكات StoreKit عبر App Store Server API.
// قاعدة المشروع: الـJWS الذي يرسله العميل مجرد تلميح؛ الحقيقة تأتي من آبل نفسها.
import { PRODUCTS } from '../../src/shared/account/config.js';
import { json } from '../protocol.mjs';
import { failure } from './errors.mjs';
import { decodeJws, providerFetch, signEs256, verifyJwt } from './jwt.mjs';
import { rootFingerprint, verifyAppleJws } from './x509.mjs';
import * as db from './db.mjs';

export const ISSUER = 'https://appleid.apple.com';
export const urls = (env) => ({
  authorize: env.APPLE_AUTH_URL || `${ISSUER}/auth/authorize`,
  token: env.APPLE_TOKEN_URL || `${ISSUER}/auth/token`,
  jwks: env.APPLE_JWKS_URL || `${ISSUER}/auth/keys`,
  revoke: env.APPLE_REVOKE_URL || `${ISSUER}/auth/revoke`,
  store: String(env.APPLE_STORE_API_URL || 'https://api.storekit.itunes.apple.com').replace(/\/+$/, ''),
});
// مُعرّف الجمهور يختلف: Services ID على الويب، معرّف الحزمة داخل التطبيق.
export const audienceFor = (env, client) => (client === 'ios' ? env.APPLE_BUNDLE_ID : env.APPLE_SERVICES_ID);
export const configured = (env) => !!(env.APPLE_SERVICES_ID || env.APPLE_BUNDLE_ID);

export function authorizeUrl(env, { redirectUri, state, nonce }) {
  if (!env.APPLE_SERVICES_ID) failure('NOT_ELIGIBLE');
  const query = new URLSearchParams({
    response_type: 'code id_token', response_mode: 'form_post', client_id: env.APPLE_SERVICES_ID,
    redirect_uri: redirectUri, scope: 'name email', state, nonce,
  });
  return `${urls(env).authorize}?${query}`;
}

// سر عميل آبل لا يُخزَّن: يُولَّد ES256 عند كل تبادل ويعيش ساعة واحدة.
async function clientSecret(env, now = Date.now()) {
  if (!env.APPLE_SIGNIN_PRIVATE_KEY || !env.APPLE_TEAM_ID || !env.APPLE_SIGNIN_KEY_ID) failure('NOT_ELIGIBLE');
  const issued = Math.floor(now / 1000);
  return signEs256({ kid: env.APPLE_SIGNIN_KEY_ID }, {
    iss: env.APPLE_TEAM_ID, iat: issued, exp: issued + 3600, aud: ISSUER, sub: env.APPLE_SERVICES_ID || env.APPLE_BUNDLE_ID,
  }, env.APPLE_SIGNIN_PRIVATE_KEY);
}
export async function exchangeCode(env, { code, redirectUri, client = 'web' }) {
  // بلا مفتاح الدخول (الفريق، معرّف المفتاح، p8) لا يمكن توقيع سر العميل: الدخول يمضي
  // بـid_token وحده، ويغيب رمز التحديث فقط (يلزم لإبطال الربط عند حذف الحساب).
  let secret;
  try { secret = await clientSecret(env); } catch { return null; }
  const body = new URLSearchParams({
    grant_type: 'authorization_code', code, client_id: audienceFor(env, client) || '', client_secret: secret,
  });
  if (redirectUri) body.set('redirect_uri', redirectUri);
  const result = await providerFetch(urls(env).token, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: String(body),
  });
  // فشل التبادل لا يمنع الدخول: id_token وحده يكفي لإثبات الهوية، والرمز للإبطال لاحقًا.
  return result.ok && result.data ? result.data : null;
}
export async function revokeToken(env, refreshToken) {
  if (!refreshToken) return;
  const body = new URLSearchParams({
    token: refreshToken, token_type_hint: 'refresh_token',
    client_id: env.APPLE_SERVICES_ID || env.APPLE_BUNDLE_ID || '', client_secret: await clientSecret(env),
  });
  await providerFetch(urls(env).revoke, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: String(body) });
}

export async function verifyIdentityToken(env, token, { client = 'web', nonce, now = Date.now() } = {}) {
  const audience = [audienceFor(env, client), env.APPLE_BUNDLE_ID, env.APPLE_SERVICES_ID].filter(Boolean);
  const payload = await verifyJwt(token, { jwksUrl: urls(env).jwks, issuer: ISSUER, audience, nonce, now });
  if (!payload.sub) failure('SIGNATURE');
  return payload;
}
// آبل ترسل الاسم مرة واحدة فقط (أول موافقة)، فنلتقطه من الحقل المرافق.
export function nameFromForm(value) {
  if (!value) return null;
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    const name = [parsed?.name?.firstName ?? parsed?.givenName, parsed?.name?.lastName ?? parsed?.familyName].filter(Boolean).join(' ').trim();
    return name || null;
  } catch { return null; }
}

// ── App Store Server API ────────────────────────────────────────────────────
const STATUS_TEXT = { 1: 'active', 2: 'expired', 3: 'billing_retry', 4: 'grace', 5: 'revoked' };

async function storeToken(env, now = Date.now()) {
  if (!env.APPLE_IAP_PRIVATE_KEY || !env.APPLE_IAP_ISSUER_ID || !env.APPLE_IAP_KEY_ID) failure('NOT_ELIGIBLE');
  const issued = Math.floor(now / 1000);
  return signEs256({ kid: env.APPLE_IAP_KEY_ID }, {
    iss: env.APPLE_IAP_ISSUER_ID, iat: issued, exp: issued + 1800, aud: 'appstoreconnect-v1', bid: env.APPLE_BUNDLE_ID,
  }, env.APPLE_IAP_PRIVATE_KEY);
}
export async function fetchSubscription(env, originalTransactionId, now = Date.now()) {
  const token = await storeToken(env, now);
  const result = await providerFetch(`${urls(env).store}/inApps/v1/subscriptions/${encodeURIComponent(originalTransactionId)}`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
  });
  if (result.status === 404) failure('NOT_ELIGIBLE');
  if (!result.ok || !result.data) failure('PROVIDER');
  return result.data;
}
// كل JWS من آبل (معاملة، تجديد، إشعار) يُتحقق من توقيعه وسلسلة x5c حتى الجذر المثبّت.
export const verifySigned = (env, token, now = Date.now()) => verifyAppleJws(token, { now, rootSha256: rootFingerprint(env) });

// يستخرج آخر معاملة للاشتراك ويحوّلها إلى صف قابل للتخزين بعد كل الفحوص.
export async function readSubscriptionStatus(env, status, originalTransactionId, now = Date.now()) {
  const groups = Array.isArray(status?.data) ? status.data : [];
  let entry = null;
  for (const group of groups) {
    for (const last of group.lastTransactions || []) {
      if (!originalTransactionId || last.originalTransactionId === originalTransactionId) { entry = last; break; }
    }
    if (entry) break;
  }
  if (!entry || !entry.signedTransactionInfo) failure('NOT_ELIGIBLE');
  const info = await verifySigned(env, entry.signedTransactionInfo, now);
  const renewal = entry.signedRenewalInfo ? await verifySigned(env, entry.signedRenewalInfo, now) : {};
  const bundleId = info.bundleId || status.bundleId;
  if (env.APPLE_BUNDLE_ID && bundleId !== env.APPLE_BUNDLE_ID) failure('NOT_ELIGIBLE');
  if (!Object.values(PRODUCTS).includes(info.productId)) failure('NOT_ELIGIBLE');
  const external = info.originalTransactionId || entry.originalTransactionId || originalTransactionId;
  if (!external) failure('INVALID');
  const until = Math.max(Number(info.expiresDate) || 0, Number(renewal.gracePeriodExpiresDate) || 0);
  return {
    source: 'apple', external_id: String(external), product: info.productId,
    status: STATUS_TEXT[entry.status] || 'unknown', until,
    will_renew: renewal.autoRenewStatus === 1,
    environment: info.environment || status.environment || null,
    occurred_at: Number(info.signedDate) || now,
    appAccountToken: info.appAccountToken ? String(info.appAccountToken).toLowerCase() : null,
  };
}

// ربط معاملة بحساب: appAccountToken هو معرّف المستخدم، فالعميل لا يستطيع ادّعاء معاملة غيره.
export async function bindTransaction(env, user, jws, now = Date.now()) {
  // توقيع الجهاز (jwsRepresentation من StoreKit) يُتحقق منه قبل أن نسأل آبل عنه.
  const hint = await verifySigned(env, jws, now);
  const originalTransactionId = hint.originalTransactionId || hint.transactionId;
  if (!originalTransactionId) failure('INVALID');
  const status = await fetchSubscription(env, String(originalTransactionId), now);
  const row = await readSubscriptionStatus(env, status, String(originalTransactionId), now);
  if (row.appAccountToken && row.appAccountToken !== String(user.id).toLowerCase()) failure('ALREADY_LINKED');
  const existing = await db.subscriptionByExternal(env, 'apple', row.external_id);
  if (existing && existing.user_id !== user.id) failure('ALREADY_LINKED');
  await db.upsertSubscription(env, { ...row, user_id: user.id });
  return row;
}

// إشعارات App Store V2: تصل بلا مصادقة، فالتوقيع وسلسلة x5c يُفحصان أولًا (وإلا استطاع
// أي طرف إسقاط إشعار حقيقي بتكرار notificationUUID)، ثم التكرار، ثم نسأل آبل.
export async function handleNotification(env, signedPayload, now = Date.now()) {
  const payload = await verifySigned(env, signedPayload, now);
  const uuid = payload.notificationUUID;
  if (!uuid) failure('INVALID');
  if (!(await db.markWebhookEvent(env, `apple:${uuid}`, now))) return json({ ok: true, duplicate: true });
  const data = payload.data || {};
  const info = data.signedTransactionInfo ? await verifySigned(env, data.signedTransactionInfo, now) : {};
  const originalTransactionId = info.originalTransactionId || data.originalTransactionId;
  if (!originalTransactionId) return json({ ok: true, ignored: 'no-transaction' }, 202);
  const existing = await db.subscriptionByExternal(env, 'apple', String(originalTransactionId));
  if (!existing) return json({ ok: true, ignored: 'unknown-transaction' }, 202);
  const status = await fetchSubscription(env, String(originalTransactionId), now);
  const row = await readSubscriptionStatus(env, status, String(originalTransactionId), now);
  await db.upsertSubscription(env, { ...row, user_id: existing.user_id });
  return json({ ok: true });
}
