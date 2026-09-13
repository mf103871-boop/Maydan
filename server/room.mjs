import statements from '../src/data/games/meenfina/statements.json' with { type: 'json' };
import { createRoom, joinRoom, connected, leaveRoom, action, tick, snapshot, nextAlarm, member, RoomError, fail } from './room-model.mjs';
import { credentials, readJson, json, errorResponse, shuffled } from './protocol.mjs';
const SOCKET_IDLE = 45_000;

// Plain Durable Object constructor works in Cloudflare and the local Node adapter.
// All mutations share a queue; a failed storage write never becomes visible.
export class Room {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env; this.room = null; this.queue = Promise.resolve();
    this.ready = ctx.blockConcurrencyWhile(async () => { this.room = await ctx.storage.get('room') || null; });
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
  lastSeen(ws, attachment) {
    const pong = this.ctx.getWebSocketAutoResponseTimestamp?.(ws);
    return Math.max(attachment.seenAt || 0, pong?.getTime() || 0);
  }
  alarmAt(room, now) {
    const deadlines = this.sockets().map((ws) => {
      const a = this.attachment(ws);
      return a.id ? this.lastSeen(ws, a) + SOCKET_IDLE : a.authDeadline;
    }).filter(Number.isFinite);
    return Math.max(now + 1, Math.min(nextAlarm(room, now), ...deadlines));
  }
  async schedule() {
    if (this.room) await this.ctx.storage.setAlarm(this.alarmAt(this.room, Date.now()));
  }
  async commit(candidate) {
    candidate.revision++;
    // KV writes and alarms are committed in a single storage transaction.
    await this.ctx.storage.transaction(async (tx) => {
      await tx.put('room', candidate);
      await tx.setAlarm(this.alarmAt(candidate, Date.now()));
    });
    this.room = candidate;
    this.broadcast();
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
      await this.ctx.storage.deleteAll();
      await this.ctx.storage.deleteAlarm();
      this.room = null;
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
            return json({ code: this.room.code, id: input.id });
          }
          await this.commit(createRoom(code, input, Date.now()));
          return json({ code, id: input.id }, 201);
        }
        if (!this.room) fail('NOT_FOUND', 404);
        if (request.method === 'POST' && endpoint === 'join') {
          const input = await credentials(await readJson(request));
          const candidate = structuredClone(this.room);
          joinRoom(candidate, input, Date.now());
          await this.commit(candidate);
          return json({ code: this.room.code, id: input.id });
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
        if (!a.id || !requestId) fail('AUTH', 401);
        const candidate = structuredClone(this.room);
        action(candidate, a.id, command, now, command.type === 'start' ? shuffled(statements) : []);
        await this.commit(candidate);
        this.send(ws, { type: 'ack', requestId, ok: true });
      } catch (error) {
        const code = error instanceof RoomError ? error.code : 'INTERNAL';
        this.send(ws, { type: requestId ? 'ack' : 'error', requestId, ok: false, error: code });
        if (['AUTH', 'NOT_FOUND', 'EXPIRED'].includes(code)) this.close(ws, 4401, code);
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
      if (this.room) await this.schedule();
    });
  }
}
