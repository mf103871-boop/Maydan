import statements from '../src/data/games/meenfina/statements.json' with { type: 'json' };
import { createRoom, joinRoom, connected, leaveRoom, action, tick, snapshot, nextAlarm, member, RoomError, fail } from './game-model.mjs';
import { buildFabrakaDeck } from './fabraka-content.mjs';
import { credentials, readJson, json, errorResponse, shuffled } from './protocol.mjs';
import { bindSeatAccount, prepareRoomStats } from './room-stats.mjs';
import { recordOnlineResult } from './profiles/db.mjs';
const SOCKET_IDLE = 45_000;
const STATS_RETRY = 30_000;

// Plain Durable Object constructor works in Cloudflare and the local Node adapter.
// All mutations share a queue; a failed storage write never becomes visible.
export class Room {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env; this.room = null; this.profileOutbox = []; this.queue = Promise.resolve();
    this.ready = ctx.blockConcurrencyWhile(async () => {
      this.room = await ctx.storage.get('room') || null;
      this.profileOutbox = await ctx.storage.get('profileOutbox') || [];
    });
    if (typeof WebSocketRequestResponsePair !== 'undefined') {
      ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    }
  }
  serial(fn) {
    const task = this.queue.then(async () => { await this.ready; return fn(); });
    this.queue = task.catch(() => {});
    return task;
  }
  sockets() { return this.ctx.getWebSockets().filter((ws) => ws.readyState === 1); }
  attachment(ws) { try { return ws.deserializeAttachment() || {}; } catch { return {}; } }
  send(ws, value) { try { ws.send(typeof value === 'string' ? value : JSON.stringify(value)); } catch { /* close handler reconciles presence */ } }
  close(ws, code, reason) { try { ws.close(code, reason); } catch { /* already closed */ } }
  deleteKey(key) { return this.ctx.storage.delete ? this.ctx.storage.delete(key) : this.ctx.storage.put(key, null); }
  lastSeen(ws, attachment) {
    const pong = this.ctx.getWebSocketAutoResponseTimestamp?.(ws);
    return Math.max(attachment.seenAt || 0, pong?.getTime() || 0);
  }
  alarmAt(room, now) {
    const deadlines = this.sockets().map((ws) => {
      const a = this.attachment(ws);
      return a.id ? this.lastSeen(ws, a) + SOCKET_IDLE : a.authDeadline;
    }).filter(Number.isFinite);
    return Math.max(now + 1, Math.min(nextAlarm(room, now), ...deadlines, ...(this.profileOutbox.length ? [now + STATS_RETRY] : [])));
  }
  async schedule() {
    if (this.room) await this.ctx.storage.setAlarm(this.alarmAt(this.room, Date.now()));
    else if (this.profileOutbox.length) await this.ctx.storage.setAlarm(Date.now() + STATS_RETRY);
    else await this.ctx.storage.deleteAlarm();
  }
  async commit(candidate) {
    candidate.revision++;
    const outbox = [...this.profileOutbox, ...prepareRoomStats(this.room, candidate)];
    // KV writes and alarms are committed in a single storage transaction.
    await this.ctx.storage.transaction(async (tx) => {
      await tx.put('room', candidate);
      if (outbox.length) await tx.put('profileOutbox', outbox);
      await tx.setAlarm(Math.min(this.alarmAt(candidate, Date.now()), ...(outbox.length ? [Date.now() + STATS_RETRY] : [])));
    });
    this.room = candidate;
    this.profileOutbox = outbox;
    this.broadcast();
    if (outbox.length) {
      const task = this.flushStats();
      this.ctx.waitUntil?.(task);
      task.catch(() => {});
    }
  }
  flushStats() {
    if (this.flushingStats) return this.flushingStats;
    const task = (async () => {
      await this.ready;
      while (this.env.DB && this.profileOutbox.length) {
        const event = this.profileOutbox[0];
        // D1 waits happen outside the game-command queue. A slow or unavailable
        // database must not delay a room action or the next match.
        try { await recordOnlineResult(this.env, event); }
        catch { break; }
        await this.serial(async () => {
          const pending = this.profileOutbox.filter((item) => item.eventId !== event.eventId || item.userId !== event.userId);
          // D1 success followed by a failed DO write is safe to retry: the D1
          // transaction deduplicates account + eventId. Keep newer queued games.
          if (pending.length) await this.ctx.storage.put('profileOutbox', pending);
          else await this.deleteKey('profileOutbox');
          this.profileOutbox = pending;
          await this.schedule();
        });
      }
      await this.serial(() => this.schedule());
    })();
    this.flushingStats = task;
    const release = () => { if (this.flushingStats === task) this.flushingStats = null; };
    task.then(release, release);
    return task;
  }
  broadcast() {
    if (!this.room) return;
    for (const ws of this.sockets()) {
      const { id } = this.attachment(ws);
      if (!id) continue;
      const m = this.room.members.find((p) => p.id === id && !p.left);
      if (!m) { this.send(ws, { type: 'error', error: 'REMOVED' }); this.close(ws, 4401, 'REMOVED'); continue; }
      this.send(ws, { type: 'state', state: snapshot(this.room, id, Date.now()) });
    }
  }
  async advance() {
    if (!this.room) return;
    const candidate = structuredClone(this.room);
    // A phone can vanish without a TCP close. Hibernation auto-pongs provide
    // liveness without waking the object on every heartbeat.
    for (const ws of this.sockets()) {
      const a = this.attachment(ws);
      if (a.id && Date.now() - this.lastSeen(ws, a) >= SOCKET_IDLE) {
        ws.serializeAttachment({ timedOut: true });
        this.close(ws, 4000, 'DISCONNECTED');
        if (candidate.members.some((m) => m.id === a.id && !m.left)) connected(candidate, a.id, false, Date.now());
      }
    }
    tick(candidate, Date.now());
    if (candidate.phase === 'closed') {
      const reason = candidate.reason === 'expired' ? 'EXPIRED' : 'NOT_FOUND';
      for (const ws of this.sockets()) { this.send(ws, { type: 'error', error: reason }); this.close(ws, 4404, reason); }
      if (this.profileOutbox.length) await this.deleteKey('room');
      else await this.ctx.storage.deleteAll();
      this.room = null;
      await this.schedule();
    } else if (JSON.stringify(candidate) !== JSON.stringify(this.room)) await this.commit(candidate);
  }
  async authenticate(input) {
    if (!this.room) fail('NOT_FOUND', 404);
    const supplied = await credentials(input);
    const found = member(this.room, supplied.id);
    if (found.tokenHash !== supplied.tokenHash) fail('AUTH', 401);
    return found.id;
  }
  fetch(request) {
    return this.serial(async () => {
      try {
        await this.advance();
        const url = new URL(request.url);
        const endpoint = url.pathname.split('/').at(-1);
        if (request.method === 'POST' && endpoint === 'create') {
          const input = await credentials(await readJson(request));
          const code = url.searchParams.get('code');
          if (!/^\d{6}$/.test(code)) fail('INVALID');
          if (this.room) {
            const owner = this.room.members.find((m) => m.id === input.id && !m.left);
            if (!owner || owner.tokenHash !== input.tokenHash) return json({ error: 'COLLISION' }, 409);
            if ((this.room.game || 'meenfina') !== (input.game || 'meenfina')) fail('GAME');
            return json({ code: this.room.code, id: input.id, game: this.room.game || 'meenfina' });
          }
          const created = createRoom(code, input, Date.now());
          bindSeatAccount(created, input.id, input.accountUserId);
          // Reject empty topic selections while the creator can still edit them,
          // rather than trapping an assembled group in an unstartable lobby.
          if (created.game === 'fabraka' && buildFabrakaDeck(created).length < created.rounds) fail('QUESTIONS');
          await this.commit(created);
          return json({ code, id: input.id, game: this.room.game }, 201);
        }
        if (!this.room) fail('NOT_FOUND', 404);
        if (request.method === 'POST' && endpoint === 'join') {
          const input = await credentials(await readJson(request));
          const candidate = structuredClone(this.room);
          joinRoom(candidate, input, Date.now());
          bindSeatAccount(candidate, input.id, input.accountUserId);
          await this.commit(candidate);
          return json({ code: this.room.code, id: input.id, game: this.room.game || 'meenfina' });
        }
        if (request.method === 'POST' && endpoint === 'leave') {
          const id = await this.authenticate(await readJson(request));
          const candidate = structuredClone(this.room);
          leaveRoom(candidate, id, Date.now());
          await this.commit(candidate);
          await this.advance();
          return json({ ok: true });
        }
        if (request.method === 'GET' && endpoint === 'socket' && request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
          if (this.sockets().length >= 32) fail('RATE_LIMIT', 429);
          const pair = new WebSocketPair();
          await this.acceptSocket(pair[1]);
          return new Response(null, { status: 101, webSocket: pair[0] });
        }
        fail('NOT_FOUND', 404);
      } catch (error) { return errorResponse(error); }
    });
  }
  // The dev adapter uses the identical authentication/message handlers.
  async acceptSocket(ws) {
    this.ctx.acceptWebSocket(ws);
    ws.serializeAttachment({ authDeadline: Date.now() + 10_000 });
    await this.schedule();
  }
  webSocketMessage(ws, message) {
    return this.serial(async () => {
      let requestId;
      try {
        await this.advance();
        if (ws.readyState !== 1) return;
        if (!this.room) fail('NOT_FOUND', 404);
        if (typeof message !== 'string' || new TextEncoder().encode(message).length > 4096) fail('INVALID');
        const a = this.attachment(ws);
        const now = Date.now();
        a.seenAt = now;
        if (!a.windowAt || now - a.windowAt > 10_000) { a.windowAt = now; a.count = 0; }
        a.count = (a.count || 0) + 1;
        ws.serializeAttachment(a);
        if (a.count > 35) { this.close(ws, 4429, 'RATE_LIMIT'); fail('RATE_LIMIT', 429); }
        if (message === 'ping' && a.id) { this.send(ws, 'pong'); return; }
        let command;
        try { command = JSON.parse(message); } catch { fail('INVALID'); }
        if (!command || Array.isArray(command) || typeof command !== 'object') fail('INVALID');
        requestId = typeof command.requestId === 'string' && command.requestId.length <= 80 ? command.requestId : undefined;
        if (command.type === 'auth' && !a.id) {
          if (now > a.authDeadline) fail('AUTH', 401);
          const id = await this.authenticate(command);
          // Only one controlling connection per seat; old close cannot disconnect the replacement.
          for (const other of this.sockets()) if (other !== ws && this.attachment(other).id === id) {
            other.serializeAttachment({ replaced: true }); this.close(other, 4409, 'REPLACED');
          }
          ws.serializeAttachment({ id, seenAt: now, windowAt: now, count: 1 });
          const candidate = structuredClone(this.room);
          connected(candidate, id, true, now);
          await this.commit(candidate);
          return;
        }
        // A malformed requestId on an authenticated seat is a bad command, not a
        // failed login: answering with INVALID keeps the player's session alive.
        if (!a.id) fail('AUTH', 401);
        if (!requestId) fail('INVALID');
        const candidate = structuredClone(this.room);
        const deck = command.type === 'start' ? (candidate.game === 'fabraka' ? buildFabrakaDeck(candidate) : shuffled(statements)) : [];
        action(candidate, a.id, command, now, deck);
        await this.commit(candidate);
        this.send(ws, { type: 'ack', requestId, ok: true });
      } catch (error) {
        const code = error instanceof RoomError ? error.code : 'INTERNAL';
        this.send(ws, { type: requestId ? 'ack' : 'error', requestId, ok: false, error: code });
        // Only end the session when the failure is about this socket's own seat;
        // an error about another player (a kick target) must not sign the host out.
        const seat = this.attachment(ws).id;
        const seated = Boolean(seat) && Boolean(this.room?.members.some((m) => m.id === seat && !m.left));
        if (['NOT_FOUND', 'EXPIRED'].includes(code) || (code === 'AUTH' && !seated)) this.close(ws, 4401, code);
      }
    });
  }
  webSocketClose(ws) {
    return this.serial(async () => {
      this.close(ws, 1000, 'closed');
      await this.advance();
      const { id } = this.attachment(ws);
      if (!id || !this.room || !this.room.members.some((m) => m.id === id && !m.left)) return;
      if (this.sockets().some((other) => other !== ws && this.attachment(other).id === id && other.readyState === 1)) return;
      const candidate = structuredClone(this.room);
      connected(candidate, id, false, Date.now());
      await this.commit(candidate);
    });
  }
  webSocketError(ws) { return this.webSocketClose(ws); }
  alarm() {
    return this.serial(async () => {
      await this.advance();
      for (const ws of this.sockets()) {
        const a = this.attachment(ws);
        if (!a.id && a.authDeadline <= Date.now()) this.close(ws, 4401, 'AUTH');
      }
      await this.schedule();
    }).then(() => this.flushStats());
  }
}
