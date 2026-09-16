// عميل HTTP لواجهة الحسابات. عنوان الخادم هو نفسه عنوان الغرف (Online.jsx)
// فلا يوجد إعداد ثانٍ: __MAYDAN_ROOMS_URL__ وقت البناء ثم online.config.json،
// ويمرّان بـ resolveServerUrl نفسها من src/online/shared.js.
import config from '../../../online.config.json';
import { resolveServerUrl } from '../../online/shared.js';
import { ClientError } from '../../online/client.js';

export { ClientError };

// ترويسة تدوير الجلسة المنزلق (الخادم يعرضها في CORS).
export const SESSION_HEADER = 'x-maydan-session';
export const DEFAULT_TIMEOUT = 15_000;

// يُحسب عند كل نداء: الاختبارات تبدّل location، والبناء يثبّت __MAYDAN_ROOMS_URL__.
export function resolveAccountServer() {
  const configured = (typeof __MAYDAN_ROOMS_URL__ !== 'undefined' && __MAYDAN_ROOMS_URL__) || (config && config.serverUrl) || '';
  return resolveServerUrl(configured, typeof location === 'undefined' ? '' : location.origin);
}

// بلا خادم مضبوط تعمل طبقة الحساب «دون اتصال»: لا اشتراك، لا دخول، تجارب محلية فقط.
export function accountOffline() { return !resolveAccountServer(); }

export function readRotatedSession(response) {
  try {
    const value = response && response.headers && typeof response.headers.get === 'function' ? response.headers.get(SESSION_HEADER) : null;
    return typeof value === 'string' && value ? value : null;
  } catch (error) {
    return null;
  }
}

// الحالة → كود خطأ من errors.js؛ جسم الخادم `{ error: CODE }` له الأولوية.
function mapError(status, bodyCode) {
  if (status === 401) return bodyCode === 'AUTH_EXPIRED' || bodyCode === 'SIGNATURE' ? bodyCode : 'AUTH_REQUIRED';
  if (status === 402) return 'PLUS_REQUIRED';
  if (status === 429) return 'RATE_LIMIT';
  return bodyCode || 'NETWORK';
}

// request(path, { method, body, token, timeout, raw })
// raw: يعيد الاستجابة كما هي بلا تحليل JSON (للردود 204).
// onSession: يُنادى بالرمز الجديد حين يدوّر الخادم الجلسة (حتى مع خطأ).
export async function request(path, { method = 'GET', body, token, timeout = DEFAULT_TIMEOUT, raw = false, onSession, fetchImpl, server } = {}) {
  const base = server === undefined ? resolveAccountServer() : server;
  if (!base) throw new ClientError('OFFLINE');
  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!doFetch) throw new ClientError('NETWORK');
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeout) : null;
  let response;
  try {
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    response = await doFetch(`${base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller ? controller.signal : undefined,
      credentials: 'omit',
      cache: 'no-store',
    });
  } catch (error) {
    throw error instanceof ClientError ? error : new ClientError('NETWORK');
  } finally {
    if (timer) clearTimeout(timer);
  }
  const rotated = readRotatedSession(response);
  if (rotated && onSession) { try { onSession(rotated); } catch (error) { /* المستدعي مسؤول */ } }
  if (raw) {
    if (!response.ok) throw new ClientError(mapError(response.status, null));
    return response;
  }
  let payload = null;
  if (response.status !== 204) { try { payload = await response.json(); } catch (error) { payload = null; } }
  if (!response.ok) throw new ClientError(mapError(response.status, payload && payload.error));
  if (response.status === 204) return null;
  if (payload === null) throw new ClientError('NETWORK');
  return payload;
}

// ── نداءات المسارات (كلها تمرّر options إلى request) ───────────────────────
export const getBillingConfig = (options) => request('/api/billing/config', options);
export const getMe = (options) => request('/api/me', options);
export const exchangeCode = (code, client, options) => request('/api/auth/exchange', { ...options, method: 'POST', body: { code, client } });
export const appleNative = (payload, options) => request('/api/auth/apple/native', { ...options, method: 'POST', body: { ...payload, client: 'ios' } });
export const signout = (options) => request('/api/auth/signout', { ...options, method: 'POST', raw: true });
export const postTrial = (game, options) => request(`/api/trials/${encodeURIComponent(game)}`, { ...options, method: 'POST' });
export const mergeTrialsRequest = (games, options) => request('/api/trials/merge', { ...options, method: 'POST', body: { games } });
export const postAppleTransaction = (jws, options) => request('/api/apple/transactions', { ...options, method: 'POST', body: { jws } });
export const createPaddleCheckout = (plan, options) => request('/api/paddle/checkout', { ...options, method: 'POST', body: { plan } });
export const getPaddlePortal = (options) => request('/api/paddle/portal', options);
export const deleteAccountRequest = (options) => request('/api/account', { ...options, method: 'DELETE', raw: true });

// رابط بدء الدخول على الويب: الخادم يعيد التوجيه إلى المزوّد ثم إلى return#/auth?code=
export function authStartUrl(provider, { client = 'web', returnUrl, server } = {}) {
  const base = server === undefined ? resolveAccountServer() : server;
  if (!base) return '';
  const target = returnUrl || (typeof location === 'undefined' ? '' : `${location.origin}${location.pathname}`);
  return `${base}/api/auth/${provider}/start?client=${encodeURIComponent(client)}&return=${encodeURIComponent(target)}`;
}
