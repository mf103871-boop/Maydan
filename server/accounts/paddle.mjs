// Paddle Billing: إنشاء معاملة للدفع على الويب، وقراءة الـwebhook بتوقيعه على الجسم الخام.
import { PRODUCTS } from '../../src/shared/account/config.js';
import { failure } from './errors.mjs';
import { hmacHex, providerFetch, safeEqual } from './jwt.mjs';
import * as db from './db.mjs';

export const environmentOf = (env) => (env.PADDLE_ENV === 'production' ? 'production' : 'sandbox');
export const apiUrl = (env) => String(env.PADDLE_API_URL || (environmentOf(env) === 'production' ? 'https://api.paddle.com' : 'https://sandbox-api.paddle.com')).replace(/\/+$/, '');
export const prices = (env) => ({ monthly: env.PADDLE_PRICE_MONTHLY || '', yearly: env.PADDLE_PRICE_YEARLY || '' });
export const configured = (env) => {
  const price = prices(env);
  return !!(env.PADDLE_CLIENT_TOKEN && env.PADDLE_API_KEY && price.monthly && price.yearly);
};
export function publicConfig(env) {
  if (!configured(env)) return null;
  return { clientToken: env.PADDLE_CLIENT_TOKEN, environment: environmentOf(env), prices: prices(env) };
}
// معرّف السعر ← معرّف المنتج المشترك مع العميل والمتجر.
export function productOf(env, priceId) {
  const price = prices(env);
  if (priceId && priceId === price.monthly) return PRODUCTS.monthly;
  if (priceId && priceId === price.yearly) return PRODUCTS.yearly;
  return null;
}

async function api(env, path, { method = 'GET', body } = {}) {
  const result = await providerFetch(`${apiUrl(env)}${path}`, {
    method,
    headers: { authorization: `Bearer ${env.PADDLE_API_KEY}`, 'content-type': 'application/json', accept: 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return result;
}

// عميل Paddle واحد لكل حساب: نُنشئه عند أول شراء، ونلتقط المكرّر إن كان البريد مستعملًا.
export async function ensureCustomer(env, user) {
  const stored = await db.paddleCustomerOf(env, user.id);
  if (stored) return stored.customer_id;
  const created = await api(env, '/customers', { method: 'POST', body: { email: user.email || `${user.id}@users.maydan.invalid`, name: user.name || undefined, custom_data: { userId: user.id } } });
  let id = created.data?.data?.id;
  if (!id && created.status === 409 && user.email) {
    const found = await api(env, `/customers?email=${encodeURIComponent(user.email)}`);
    id = found.data?.data?.[0]?.id;
  }
  if (!id) failure('PROVIDER');
  await db.setPaddleCustomer(env, user.id, id);
  return id;
}

// custom_data.userId هو ما يربط الـwebhook بالحساب لاحقًا؛ بدونه لا نعرف لمن الاشتراك.
export async function createTransaction(env, user, plan) {
  const priceId = prices(env)[plan];
  if (!priceId) failure('INVALID');
  const customerId = await ensureCustomer(env, user);
  const result = await api(env, '/transactions', { method: 'POST', body: {
    items: [{ price_id: priceId, quantity: 1 }],
    customer_id: customerId,
    custom_data: { userId: user.id },
  } });
  const id = result.data?.data?.id;
  if (!result.ok || !id) failure('PROVIDER');
  return { transactionId: id, clientToken: env.PADDLE_CLIENT_TOKEN, environment: environmentOf(env) };
}

export async function portalUrl(env, user) {
  const stored = await db.paddleCustomerOf(env, user.id);
  if (!stored) failure('NOT_ELIGIBLE');
  const result = await api(env, `/customers/${encodeURIComponent(stored.customer_id)}/portal-sessions`, { method: 'POST', body: {} });
  const urls = result.data?.data?.urls;
  const url = urls?.general?.overview || urls?.overview;
  if (!result.ok || !url) failure('PROVIDER');
  return url;
}
// إلغاء بذل أفضل عند حذف الحساب: لا نُفشل الحذف إن رفض Paddle.
export async function cancelSubscription(env, subscriptionId) {
  try { await api(env, `/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, { method: 'POST', body: { effective_from: 'next_billing_period' } }); }
  catch { /* الحذف يمضي؛ الاشتراك ينتهي في دورته */ }
}

// ── التوقيع ─────────────────────────────────────────────────────────────────
export const SIGNATURE_SKEW = 5 * 60 * 1000;
export function parseSignature(header) {
  const parts = Object.fromEntries(String(header || '').split(';').map((part) => {
    const index = part.indexOf('=');
    return index < 0 ? ['', ''] : [part.slice(0, index).trim(), part.slice(index + 1).trim()];
  }));
  return { ts: parts.ts, h1: parts.h1 };
}
// التوقيع على `${ts}:${الجسم الخام}` — لذلك لا نمرّ على readJson هنا أبدًا.
export async function verifySignature(env, header, rawBody, now = Date.now()) {
  if (!env.PADDLE_WEBHOOK_SECRET) failure('NOT_ELIGIBLE');
  const { ts, h1 } = parseSignature(header);
  if (!ts || !h1 || !/^\d+$/.test(ts)) failure('SIGNATURE');
  if (Math.abs(now - Number(ts) * 1000) > SIGNATURE_SKEW) failure('SIGNATURE');
  if (!safeEqual(h1, await hmacHex(env.PADDLE_WEBHOOK_SECRET, `${ts}:${rawBody}`))) failure('SIGNATURE');
  return true;
}

const ACTIVE = new Set(['active', 'trialing', 'past_due']);
const time = (value) => (value ? Date.parse(value) || 0 : 0);

// تحويل حدث اشتراك إلى صف؛ يُعيد null للأحداث التي لا تخصّ اشتراكًا نعرفه.
export function subscriptionRow(env, event, now = Date.now()) {
  const data = event?.data;
  if (!data?.id || !String(event.event_type || '').startsWith('subscription.')) return null;
  const priceId = data.items?.[0]?.price?.id || data.items?.[0]?.price_id;
  const until = Math.max(time(data.current_billing_period?.ends_at), time(data.next_billed_at), time(data.scheduled_change?.effective_at));
  const status = String(data.status || '').toLowerCase();
  return {
    source: 'paddle', external_id: String(data.id), product: productOf(env, priceId),
    status, until: status === 'canceled' && !until ? 0 : until,
    will_renew: ACTIVE.has(status) && data.scheduled_change?.action !== 'cancel',
    environment: environmentOf(env), occurred_at: time(event.occurred_at) || now,
    userId: data.custom_data?.userId || null, customerId: data.customer_id || null,
  };
}
