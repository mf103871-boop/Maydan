import { Room } from './room.mjs';
import { readJson, json, errorResponse, sha256, credentials } from './protocol.mjs';
import { fail } from './room-model.mjs';
import { isPublicAccountPath, markRoomTrial, roomGate, routeAccounts } from './accounts/router.mjs';
import { cleanup } from './accounts/cleanup.mjs';
import { readSession } from './accounts/session.mjs';
import packageInfo from '../package.json' with { type: 'json' };
import { routeSocial } from './social/router.mjs';
import { routeSocialLive } from './social/realtime.mjs';
import { routeProfiles, isPublicProfileImagePath } from './profiles/router.mjs';
export { SocialHub } from './social/realtime.mjs';
export { Room };

// Small per-IP limits for accidental floods and room-code guessing.
// Keys contain only a digest; no raw address is persisted. These are not DDoS protection.
export const LIMIT_WINDOWS = { create: 600_000, join: 60_000, leave: 60_000, socket: 60_000,
  auth: 600_000, me: 60_000, billing: 600_000, trial: 60_000, socialRead: 60_000, socialWrite: 60_000,
  profileRead: 60_000, profileWrite: 60_000, profileImage: 60_000 };
// حدّ كل نوع داخل نافذته. مسارات الحسابات أقلّ سخاءً من قراءة الحالة لأنها تكتب أو تنادي مزوّدًا.
export const LIMITS = { create: 8, join: 40, leave: 100, socket: 100,
  auth: 40, me: 120, billing: 30, trial: 60, socialRead: 240, socialWrite: 60,
  profileRead: 240, profileWrite: 30, profileImage: 600 };
export class RequestLimiter {
  constructor(ctx) { this.ctx = ctx; }
  async fetch(request) {
    const { kind, refund = false } = await request.json();
    const windowMs = LIMIT_WINDOWS[kind] ?? 60_000;
    const limit = LIMITS[kind] ?? 100;
    const now = Date.now();
    // A refund returns the reservation taken by an attempt the server itself
    // rejected, so a mistyped setting never costs the host their quota.
    if (refund) {
      await this.ctx.storage.transaction(async (tx) => {
        const entry = await tx.get(kind);
        if (entry && now < entry.until && entry.count > 0) { entry.count--; await tx.put(kind, entry); }
      });
      return json({ allowed: true, refunded: true });
    }
    const result = await this.ctx.storage.transaction(async (tx) => {
      let entry = await tx.get(kind);
      if (!entry || now >= entry.until) entry = { count: 0, until: now + windowMs };
      if (entry.count >= limit) return { allowed: false, retryAfter: Math.max(1, Math.ceil((entry.until - now) / 1000)) };
      entry.count++;
      await tx.put(kind, entry);
      await tx.setAlarm(now + 600_000);
      return { allowed: true };
    });
    return json(result, result.allowed ? 200 : 429);
  }
  async alarm() { await this.ctx.storage.deleteAll(); }
}
function allowedOrigin(request, env) {
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const origin = request.headers.get('origin');
  if (origin) return allowed.includes(origin) ? origin : null;
  // طلبات GET من الصفحة نفسها (النشر الكامل على Cloudflare) لا تحمل Origin أصلًا:
  // تُقبل حين يثبت المتصفح أنها من الأصل نفسه (Sec-Fetch-Site، أو Referer للمتصفحات
  // الأقدم) وكان هذا الأصل مسموحًا. الكتابة (POST/DELETE) تحمل Origin دائمًا فتبقى كما هي.
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const self = new URL(request.url).origin;
  if (!allowed.includes(self)) return null;
  if (request.headers.get('sec-fetch-site') === 'same-origin') return self;
  try { const referer = request.headers.get('referer'); if (referer && new URL(referer).origin === self) return self; } catch { /* مرجع تالف */ }
  return null;
}
async function roomAccountId(request, env) {
  if (!env.DB) return null;
  try { return (await readSession(env, request, { rotate: false }))?.user.id || null; }
  catch (error) { if (error.status === 401) return null; throw error; }
}
export async function routeRequest(request, env) {
  const url = new URL(request.url);
  // HEAD keeps `curl -I` and uptime monitors working; it must not fall through
  // to the origin check and answer 403/404.
  if (url.pathname === '/health' && ['GET', 'HEAD'].includes(request.method)) {
    const health = json({ ok: true, protocol: 1, game: 'meenfina', games: ['meenfina', 'fabraka'], version: packageInfo.version, accounts: !!env.DB });
    return request.method === 'HEAD' ? new Response(null, { status: health.status, headers: health.headers }) : health;
  }
  const origin = allowedOrigin(request, env);
  // إعادة توجيه المزوّدات وwebhooks تصل بلا Origin: فحص الأصل لا ينطبق عليها،
  // وحمايتها هي توقيع المزوّد نفسه (state موقّع، HMAC، أو JWS من آبل).
  const publicImage = ['GET', 'HEAD'].includes(request.method) && isPublicProfileImagePath(url.pathname);
  if (!origin && !isPublicAccountPath(url.pathname) && !publicImage) return json({ error: 'ORIGIN' }, 403);
  const headers = origin ? { 'access-control-allow-origin': origin, vary: 'Origin',
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'access-control-allow-headers': 'Content-Type, Authorization',
    'access-control-expose-headers': 'x-maydan-session',
    'access-control-max-age': '600' } : {};
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  let response; let limiter = null; let charged = null;
  // حصّة واحدة لكل عنوان يوميًا، تتفرّع بالنوع؛ المفتاح ملخّص فقط ولا يُخزَّن العنوان.
  async function charge(kind, code = 'RATE_LIMIT') {
    if (!limiter) {
      const address = request.headers.get('cf-connecting-ip') || 'local';
      const key = await sha256(`${new Date().toISOString().slice(0, 10)}:${address}`);
      limiter = env.LIMITERS.get(env.LIMITERS.idFromName(key));
    }
    const limited = await limiter.fetch(new Request('https://internal/limit', { method: 'POST', body: JSON.stringify({ kind }) }));
    if (!limited.ok) fail(code, 429);
  }
  try {
    // الحسابات أولًا: مساراتها تحت /api/ ولا تتقاطع مع تعبير الغرف.
    response = await routeSocialLive(request, env, url, charge)
      || await routeProfiles(request, env, url, charge)
      || await routeSocial(request, env, url, charge)
      || await routeAccounts(request, env, url, charge);
    if (!response) {
      const create = request.method === 'POST' && url.pathname === '/api/rooms';
      const match = url.pathname.match(/^\/api\/rooms\/(\d{6})\/(join|leave|socket)$/);
      if (!create && (!match || (match[2] === 'socket' ? request.method !== 'GET' : request.method !== 'POST'))) fail('NOT_FOUND', 404);
      const kind = create ? 'create' : match[2];
      await charge(kind, kind === 'create' ? 'CREATE_LIMIT' : 'RATE_LIMIT');
      // Only creation refunds: a wrong room code must still cost its join slot so
      // the limiter keeps discouraging code guessing.
      charged = create ? kind : null;
      if (create) {
        const input = await readJson(request);
        await credentials(input); // Validate before allocating a room.
        // إنشاء الغرفة يُحسب مباراة للّعبة: المسجّل غير المشترك يُرفض بـPLUS_REQUIRED
        // بعد تجربته، والمجهول يبقى مسموحًا (علامته محلية عند العميل).
        const gate = await roomGate(request, env, input);
        // Ignore any account ID supplied by the client. The seat's account
        // association comes only from the authenticated bearer session.
        input.accountUserId = gate?.userId || null;
        // Attempt 0 stays derived from the token so a retried creation is idempotent
        // without a global directory; later attempts are random so a collision run
        // never reproduces the same five codes.
        for (let attempt = 0; attempt < 5; attempt++) {
          const digest = await sha256(`${input.token}:${attempt === 0 ? 0 : `${attempt}:${crypto.randomUUID()}`}`);
          const code = String(100000 + parseInt(digest.slice(0, 12), 16) % 900000);
          const room = env.ROOMS.get(env.ROOMS.idFromName(code));
          response = await room.fetch(new Request(`https://internal/create?code=${code}`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
          }));
          if (response.status !== 409 || (await response.clone().json()).error !== 'COLLISION') break;
          response = null;
        }
        // Exhausted candidates are a code-space collision, not a flood by this phone.
        if (!response) fail('COLLISION', 409);
        if (response.status === 201) await markRoomTrial(env, gate);
      } else {
        const room = env.ROOMS.get(env.ROOMS.idFromName(match[1]));
        if (kind === 'join') {
          const input = await readJson(request);
          await credentials(input);
          input.accountUserId = await roomAccountId(request, env);
          response = await room.fetch(new Request(`https://internal/${match[1]}/join`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
          }));
        } else response = await room.fetch(request);
      }
    }
  } catch (error) { response = errorResponse(error); }
  // Only work the server actually performed keeps its slot: a 4xx we produced
  // ourselves (a rejected setting, a bad name) hands the reservation back.
  if (charged && response.status >= 400 && response.status < 500 && response.status !== 429) {
    try { await limiter.fetch(new Request('https://internal/limit', { method: 'POST', body: JSON.stringify({ kind: charged, refund: true }) })); }
    catch { /* the window expires on its own */ }
  }
  if (response.status === 101) return response;
  const allHeaders = new Headers(response.headers);
  for (const [key, value] of Object.entries(headers)) allHeaders.set(key, value);
  return new Response(response.body, { status: response.status, headers: allHeaders });
}
// Cron Trigger (wrangler triggers.crons): تنظيف الجلسات ورموز الدخول وسجل webhooks.
export async function scheduled(event, env) {
  const result = await cleanup(env, Date.now());
  console.log('accounts cleanup', JSON.stringify(result));
}
export default { fetch: routeRequest, scheduled };
