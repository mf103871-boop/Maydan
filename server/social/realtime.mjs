import { json, errorResponse, readJson, sha256 } from '../protocol.mjs';
import { fail } from '../room-model.mjs';
import { randomToken } from '../accounts/jwt.mjs';
import { requireSession, withRotation } from '../accounts/session.mjs';
import { first } from '../accounts/db.mjs';
import { areFriends, friendIds, touchPresence } from './db.mjs';
import { userId as validUserId, ONLINE_WINDOW } from './model.mjs';

export const LIVE_TICKET_TTL = 60_000;
export const LIVE_HEARTBEAT_MS = 20_000;
const MAX_SOCKETS = 16;
const MAX_TICKETS = 8;
const TYPING_PER_SECOND = 3;
const TICKET = /^[A-Za-z0-9_-]{43}$/;
const METADATA_CHECK_MS = 24 * 60 * 60 * 1000;
const CLEANUP_RETRY_MS = 60_000;
const emptyState = () => ({ userId: null, lastActiveAt: 0, tickets: {}, typingAt: 0, typingCount: 0, onlineBroadcast: false });

const hub = (env, userId) => env.SOCIAL_HUB.get(env.SOCIAL_HUB.idFromName(userId));
const internal = (path, body) => new Request(`https://social.internal/${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

// Delivery is best effort after a successful database mutation. Missing bindings
// keep older account/room deployments operational, and no notification failure
// can turn a saved message into an apparent failed write at the client.
export async function notifyUsers(env, userIds, event) {
  if (!env.SOCIAL_HUB) return;
  try {
    const ids = [...new Set(userIds)].filter((id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(id));
    await Promise.allSettled(ids.map(async (userId) => {
      await hub(env, userId).fetch(internal('notify', { userId, event }));
    }));
  } catch { /* callers already saved their database transaction */ }
}

// Account deletion has already committed. A temporary delivery failure must not
// turn it into an apparent failed deletion; the object's alarm retries cleanup.
export async function forgetSocialUser(env, userId) {
  if (!env.SOCIAL_HUB) return;
  try { await hub(env, validUserId(userId)).fetch(internal('forget', { userId })); }
  catch { /* idle metadata is also checked by the maintenance alarm */ }
}

export async function routeSocialLive(request, env, url, charge) {
  if (!['/api/social/live-ticket', '/api/social/socket'].includes(url.pathname)) return null;
  if (!env.SOCIAL_HUB || !env.DB) return json({ error: 'SOCIAL_UNAVAILABLE' }, 503);
  if (charge) await charge('socket');
  if (url.pathname === '/api/social/live-ticket') {
    if (request.method !== 'POST') return json({ error: 'METHOD' }, 405);
    const { user, session, rotated } = await requireSession(env, request);
    // A newly rotated session survives beyond the retiring token's grace period.
    let response;
    try {
      response = await hub(env, user.id).fetch(internal('ticket', {
        userId: user.id, sessionId: rotated?.id || session.id,
      }));
      if (response.status >= 500) response = json({ error: 'SOCIAL_UNAVAILABLE' }, 503);
    } catch { response = json({ error: 'SOCIAL_UNAVAILABLE' }, 503); }
    return withRotation(response, rotated);
  }
  if (request.method !== 'GET') return json({ error: 'METHOD' }, 405);
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return json({ error: 'UPGRADE_REQUIRED' }, 426);
  const userId = validUserId(url.searchParams.get('userId'));
  const ticket = url.searchParams.get('ticket');
  if (!TICKET.test(ticket || '')) return json({ error: 'LIVE_TICKET_INVALID' }, 401);
  // Never forward a bearer token or unrelated query parameters to the object.
  return hub(env, userId).fetch(new Request(`https://social.internal/socket?ticket=${encodeURIComponent(ticket)}`, {
    headers: { upgrade: 'websocket' },
  }));
}

// One hibernatable object per account, with independent attachments per tab or
// device. Only application heartbeats count: auto-pong would skip revocation.
export class SocialHub {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.queue = Promise.resolve();
    this.ready = ctx.blockConcurrencyWhile(async () => {
      this.state = await ctx.storage.get('social') || emptyState();
    });
  }
  now() { return Date.now(); }
  serial(fn) {
    const task = this.queue.then(async () => { await this.ready; return fn(); });
    this.queue = task.catch(() => {});
    return task;
  }
  attachment(ws) { try { return ws.deserializeAttachment() || {}; } catch { return {}; } }
  sockets() { return this.ctx.getWebSockets().filter((ws) => ws.readyState === 1 && !this.attachment(ws).closed); }
  send(ws, data) { try { ws.send(typeof data === 'string' ? data : JSON.stringify(data)); return true; } catch { return false; } }
  close(ws, code = 4401, reason = 'AUTH_EXPIRED') {
    this.presenceDirty = true;
    ws.serializeAttachment({ ...this.attachment(ws), closed: true });
    try { ws.close(code, reason); } catch { /* already closed */ }
  }
  save() { return this.state.userId ? this.ctx.storage.put('social', this.state) : Promise.resolve(); }
  async canForget(userId, allowReserved = false) {
    const row = await first(this.env, `SELECT u.id,
      EXISTS(SELECT 1 FROM account_deletions d WHERE d.user_id=u.id) AS deleting
      FROM users u WHERE u.id=?`, userId);
    return !row || (allowReserved && !!row.deleting);
  }
  async forget(userId = this.state.userId) {
    this.cleanupUserId = userId;
    for (const ws of this.ctx.getWebSockets()) {
      this.close(ws, 4401, 'AUTH_EXPIRED');
      ws.serializeAttachment({ closed: true });
    }
    // Late close/message events must not recreate the removed owner's metadata.
    this.state = emptyState();
    this.presenceDirty = false;
    await this.ctx.storage.deleteAll();
    await this.ctx.storage.deleteAlarm();
    this.cleanupUserId = null;
  }
  pruneTickets(now) {
    for (const [key, value] of Object.entries(this.state.tickets)) {
      if (value.expiresAt <= now) delete this.state.tickets[key];
    }
  }
  async authenticate(sessionId, now, userId = this.state.userId) {
    const row = typeof sessionId === 'string' && await first(this.env, `SELECT s.* FROM sessions s
      JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.user_id=?
      AND NOT EXISTS (SELECT 1 FROM account_deletions d WHERE d.user_id=s.user_id)`, sessionId, userId);
    if (!row || row.expires_at <= now || (row.revoked_at != null && row.revoked_at <= now)) {
      for (const ws of this.sockets()) if (this.attachment(ws).sessionId === sessionId) this.close(ws);
      fail('AUTH_EXPIRED', 401);
    }
    return Math.min(row.expires_at, row.revoked_at ?? Infinity);
  }
  async schedule() {
    if (this.cleanupUserId) {
      await this.ctx.storage.setAlarm(this.now() + CLEANUP_RETRY_MS);
      return;
    }
    const deadlines = Object.values(this.state.tickets).map((t) => t.expiresAt);
    for (const ws of this.sockets()) {
      const a = this.attachment(ws);
      deadlines.push(a.seenAt + ONLINE_WINDOW, a.validUntil);
    }
    const deadline = Math.min(...deadlines.filter(Number.isFinite));
    if (Number.isFinite(deadline)) await this.ctx.storage.setAlarm(Math.max(this.now() + 1, deadline));
    else if (this.state.userId) await this.ctx.storage.setAlarm(this.now() + METADATA_CHECK_MS);
    else await this.ctx.storage.deleteAlarm();
  }
  async presence() {
    if (!this.state.userId) return;
    const sockets = this.sockets();
    const onlineUntil = sockets.length ? Math.max(...sockets.map((ws) => this.attachment(ws).seenAt + ONLINE_WINDOW)) : 0;
    await touchPresence(this.env, this.state.userId, this.state.lastActiveAt, onlineUntil);
    this.presenceDirty = false;
    const online = sockets.length > 0;
    if (this.state.onlineBroadcast === online) return;
    const recipients = await friendIds(this.env, this.state.userId);
    this.state.onlineBroadcast = online;
    await this.save();
    // Do not await cross-object fanout while holding this object's serial queue:
    // simultaneous presence updates from two friends must not await each other.
    this.ctx.waitUntil(notifyUsers(this.env, recipients, { type: 'refresh', reason: 'presence', userId: this.state.userId }));
  }
  async sweep(now, checkAuth = false) {
    this.pruneTickets(now);
    let changed = false;
    for (const ws of this.sockets()) {
      const a = this.attachment(ws);
      if (a.seenAt + ONLINE_WINDOW <= now) {
        this.close(ws, 4408, 'HEARTBEAT_TIMEOUT'); changed = true;
      } else if (a.validUntil <= now || checkAuth) {
        try {
          a.validUntil = await this.authenticate(a.sessionId, now);
          ws.serializeAttachment(a);
        } catch (error) {
          this.close(ws, error.status === 401 ? 4401 : 1011, error.status === 401 ? 'AUTH_EXPIRED' : 'SOCIAL_UNAVAILABLE');
          changed = true;
        }
      }
    }
    await this.save();
    if (changed) await this.presence();
  }
  fetch(request) {
    return this.serial(async () => {
      try {
        const url = new URL(request.url);
        const now = this.now();
        if (request.method === 'POST' && url.pathname === '/forget') {
          const userId = validUserId((await readJson(request)).userId);
          if (this.state.userId && this.state.userId !== userId) fail('AUTH_EXPIRED', 401);
          if (!(await this.canForget(userId, true))) fail('CONFLICT', 409);
          await this.forget(userId);
          return json({ ok: true });
        }
        if (this.cleanupUserId) fail('SOCIAL_UNAVAILABLE', 503);
        await this.sweep(now);
        if (request.method === 'POST' && url.pathname === '/ticket') {
          const input = await readJson(request);
          const userId = validUserId(input.userId);
          if (this.state.userId && this.state.userId !== userId) fail('AUTH_EXPIRED', 401);
          await this.authenticate(input.sessionId, now, userId);
          this.state.userId = userId;
          if (Object.keys(this.state.tickets).length >= MAX_TICKETS) fail('RATE_LIMIT', 429);
          const ticket = randomToken(32);
          const expiresAt = now + LIVE_TICKET_TTL;
          this.state.tickets[await sha256(ticket)] = { sessionId: input.sessionId, expiresAt };
          await this.save();
          await this.schedule();
          return json({ ticket, userId, expiresAt });
        }
        if (request.method === 'GET' && url.pathname === '/socket') {
          if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') fail('UPGRADE_REQUIRED', 426);
          const ticket = url.searchParams.get('ticket');
          if (!TICKET.test(ticket || '')) fail('LIVE_TICKET_INVALID', 401);
          const key = await sha256(ticket);
          const entry = this.state.tickets[key];
          if (!entry || entry.expiresAt <= now) fail('LIVE_TICKET_INVALID', 401);
          // Persist consumption before accepting, including when auth or capacity
          // later rejects the handshake. A ticket can authorize only one attempt.
          delete this.state.tickets[key];
          await this.save();
          const validUntil = await this.authenticate(entry.sessionId, now);
          if (this.sockets().length >= MAX_SOCKETS) fail('RATE_LIMIT', 429);
          const pair = new WebSocketPair();
          this.ctx.acceptWebSocket(pair[1]);
          pair[1].serializeAttachment({ sessionId: entry.sessionId, seenAt: now, validUntil, windowAt: now, count: 0 });
          this.state.lastActiveAt = Math.max(this.state.lastActiveAt, now);
          try {
            await this.save();
            await this.presence();
            await this.schedule();
          } catch (error) { this.close(pair[1], 1011, 'SOCIAL_UNAVAILABLE'); throw error; }
          this.send(pair[1], { type: 'ready', userId: this.state.userId, heartbeatMs: LIVE_HEARTBEAT_MS });
          return new Response(null, { status: 101, webSocket: pair[0] });
        }
        if (request.method === 'POST' && url.pathname === '/notify') {
          const { userId, event } = await readJson(request, 16_384);
          if (userId !== this.state.userId || !event || typeof event.type !== 'string') return json({ ok: true });
          await this.sweep(now, true);
          // A block or unfriend that raced the sender's check wins at delivery.
          if ((event.type === 'typing' || event.reason === 'presence') && !(await areFriends(this.env, userId, event.userId))) return json({ ok: true });
          let changed = false;
          for (const ws of this.sockets()) if (!this.send(ws, event)) { this.close(ws, 1011, 'SEND_FAILED'); changed = true; }
          if (changed) await this.presence();
          await this.schedule();
          return json({ ok: true });
        }
        fail('NOT_FOUND', 404);
      } catch (error) {
        if (this.presenceDirty) {
          try { await this.presence(); } catch { /* presence expires even during database failure */ }
        }
        await this.schedule();
        return errorResponse(error);
      }
    });
  }
  webSocketMessage(ws, message) {
    return this.serial(async () => {
      try {
        const now = this.now();
        await this.sweep(now);
        if (this.attachment(ws).closed || ws.readyState !== 1) return;
        let a = this.attachment(ws);
        if (typeof message !== 'string' || new TextEncoder().encode(message).length > 1024) { this.close(ws, 1009, 'INVALID'); return; }
        if (now - a.windowAt >= 10_000) { a.windowAt = now; a.count = 0; }
        a.count++;
        ws.serializeAttachment(a);
        if (a.count > 60) { this.close(ws, 4429, 'RATE_LIMIT'); return; }
        a.validUntil = await this.authenticate(a.sessionId, now);
        let command;
        try { command = message === 'ping' ? { type: 'ping' } : JSON.parse(message); } catch { fail('INVALID', 400); }
        if (!command || typeof command !== 'object' || Array.isArray(command)) fail('INVALID', 400);
        if (command.type === 'ping') {
          a.seenAt = now;
          ws.serializeAttachment(a);
          this.state.lastActiveAt = Math.max(this.state.lastActiveAt, now);
          await this.save();
          await this.presence();
          this.send(ws, message === 'ping' ? 'pong' : { type: 'pong' });
        } else if (command.type === 'typing') {
          const peerId = validUserId(command.peerId);
          if (typeof command.active !== 'boolean') fail('INVALID', 400);
          // Always let an authorized stop clear the peer's indicator. Rapid
          // compose/send/clear cycles should not leave it stuck as typing.
          if (command.active) {
            if (now - this.state.typingAt >= 1000) { this.state.typingAt = now; this.state.typingCount = 0; }
            if (++this.state.typingCount > TYPING_PER_SECOND) fail('RATE_LIMIT', 429);
            await this.save();
          }
          if (!(await areFriends(this.env, this.state.userId, peerId))) fail('SOCIAL_FORBIDDEN', 403);
          this.ctx.waitUntil(notifyUsers(this.env, [peerId], { type: 'typing', userId: this.state.userId, active: command.active }));
        } else fail('INVALID', 400);
      } catch (error) {
        if (error.status === 401 || !error.status) this.close(ws, error.status === 401 ? 4401 : 1011, error.status === 401 ? 'AUTH_EXPIRED' : 'SOCIAL_UNAVAILABLE');
        else this.send(ws, { type: 'error', error: error.code || 'INVALID' });
      } finally {
        if (this.attachment(ws).closed) {
          try { await this.presence(); } catch { /* fail closed; online_until still expires */ }
        }
        await this.schedule();
      }
    });
  }
  disconnected(ws) {
    return this.serial(async () => {
      this.close(ws, 1000, 'CLOSED');
      this.pruneTickets(this.now());
      await this.save();
      try { await this.presence(); } catch { /* DB outages cannot prolong the 45s lease */ }
      await this.schedule();
    });
  }
  webSocketClose(ws) { return this.disconnected(ws); }
  webSocketError(ws) { return this.disconnected(ws); }
  alarm() {
    return this.serial(async () => {
      try {
        if (this.cleanupUserId || (this.state.userId && await this.canForget(this.state.userId))) await this.forget(this.cleanupUserId || this.state.userId);
        else await this.sweep(this.now(), true);
      }
      finally { await this.schedule(); }
    });
  }
}
