import { Room } from './room.mjs';
import { readJson, json, errorResponse, sha256, credentials } from './protocol.mjs';
import { fail } from './room-model.mjs';
export { Room };

// Small per-IP limits for accidental floods and room-code guessing.
// Keys contain only a digest; no raw address is persisted. These are not DDoS protection.
export class RequestLimiter {
  constructor(ctx) { this.ctx = ctx; }
  async fetch(request) {
    const { kind } = await request.json();
    const windowMs = kind === 'create' ? 600_000 : 60_000;
    const limit = kind === 'create' ? 8 : kind === 'join' ? 40 : 100;
    const now = Date.now();
    const allowed = await this.ctx.storage.transaction(async (tx) => {
      let entry = await tx.get(kind);
      if (!entry || now >= entry.until) entry = { count: 0, until: now + windowMs };
      if (entry.count >= limit) return false;
      entry.count++;
      await tx.put(kind, entry);
      await tx.setAlarm(now + 600_000);
      return true;
    });
    return json({ allowed }, allowed ? 200 : 429);
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
  if (url.pathname === '/health' && request.method === 'GET') return json({ ok: true, protocol: 1, game: 'meenfina' });
  const origin = allowedOrigin(request, env);
  if (!origin) return json({ error: 'ORIGIN' }, 403);
  const headers = { 'access-control-allow-origin': origin, vary: 'Origin',
    'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'Content-Type', 'access-control-max-age': '600' };
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  let response;
  try {
    const create = request.method === 'POST' && url.pathname === '/api/rooms';
    const match = url.pathname.match(/^\/api\/rooms\/(\d{6})\/(join|leave|socket)$/);
    if (!create && (!match || (match[2] === 'socket' ? request.method !== 'GET' : request.method !== 'POST'))) fail('NOT_FOUND', 404);
    const kind = create ? 'create' : match[2];
    const address = request.headers.get('cf-connecting-ip') || 'local';
    const key = await sha256(`${new Date().toISOString().slice(0, 10)}:${address}`);
    const limiter = env.LIMITERS.get(env.LIMITERS.idFromName(key));
    const limited = await limiter.fetch(new Request('https://internal/limit', { method: 'POST', body: JSON.stringify({ kind }) }));
    if (!limited.ok) fail('RATE_LIMIT', 429);
    if (create) {
      const input = await readJson(request);
      await credentials(input); // Validate before allocating a room.
      // Stable code candidates make a retried creation idempotent without a global directory.
      for (let attempt = 0; attempt < 5; attempt++) {
        const digest = await sha256(`${input.token}:${attempt}`);
        const code = String(100000 + parseInt(digest.slice(0, 12), 16) % 900000);
        const room = env.ROOMS.get(env.ROOMS.idFromName(code));
        response = await room.fetch(new Request(`https://internal/create?code=${code}`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
        }));
        if (response.status !== 409 || (await response.clone().json()).error !== 'COLLISION') break;
        response = null;
      }
      if (!response) fail('RATE_LIMIT', 429);
    } else {
      const room = env.ROOMS.get(env.ROOMS.idFromName(match[1]));
      response = await room.fetch(request);
    }
  } catch (error) { response = errorResponse(error); }
  if (response.status === 101) return response;
  const allHeaders = new Headers(response.headers);
  for (const [key, value] of Object.entries(headers)) allHeaders.set(key, value);
  return new Response(response.body, { status: response.status, headers: allHeaders });
}
export default { fetch: routeRequest };
