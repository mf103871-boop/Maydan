// جلسات مبهمة: الخادم يخزّن sha256(السر) فقط، فتسريب القاعدة لا يعطي رموزًا صالحة.
// الشكل: mdn1.<معرّف 16 hex>.<سر base64url من 32 بايت>
import { sha256 } from '../protocol.mjs';
import { failure } from './errors.mjs';
import { base64url, bytesFromBase64url, hmacHex, randomHex, randomToken, safeEqual } from './jwt.mjs';
import * as db from './db.mjs';
import { meResponse } from './entitlements.mjs';

export const SESSION_TTL = 180 * 24 * 60 * 60 * 1000; // 180 يومًا
export const ROTATE_AFTER = 24 * 60 * 60 * 1000;      // تدوير منزلق بعد يوم من آخر استعمال
export const ROTATE_GRACE = 5 * 60 * 1000;            // الرمز القديم يبقى صالحًا 5 دقائق بعد التدوير
export const SESSION_HEADER = 'x-maydan-session';

export function parseToken(value) {
  const parts = String(value || '').split('.');
  if (parts.length !== 3 || parts[0] !== 'mdn1' || !/^[a-f0-9]{16}$/.test(parts[1]) || !/^[A-Za-z0-9_-]{16,128}$/.test(parts[2])) return null;
  return { id: parts[1], secret: parts[2] };
}
export function bearer(request) {
  const header = request.headers.get('authorization') || '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? parseToken(match[1]) : null;
}

export async function issueSession(env, userId, client = 'web', now = Date.now()) {
  const id = randomHex(8);
  const secret = randomToken(32);
  await db.insertSession(env, {
    id, user_id: userId, secret_hash: await sha256(secret), client,
    created_at: now, last_seen: now, expires_at: now + SESSION_TTL,
  });
  return { token: `mdn1.${id}.${secret}`, expiresAt: now + SESSION_TTL, id };
}

// تُعيد null للطلب المجهول، وترمي AUTH_EXPIRED لرمز موجود لكنه انتهى/أُبطل.
export async function readSession(env, request, { now = Date.now(), rotate = true } = {}) {
  const parsed = bearer(request);
  if (!parsed) return null;
  const row = await db.sessionById(env, parsed.id);
  if (!row) failure('AUTH_EXPIRED');
  if (!safeEqual(row.secret_hash, await sha256(parsed.secret))) failure('AUTH_EXPIRED');
  if (now >= row.expires_at) failure('AUTH_EXPIRED');
  if (row.revoked_at !== null && row.revoked_at !== undefined && now >= row.revoked_at) failure('AUTH_EXPIRED');
  const user = await db.userById(env, row.user_id);
  if (!user) failure('AUTH_EXPIRED');
  // الرمز في فترة السماح بعد تدويره: يعمل، لكنه لا يولّد تدويرًا ثانيًا.
  if (row.replaced_by) return { session: row, user, rotated: null };
  if (rotate && now - row.last_seen > ROTATE_AFTER) {
    const next = await issueSession(env, user.id, row.client || 'web', now);
    await db.retireSession(env, row.id, now + ROTATE_GRACE, next.id);
    return { session: row, user, rotated: next };
  }
  if (now - row.last_seen > 60_000) await db.touchSession(env, row.id, now);
  return { session: row, user, rotated: null };
}

export async function requireSession(env, request, options) {
  const found = await readSession(env, request, options);
  if (!found) failure('AUTH_REQUIRED');
  return found;
}

// ترويسة التدوير تُضاف إلى أي رد يحمل جلسة، فيستبدل العميل رمزه المخزّن.
export function withRotation(response, rotated) {
  if (!rotated) return response;
  const headers = new Headers(response.headers);
  headers.set(SESSION_HEADER, rotated.token);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export async function me(env, user, now = Date.now()) {
  const [subscriptions, trials] = await Promise.all([db.subscriptionsOf(env, user.id), db.trialsOf(env, user.id)]);
  return meResponse({ user, subscriptions, trials, now });
}

// ── رموز الدخول لمرة واحدة (تمرير الجلسة عبر إعادة التوجيه دون كشفها) ───────
export const AUTH_CODE_TTL = 60_000;
export async function issueAuthCode(env, userId, client, now = Date.now()) {
  const code = randomHex(24);
  await db.pruneAuthCodes(env, now);
  await db.insertAuthCode(env, { codeHash: await sha256(code), userId, client, expiresAt: now + AUTH_CODE_TTL });
  return code;
}
export async function redeemAuthCode(env, code, now = Date.now()) {
  if (!/^[a-f0-9]{48}$/.test(String(code || ''))) failure('STATE');
  const hash = await sha256(code);
  const row = await db.authCode(env, hash);
  if (!row) failure('STATE');
  if (!(await db.useAuthCode(env, hash, now))) failure('STATE');
  return row;
}

// ── حالة OAuth الموقّعة (بلا تخزين) ─────────────────────────────────────────
// state = base64url(JSON) + '.' + HMAC، صلاحيتها 10 دقائق ومعها nonce لربط id_token.
export const STATE_TTL = 10 * 60 * 1000;
const stateSecret = (env) => String(env.SESSION_SECRET || 'maydan-dev-session-secret');

export async function signState(env, value, now = Date.now()) {
  const body = base64url(JSON.stringify({ ...value, t: now, n: randomHex(12) }));
  return `${body}.${await hmacHex(stateSecret(env), body)}`;
}
export async function readState(env, value, now = Date.now()) {
  const [body, signature] = String(value || '').split('.');
  if (!body || !signature) failure('STATE');
  if (!safeEqual(signature, await hmacHex(stateSecret(env), body))) failure('STATE');
  let parsed;
  try { parsed = JSON.parse(new TextDecoder().decode(bytesFromBase64url(body))); } catch { return failure('STATE'); }
  if (!parsed || typeof parsed !== 'object' || !Number.isFinite(parsed.t) || now - parsed.t > STATE_TTL || parsed.t - now > 60_000) failure('STATE');
  return parsed;
}

// وجهة العودة محصورة: أصل التطبيق، أحد ALLOWED_ORIGINS/EXTRA_ORIGINS، أو مخطط iOS.
export const NATIVE_RETURN = 'maydan://auth';
export function safeReturn(env, value, client) {
  if (client === 'ios' && (!value || value === NATIVE_RETURN)) return NATIVE_RETURN;
  const origins = [env.APP_ORIGIN, ...String(env.ALLOWED_ORIGINS || '').split(','), ...String(env.EXTRA_ORIGINS || '').split(',')]
    .map((entry) => String(entry || '').trim()).filter(Boolean);
  if (!value) {
    if (env.APP_ORIGIN) return String(env.APP_ORIGIN);
    if (origins.length) return origins[0];
    failure('STATE');
  }
  if (value === NATIVE_RETURN) return NATIVE_RETURN;
  let url;
  try { url = new URL(value); } catch { return failure('STATE'); }
  if (!origins.includes(url.origin)) failure('STATE');
  return `${url.origin}${url.pathname}${url.search}`;
}
// الرمز يسافر في الشظية على الويب فلا يدخل سجلات الخادم ولا Referer.
export function returnRedirect(target, code) {
  const url = target === NATIVE_RETURN ? `${NATIVE_RETURN}?code=${encodeURIComponent(code)}` : `${target}#/auth?code=${encodeURIComponent(code)}`;
  return new Response(null, { status: 302, headers: { location: url, 'cache-control': 'no-store' } });
}
