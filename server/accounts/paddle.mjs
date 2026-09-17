// Paddle Billing: إنشاء معاملة للدفع على الويب، وقراءة الـwebhook بتوقيعه على الجسم الخام.
import { PRODUCTS } from '../../src/shared/account/config.js';
import { failure } from './errors.mjs';
import { hmacHex, providerFetch, safeEqual } from './jwt.mjs';
import * as db from './db.mjs';
import { paddleEnvironmentOf } from './billing-environment.mjs';

export const environmentOf = paddleEnvironmentOf;
// Test-provider overrides are only for Sandbox. A live key must never be sent
// to a stale Sandbox/local override while switching environments.
export const apiUrl = (env) => environmentOf(env) === 'production'
  ? 'https://api.paddle.com'
  : String(env.PADDLE_API_URL || 'https://sandbox-api.paddle.com').replace(/\/+$/, '');
export const prices = (env) => ({ monthly: env.PADDLE_PRICE_MONTHLY || '', yearly: env.PADDLE_PRICE_YEARLY || '' });
// Preparing live credentials must not enable sales before merchant/domain approval.
// Sandbox keeps its existing behavior; live requires an explicit release switch.
export const checkoutEnabled = (env) => environmentOf(env) === 'production'
  ? env.PADDLE_CHECKOUT_ENABLED === 'true'
  : env.PADDLE_CHECKOUT_ENABLED !== 'false';
export const configured = (env) => {
  const price = prices(env);
  return !!(env.PADDLE_CLIENT_TOKEN && env.PADDLE_API_KEY && env.PADDLE_WEBHOOK_SECRET && (price.monthly || price.yearly));
};
export function publicConfig(env) {
  if (!configured(env)) return null;
  return { clientToken: env.PADDLE_CLIENT_TOKEN, environment: environmentOf(env), prices: prices(env), checkoutEnabled: checkoutEnabled(env) };
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

// Legacy IDs have no recorded environment. A read in the selected Paddle
// account must confirm the ID before it can be used for checkout or the portal.
async function existingCustomer(env, user) {
  const stored = await db.paddleCustomerOf(env, user.id);
  if (stored) return stored.customer_id;
  const legacy = await db.legacyPaddleCustomerOf(env, user.id);
  if (!legacy) return null;
  const result = await api(env, `/customers/${encodeURIComponent(legacy.customer_id)}`);
  if (result.status === 404) return null;
  if (!result.ok || result.data?.data?.id !== legacy.customer_id) failure('PROVIDER');
  await db.setPaddleCustomer(env, user.id, legacy.customer_id);
  return legacy.customer_id;
}

// عميل مستقل لكل حساب وبيئة: معرف الاختبار لا يدخل معاملة إنتاجية.
export async function ensureCustomer(env, user) {
  const stored = await existingCustomer(env, user);
  if (stored) return stored;
  // بعض هويات Apple لا تحمل بريدًا؛ يدخله اللاعب في Checkout بدل عنوان مختلق.
  if (!user.email) return null;
  const created = await api(env, '/customers', { method: 'POST', body: { email: user.email, name: user.name || undefined, custom_data: { userId: user.id } } });
  let id = created.data?.data?.id;
  if (!id && created.status === 409 && user.email) {
    const found = await api(env, `/customers?email=${encodeURIComponent(user.email)}`);
    id = found.data?.data?.[0]?.id;
  }
  if (!id) failure('PROVIDER');
  await db.setPaddleCustomer(env, user.id, id);
  return id;
}

const checkoutResult = (env, id) => ({ transactionId: id, clientToken: env.PADDLE_CLIENT_TOKEN, environment: environmentOf(env) });
const transactionMatches = (row, data) => data?.id && data.custom_data?.userId === row.user_id
  && data.custom_data?.checkoutAttemptId === row.attempt_id
  && data.items?.some((item) => (item.price?.id || item.price_id) === row.price_id);

async function readCheckout(env, row) {
  let result;
  try { result = await api(env, `/transactions/${encodeURIComponent(row.transaction_id)}`); }
  catch { failure('CHECKOUT_REVIEW'); }
  if (!result.ok || result.data?.data?.id !== row.transaction_id || !transactionMatches(row, result.data.data)) failure('CHECKOUT_REVIEW');
  return result.data.data;
}

async function previousSubscriptionEnded(env, transaction, now = Date.now()) {
  if (transaction.status !== 'completed' || !transaction.subscription_id) return false;
  let result;
  try { result = await api(env, `/subscriptions/${encodeURIComponent(transaction.subscription_id)}`); }
  catch { failure('CHECKOUT_REVIEW'); }
  const subscription = result.data?.data;
  if (!result.ok || subscription?.id !== transaction.subscription_id) failure('CHECKOUT_REVIEW');
  if (subscription.status !== 'canceled') return false; // Paused subscriptions can resume and bill again.
  const end = Date.parse(subscription.current_billing_period?.ends_at || subscription.canceled_at || '');
  return Number.isFinite(end) && end <= now;
}

// Signed transaction events repair a POST whose response or DB write was lost.
// They never grant access; the subscription event remains the entitlement source.
export async function recoverCheckoutEvent(env, event) {
  if (!['transaction.created', 'transaction.updated'].includes(event.event_type)) return false;
  const data = event.data, userId = data?.custom_data?.userId;
  if (!userId || !data?.custom_data?.checkoutAttemptId) return false;
  const row = await db.paddleCheckoutOf(env, userId);
  if (!row || !transactionMatches(row, data)) return false;
  return db.recordPaddleTransaction(env, userId, row.attempt_id, data.id);
}

// custom_data includes a durable attempt ID. Paddle has no client-supplied
// idempotency key, so an uncertain POST must never be automatically repeated.
export async function createTransaction(env, user, plan) {
  if (!checkoutEnabled(env)) failure('CHECKOUT_DISABLED');
  const priceId = prices(env)[plan];
  if (!priceId) failure('INVALID');
  const attemptId = crypto.randomUUID();
  let owned = await db.reservePaddleCheckout(env, user.id, plan, priceId, attemptId);
  if (!owned) {
    const previous = await db.paddleCheckoutOf(env, user.id);
    if (!previous) failure('CHECKOUT_PENDING');
    if (!previous.transaction_id) failure(previous.state === 'unknown' ? 'CHECKOUT_REVIEW' : 'CHECKOUT_PENDING');
    const transaction = await readCheckout(env, previous);
    if (['draft', 'ready'].includes(transaction.status)) {
      if (previous.plan !== plan || previous.price_id !== priceId) failure('CHECKOUT_PENDING');
      return checkoutResult(env, previous.transaction_id);
    }
    if (transaction.status !== 'canceled' && !await previousSubscriptionEnded(env, transaction)) failure('CHECKOUT_PENDING');
    // Conditional release plus atomic insert: only one parallel retry wins.
    await db.releasePaddleCheckout(env, user.id, previous.attempt_id);
    owned = await db.reservePaddleCheckout(env, user.id, plan, priceId, attemptId);
    if (!owned) failure('CHECKOUT_PENDING');
  }
  let customerId;
  try { customerId = await ensureCustomer(env, user); }
  catch (error) { await db.releasePaddleCheckout(env, user.id, attemptId); throw error; }
  let result;
  try {
    result = await api(env, '/transactions', { method: 'POST', body: {
      items: [{ price_id: priceId, quantity: 1 }],
      ...(customerId ? { customer_id: customerId } : {}),
      custom_data: { userId: user.id, checkoutAttemptId: attemptId },
    } });
  } catch {
    await db.markPaddleCheckoutUnknown(env, user.id, attemptId).catch(() => {});
    failure('CHECKOUT_REVIEW');
  }
  if (!result.ok || !result.data?.data?.id) {
    // An explicit structured validation/auth rejection confirms no transaction.
    // Network, 5xx, malformed, rate-limit and ambiguous conflict responses do not.
    if ([400, 401, 403, 404, 422].includes(result.status) && result.data?.error?.code && result.data.error.type) {
      await db.releasePaddleCheckout(env, user.id, attemptId);
      failure('PROVIDER');
    }
    await db.markPaddleCheckoutUnknown(env, user.id, attemptId).catch(() => {});
    failure('CHECKOUT_REVIEW');
  }
  const id = result.data.data.id;
  try {
    if (!await db.recordPaddleTransaction(env, user.id, attemptId, id)) failure('CHECKOUT_REVIEW');
  } catch {
    await db.markPaddleCheckoutUnknown(env, user.id, attemptId).catch(() => {});
    failure('CHECKOUT_REVIEW');
  }
  return checkoutResult(env, id);
}

// Never erase the only account binding for an uncertain or still-payable link.
export async function checkDeletionCheckout(env, user) {
  // A sandbox endpoint cannot erase a live attempt it has no credentials to inspect.
  if (environmentOf(env) !== 'production' && await db.first(env, "SELECT attempt_id FROM paddle_checkouts WHERE user_id = ? AND environment = 'production'", user.id)) failure('CHECKOUT_REVIEW');
  const row = await db.paddleCheckoutOf(env, user.id);
  if (!row) return;
  if (!row.transaction_id) failure('CHECKOUT_REVIEW');
  const transaction = await readCheckout(env, row);
  if (transaction.status === 'canceled') return;
  if (transaction.status === 'completed' && transaction.subscription_id) {
    const subscription = await db.subscriptionByExternal(env, 'paddle', transaction.subscription_id);
    if (subscription?.user_id === user.id && subscription.environment === environmentOf(env)) return;
  }
  failure('CHECKOUT_REVIEW');
}

export async function portalUrl(env, user) {
  const customerId = await existingCustomer(env, user);
  if (!customerId) failure('NOT_ELIGIBLE');
  const result = await api(env, `/customers/${encodeURIComponent(customerId)}/portal-sessions`, { method: 'POST', body: {} });
  const urls = result.data?.data?.urls;
  const url = urls?.general?.overview || urls?.overview;
  if (!result.ok || !url) failure('PROVIDER');
  return url;
}
// لا نحذف وسيلة إدارة الاشتراك قبل تأكيد وقف التجديد من المزوّد.
export const mayResumeBilling = (subscription) => subscription.will_renew
  || ['active', 'trialing', 'past_due', 'paused'].includes(subscription.status);
export async function cancelSubscription(env, subscriptionId, { verifyFirst = false } = {}) {
  let effectiveFrom = 'next_billing_period';
  if (verifyFirst) {
    // A local will_renew=false may mean scheduled cancel, or merely a pause.
    // Confirm which one before removing the account's management access.
    const current = await api(env, `/subscriptions/${encodeURIComponent(subscriptionId)}`);
    if (!current.ok || current.data?.data?.id !== subscriptionId) failure('BILLING_CANCEL_FAILED');
    const subscription = current.data.data;
    if (subscription.status === 'canceled' || subscription.scheduled_change?.action === 'cancel') return;
    if (subscription.status === 'paused') effectiveFrom = 'immediately';
  }
  const result = await api(env, `/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, { method: 'POST', body: { effective_from: effectiveFrom } });
  if (!result.ok) {
    // إعادة طلب حذف فشل بعد إلغاء سابق لا تعلّق الحساب إلى الأبد.
    const current = await api(env, `/subscriptions/${encodeURIComponent(subscriptionId)}`);
    if (!current.ok || (current.data?.data?.status !== 'canceled' && current.data?.data?.scheduled_change?.action !== 'cancel')) failure('BILLING_CANCEL_FAILED');
  }
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
  const expected = await hmacHex(env.PADDLE_WEBHOOK_SECRET, `${ts}:${rawBody}`);
  const signatures = String(header).split(';').map((part) => part.trim()).filter((part) => part.startsWith('h1=')).map((part) => part.slice(3));
  if (!signatures.some((signature) => safeEqual(signature, expected))) failure('SIGNATURE');
  return true;
}

const ACTIVE = new Set(['active', 'trialing', 'past_due']);
const time = (value) => (value ? Date.parse(value) || 0 : 0);

// تحويل حدث اشتراك إلى صف؛ يُعيد null للأحداث التي لا تخصّ اشتراكًا نعرفه.
export function subscriptionRow(env, event, now = Date.now()) {
  const data = event?.data;
  if (!data?.id || !String(event.event_type || '').startsWith('subscription.')) return null;
  const item = data.items?.find((entry) => productOf(env, entry.price?.id || entry.price_id));
  const priceId = item?.price?.id || item?.price_id;
  if (!priceId) return null;
  const until = Math.max(time(data.current_billing_period?.ends_at), time(data.next_billed_at), time(data.scheduled_change?.effective_at));
  const status = String(data.status || '').toLowerCase();
  return {
    source: 'paddle', external_id: String(data.id), product: productOf(env, priceId),
    status, until: ACTIVE.has(status) ? until : 0,
    will_renew: ACTIVE.has(status) && !['cancel', 'pause'].includes(data.scheduled_change?.action),
    environment: environmentOf(env), occurred_at: time(event.occurred_at) || now,
    userId: data.custom_data?.userId || null, customerId: data.customer_id || null,
  };
}
