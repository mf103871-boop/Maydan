import { Room } from './room.mjs';
import { readJson, json, errorResponse, sha256, credentials } from './protocol.mjs';
import { fail } from './room-model.mjs';
import packageInfo from '../package.json' with { type: 'json' };
export { Room };

// Small per-IP limits for accidental floods and room-code guessing.
// Keys contain only a digest; no raw address is persisted. These are not DDoS protection.
export const LIMIT_WINDOWS = { create: 600_000, join: 60_000, leave: 60_000, socket: 60_000 };
export class RequestLimiter {
  constructor(ctx) { this.ctx = ctx; }
  async fetch(request) {
    const { kind, refund = false } = await request.json();
    const windowMs = LIMIT_WINDOWS[kind] ?? 60_000;
    const limit = kind === 'create' ? 8 : kind === 'join' ? 40 : 100;
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
  const origin = request.headers.get('origin');
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return origin && allowed.includes(origin) ? origin : null;
}
export async function routeRequest(request, env) {
  const url = new URL(request.url);
  // HEAD keeps `curl -I` and uptime monitors working; it must not fall through
  // to the origin check and answer 403/404.
  if (url.pathname === '/health' && ['GET', 'HEAD'].includes(request.method)) {
    const health = json({ ok: true, protocol: 1, game: 'meenfina', games: ['meenfina', 'fabraka'], version: packageInfo.version });
    return request.method === 'HEAD' ? new Response(null, { status: health.status, headers: health.headers }) : health;
  }
  const origin = allowedOrigin(request, env);
  if (!origin) return json({ error: 'ORIGIN' }, 403);
  const headers = { 'access-control-allow-origin': origin, vary: 'Origin',
    'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'Content-Type', 'access-control-max-age': '600' };
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  let response; let limiter = null; let charged = null;
  try {
    const create = request.method === 'POST' && url.pathname === '/api/rooms';
    const match = url.pathname.match(/^\/api\/rooms\/(\d{6})\/(join|leave|socket)$/);
    if (!create && (!match || (match[2] === 'socket' ? request.method !== 'GET' : request.method !== 'POST'))) fail('NOT_FOUND', 404);
    const kind = create ? 'create' : match[2];
    const address = request.headers.get('cf-connecting-ip') || 'local';
    const key = await sha256(`${new Date().toISOString().slice(0, 10)}:${address}`);
    limiter = env.LIMITERS.get(env.LIMITERS.idFromName(key));
    const limited = await limiter.fetch(new Request('https://internal/limit', { method: 'POST', body: JSON.stringify({ kind }) }));
    if (!limited.ok) fail(kind === 'create' ? 'CREATE_LIMIT' : 'RATE_LIMIT', 429);
    // Only creation refunds: a wrong room code must still cost its join slot so
    // the limiter keeps discouraging code guessing.
    charged = create ? kind : null;
    if (create) {
      const input = await readJson(request);
      await credentials(input); // Validate before allocating a room.
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
    } else {
      const room = env.ROOMS.get(env.ROOMS.idFromName(match[1]));
      response = await room.fetch(request);
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
export default { fetch: routeRequest };
