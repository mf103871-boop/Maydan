import statements from '../src/data/games/meenfina/statements.json' with { type: 'json' };
import { createRoom, joinRoom, connected, leaveRoom, action, tick, snapshot, nextAlarm, member, roomCapacity, RoomError, fail } from './game-model.mjs';
import { buildFabrakaDeck } from './fabraka-content.mjs';
import { credentials, readJson, json, errorResponse, shuffled } from './protocol.mjs';
import { bindSeatAccount, prepareRoomStats } from './room-stats.mjs';
import { recordOnlineResult, profileSummaries } from './profiles/db.mjs';
import { consumeRoomTrial } from './accounts/router.mjs';
import { requireSession } from './accounts/session.mjs';
import { liveAccountSql } from './moderation/access.mjs';
import { ERSOMHA_PROTOCOL } from '../src/online/shared.js';
import { getErsomhaPool } from './ersomha-content.mjs';
import { setErsomhaChoices, ERSOMHA_PLAYING, ERSOMHA_SELECT_MS } from './ersomha-model.mjs';
import { acquireErsomhaLease, assertErsomhaLease, renewErsomhaLease, releaseErsomhaLease, releaseErsomhaAccounts, ersomhaSeen, exposeErsomhaCards, buildErsomhaTurnPlan } from './ersomha-history.mjs';
import { ersomhaBoardId, emptyErsomhaDrawing, loadErsomhaDrawing, checkpointErsomhaDrawing, persistErsomhaDrawing,
  prepareErsomhaDrawing, ersomhaSyncMessages, ersomhaDrawingMeta, ersomhaVisibleCanvas, archiveErsomhaDrawing, deleteErsomhaDrawing } from './ersomha-drawing.mjs';
const SOCKET_IDLE = 45_000;
const STATS_RETRY = 30_000;
const STATS_MAX_ATTEMPTS = 48; // a day of half-minute retries
// Statements the room has already shown wait at the back of the queue, so a second
// match in the same room does not repeat the first.
export function meenfinaDeck(room) {
  const seen = new Set(room.seenStatements || []);
  return [...shuffled(statements.filter((s) => !seen.has(s.id))), ...shuffled(statements.filter((s) => seen.has(s.id)))];
}

// Plain Durable Object constructor works in Cloudflare and the local Node adapter.
// All mutations share a queue; a failed storage write never becomes visible.
export class Room {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env; this.room = null; this.profileOutbox = []; this.queue = Promise.resolve();
    this.ready = ctx.blockConcurrencyWhile(async () => {
      this.room = await ctx.storage.get('room') || null;
      this.profileOutbox = await ctx.storage.get('profileOutbox') || [];
      if (this.room?.game === 'ersomha') {
        const drawing = await loadErsomhaDrawing(ctx.storage, this.room);
        this.drawing = drawing.board; this.drawingHead = drawing.head;
        this.drawingArchives = await ctx.storage.get('ersomha:evidence') || [];
      }
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
  // Without a database binding the outbox can never drain; do not wake every 30 s for it.
  outboxPending() { return Boolean(this.env.DB) && this.profileOutbox.length > 0; }
  alarmAt(room, now) {
    const deadlines = this.sockets().map((ws) => {
      const a = this.attachment(ws);
      return a.id ? this.lastSeen(ws, a) + SOCKET_IDLE : a.authDeadline;
    }).filter(Number.isFinite);
    return Math.max(now + 1, Math.min(nextAlarm(room, now), ...deadlines, ...(this.outboxPending() ? [now + STATS_RETRY] : [])));
  }
  async schedule() {
    if (this.room) await this.ctx.storage.setAlarm(this.alarmAt(this.room, Date.now()));
    else if (this.outboxPending()) await this.ctx.storage.setAlarm(Date.now() + STATS_RETRY);
    else await this.ctx.storage.deleteAlarm();
  }
  async commit(candidate, { prepared = false } = {}) {
    const oldLease = this.room?.ersomhaLease;
    if (candidate.game === 'ersomha' && !prepared) await this.prepareErsomha(candidate);
    if (candidate.game === 'ersomha' && candidate.phase === 'select' && (this.room?.phase !== 'select' || this.room.round !== candidate.round || this.room.matchId !== candidate.matchId)) {
      candidate.deadlineAt = Date.now() + ERSOMHA_SELECT_MS;
    }
    candidate.revision++;
    const outbox = [...this.profileOutbox, ...prepareRoomStats(this.room, candidate)];
    const resetDrawing = candidate.game === 'ersomha' && (!this.drawing || this.drawing.boardId !== ersomhaBoardId(candidate));
    const nextDrawing = resetDrawing ? emptyErsomhaDrawing(candidate) : this.drawing;
    let nextDrawingHead = this.drawingHead, nextArchives = this.drawingArchives || [];
    // KV writes and alarms are committed in a single storage transaction.
    await this.ctx.storage.transaction(async (tx) => {
      await tx.put('room', candidate);
      if (resetDrawing) {
        if (this.room?.draw && this.drawing?.boardId === ersomhaBoardId(this.room)) nextArchives = await archiveErsomhaDrawing(tx, this.room, this.drawing, nextArchives);
        nextDrawingHead = await checkpointErsomhaDrawing(tx, nextDrawing, this.drawingHead);
      }
      if (outbox.length) await tx.put('profileOutbox', outbox);
      await tx.setAlarm(Math.min(this.alarmAt(candidate, Date.now()), ...(outbox.length ? [Date.now() + STATS_RETRY] : [])));
    });
    this.room = candidate;
    if (candidate.game === 'ersomha') { this.drawing = nextDrawing; this.drawingHead = nextDrawingHead; this.drawingArchives = nextArchives; }
    this.profileOutbox = outbox;
    this.broadcast();
    if (candidate.game === 'ersomha' && !ERSOMHA_PLAYING.includes(candidate.phase) && candidate.ersomhaLease) {
      // The final state is durable first. A failed lease release merely holds
      // the account until its short expiry; it never exposes another word.
      try { await releaseErsomhaLease(this.env, candidate.ersomhaLease); } catch { /* expiry is the fallback */ }
    } else if (candidate.game === 'ersomha' && oldLease) {
      const departed = oldLease.accounts.filter(a => !candidate.ersomhaLease?.accounts.some(next => next.hash === a.hash)).map(a => a.hash);
      try { await releaseErsomhaAccounts(this.env, oldLease, departed); } catch { /* a failed cleanup expires, never grants a second room */ }
    }
    if (outbox.length) {
      const task = this.flushStats();
      this.ctx.waitUntil?.(task);
      task.catch(() => {});
    }
  }
  async prepareErsomha(candidate) {
    if (!ERSOMHA_PLAYING.includes(candidate.phase)) return;
    if (candidate.ersomhaLease) {
      const activeAccounts = new Set(candidate.members.filter(m => !m.left).map(m => m.accountUserId));
      candidate.ersomhaLease = { ...candidate.ersomhaLease, accounts: candidate.ersomhaLease.accounts.filter(a => activeAccounts.has(a.userId)) };
    }
    const now = Date.now();
    if (!candidate.ersomhaLease) candidate.ersomhaLease = await acquireErsomhaLease(this.env, candidate, now);
    else if (now >= candidate.ersomhaLease.renewAt) candidate.ersomhaLease = await renewErsomhaLease(this.env, candidate.ersomhaLease, now);
    const lease = candidate.ersomhaLease, exposure = `${candidate.ersomhaKey}:${candidate.matchId}:${candidate.round}`;
    if (!candidate.ersomhaPlan) {
      await assertErsomhaLease(this.env, lease, now);
      const seen = await ersomhaSeen(this.env, lease), prefix = `${candidate.ersomhaKey}:${candidate.matchId}:`;
      const prior = seen.filter(s => !s.exposure_id.startsWith(prefix));
      const signature = JSON.stringify({ settings: candidate.settings, accounts: lease.accounts.map(a => a.hash).sort(), turns: candidate.rounds });
      const pending = await this.ctx.storage.get('ersomha:plan'), pool = getErsomhaPool(candidate.settings);
      const used = new Set(), valid = pending?.key === candidate.ersomhaKey && pending.matchId === candidate.matchId && pending.signature === signature
        && pending.turns?.length === candidate.rounds && pending.turns.every(cards => cards.length === 3 && new Set(cards.map(c => c.category)).size === 3 && cards.every(card => {
          if (used.has(card.familyId) || !pool.some(c => c.id === card.id && c.conceptId === card.conceptId && c.familyId === card.familyId)) return false;
          used.add(card.familyId);
          return candidate.settings.allowReplay || !prior.some(s => s.family_id === card.familyId || s.concept_id === card.conceptId);
        }));
      const turns = valid ? pending.turns : buildErsomhaTurnPlan(pool, candidate.rounds, { seen: prior, allowReplay: candidate.settings.allowReplay });
      if (turns.length !== candidate.rounds) fail('ERSOMHA_CONTENT_EXHAUSTED', 409);
      // This private checkpoint precedes both exposure and the free-start claim.
      // A failed final room commit can retry exactly these same future choices.
      if (!valid) await this.ctx.storage.put('ersomha:plan', { key: candidate.ersomhaKey, matchId: candidate.matchId, signature, turns });
      candidate.ersomhaPlan = turns;
    }
    if (candidate.phase === 'select' && !candidate.draw.choices.length) {
      await assertErsomhaLease(this.env, lease, now);
      const choices = candidate.ersomhaPlan[candidate.round - 1] || [];
      if (choices.length !== 3) fail('ERSOMHA_CONTENT_EXHAUSTED', 409);
      const userId = candidate.members.find(m => m.id === candidate.draw.drawerId)?.accountUserId;
      await exposeErsomhaCards(this.env, lease, choices, [userId], `${exposure}:choice`, { now, allowReplay: candidate.settings.allowReplay });
      setErsomhaChoices(candidate, choices, Date.now());
    }
    if (candidate.phase === 'draw' && (this.room?.round !== candidate.round || this.room?.phase === 'select')) {
      await exposeErsomhaCards(this.env, lease, [candidate.draw.word], lease.accounts.map(a => a.userId), `${exposure}:selected`,
        { now, allowReplay: candidate.settings.allowReplay, acceptedExposureIds: [`${exposure}:choice`] });
      const startedAt = Date.now(); candidate.deadlineAt += startedAt - candidate.draw.startedAt; candidate.draw.startedAt = startedAt;
    }
  }
  stateFor(id) {
    const state = snapshot(this.room, id, Date.now());
    if (this.room.game === 'ersomha' && this.drawing?.boardId === ersomhaBoardId(this.room)) state.drawing = ersomhaDrawingMeta(this.drawing);
    return state;
  }
  async drawingCommand(ws, id, command) {
    member(this.room, id);
    if (!this.drawing || this.drawing.boardId !== ersomhaBoardId(this.room)) fail('ERSOMHA_CANVAS_UNAVAILABLE', 503);
    const change = prepareErsomhaDrawing(this.room, this.drawing, id, command);
    if (change.sync) for (const message of ersomhaSyncMessages(this.room, this.drawing)) this.send(ws, message);
    else if (change.event) {
      // The small journal write is committed before any receiver or sender sees
      // this sequence. No full game snapshot, D1 query or stats write is needed.
      const head = await persistErsomhaDrawing(this.ctx.storage, change.board, change.event, this.drawingHead);
      this.drawing = change.board; this.drawingHead = head;
      for (const socket of this.sockets()) {
        const seat = this.attachment(socket).id;
        if (seat && this.room.members.some(m => m.id === seat && !m.left)) this.send(socket, change.event);
      }
    }
    this.send(ws, { type: 'ack', requestId: command.requestId, ok: true, drawing: ersomhaDrawingMeta(this.drawing) });
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
        catch (error) {
          // A malformed event (the database says INVALID) or one that keeps failing
          // must not block every later result behind it: drop it after a bounded
          // number of attempts. Transient failures keep the head of the queue.
          const permanent = error instanceof RoomError && error.status === 400;
          const attempts = (event.attempts || 0) + 1;
          if (!permanent && attempts < STATS_MAX_ATTEMPTS) {
            await this.serial(async () => {
              this.profileOutbox = this.profileOutbox.map((item) => (item === event ? { ...item, attempts } : item));
              await this.ctx.storage.put('profileOutbox', this.profileOutbox);
            });
            break;
          }
          try { console.error('[maydan] dropping online result', permanent ? 'INVALID' : 'too many attempts', event.eventId); } catch { /* no console */ }
        }
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
      this.send(ws, { type: 'state', state: this.stateFor(id) });
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
      if (candidate.game === 'ersomha') {
        try { await releaseErsomhaLease(this.env, candidate.ersomhaLease); } catch { /* short lease expiry remains safe */ }
        await deleteErsomhaDrawing(this.ctx.storage, this.drawingHead, this.drawingArchives);
      }
      if (this.profileOutbox.length) await this.deleteKey('room');
      else await this.ctx.storage.deleteAll();
      this.room = null;
      this.drawing = null; this.drawingHead = null; this.drawingArchives = [];
      await this.schedule();
    } else if (JSON.stringify(candidate) !== JSON.stringify(this.room)
      || candidate.game === 'ersomha' && candidate.ersomhaLease && ERSOMHA_PLAYING.includes(candidate.phase) && Date.now() >= candidate.ersomhaLease.renewAt) {
      try { await this.commit(candidate); }
      catch (error) {
        if (candidate.game !== 'ersomha' || !(error instanceof RoomError) || !['AUTH', 'ERSOMHA_ACTIVE_ELSEWHERE'].includes(error.code)) throw error;
        // Every entry point advances first, including HTTP leave and socket
        // close. End a revoked match here so cleanup never depends on its alarm.
        const stopped = structuredClone(this.room); stopped.phase = 'over'; stopped.deadlineAt = null;
        stopped.reason = error.code === 'AUTH' ? 'account_unavailable' : 'account_active_elsewhere';
        await this.commit(stopped);
      }
    }
  }
  async authenticate(input) {
    if (!this.room) fail('NOT_FOUND', 404);
    const supplied = await credentials(input);
    const found = member(this.room, supplied.id);
    if (found.tokenHash !== supplied.tokenHash) fail('AUTH', 401);
    return found.id;
  }
  async hydrateErsomhaProfile(room, seatId) {
    if (room.game !== 'ersomha') return;
    const seat = member(room, seatId), profiles = await profileSummaries(this.env, [seat.accountUserId]);
    const profile = profiles.get(seat.accountUserId);
    seat.profile = profile ? { avatarPreset: profile.avatarPreset, theme: profile.theme, avatarUrl: profile.avatarUrl, revision: profile.revision } : null;
  }
  fetch(request) {
    return this.serial(async () => {
      try {
        await this.advance();
        const url = new URL(request.url);
        const endpoint = url.pathname.split('/').at(-1);
        if (request.method === 'POST' && endpoint === 'create') {
          const input = await credentials(await readJson(request));
          if (input.game === 'ersomha') {
            if (input.capabilities?.ersomha !== ERSOMHA_PROTOCOL) fail('CONFIG', 409);
            if (typeof input.accountUserId !== 'string' || !input.accountUserId) fail('AUTH_REQUIRED', 401);
          }
          const code = url.searchParams.get('code');
          if (!/^\d{6}$/.test(code)) fail('INVALID');
          if (this.room) {
            const owner = this.room.members.find((m) => m.id === input.id && !m.left);
            if (!owner || owner.tokenHash !== input.tokenHash) return json({ error: 'COLLISION' }, 409);
            if ((this.room.game || 'meenfina') !== (input.game || 'meenfina')) fail('GAME');
            if (this.room.game === 'ersomha' && owner.accountUserId !== input.accountUserId) fail('AUTH', 401);
            return json({ code: this.room.code, id: input.id, game: this.room.game || 'meenfina' });
          }
          const created = createRoom(code, input, Date.now());
          created.roomTrialGate = input.roomTrialGate || null;
          created.roomTrialClaim = crypto.randomUUID();
          created.trialOwnerId = input.id;
          created.trialStarted = false;
          bindSeatAccount(created, input.id, input.accountUserId);
          await this.hydrateErsomhaProfile(created, input.id);
          // Reject empty topic selections while the creator can still edit them,
          // rather than trapping an assembled group in an unstartable lobby.
          if (created.game === 'fabraka' && buildFabrakaDeck(created).length < created.rounds) fail('QUESTIONS');
          await this.commit(created);
          return json({ code, id: input.id, game: this.room.game }, 201);
        }
        if (!this.room) fail('NOT_FOUND', 404);
        if (request.method === 'POST' && endpoint === 'drawing-evidence') {
          if (this.room.game !== 'ersomha') fail('NOT_FOUND', 404);
          const input = await readJson(request), matchId = input.matchId, round = input.round;
          if (typeof input.accountUserId !== 'string' || !Number.isSafeInteger(matchId) || !Number.isSafeInteger(round)) fail('INVALID');
          let canvas, drawerUserId, viewers;
          if (matchId === this.room.matchId && round === this.room.round && this.room.draw && this.drawing) {
            canvas = ersomhaVisibleCanvas(this.drawing); viewers = this.room.draw.viewers;
            drawerUserId = this.room.members.find(m => m.id === this.room.draw.drawerId)?.accountUserId;
          } else {
            const archived = this.drawingArchives?.find(a => a.matchId === matchId && a.round === round);
            if (!archived) fail('NOT_FOUND', 404);
            viewers = archived.viewers; drawerUserId = archived.drawerUserId;
            if (!viewers.includes(input.accountUserId)) fail('NOT_FOUND', 404);
            canvas = JSON.parse((await Promise.all(archived.parts.map(key => this.ctx.storage.get(key)))).join(''));
          }
          if (!viewers?.includes(input.accountUserId) || !drawerUserId) fail('NOT_FOUND', 404);
          return json({ game: 'ersomha', roomCode: this.room.code, matchId, round, drawerUserId, canvas, createdAt: Date.now() });
        }
        // Internal binding only: routeRequest never exposes this endpoint publicly.
        if(request.method==='POST'&&endpoint==='social-status') {
          const {accountUserId}=await readJson(request);
          if(typeof accountUserId!=='string'||!this.room.members.some(m=>!m.left&&m.accountUserId===accountUserId))fail('NOT_FOUND',404);
          if(this.room.phase!=='lobby')fail('STARTED',409);
          if(this.room.members.filter(m=>!m.left).length >= roomCapacity(this.room))fail(this.room.game === 'fabraka' ? 'FULL_FABRAKA' : this.room.game === 'ersomha' ? 'FULL_ERSOMHA' : 'FULL',409);
          return json({game:this.room.game||'meenfina',expiresAt:this.room.expiresAt});
        }
        if (request.method === 'POST' && endpoint === 'join') {
          const input = await credentials(await readJson(request));
          if (this.room.game === 'ersomha') {
            if (input.capabilities?.ersomha !== ERSOMHA_PROTOCOL) fail('CONFIG', 409);
            if (typeof input.accountUserId !== 'string' || !input.accountUserId) fail('AUTH_REQUIRED', 401);
            const previous = this.room.members.find(m => !m.left && m.id === input.id);
            if (previous && previous.accountUserId !== input.accountUserId) fail('AUTH', 401);
          }
          const candidate = structuredClone(this.room);
          joinRoom(candidate, input, Date.now());
          bindSeatAccount(candidate, input.id, input.accountUserId);
          await this.hydrateErsomhaProfile(candidate, input.id);
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
      let requestId, attemptedStart;
      try {
        await this.advance();
        if (ws.readyState !== 1) return;
        if (!this.room) fail('NOT_FOUND', 404);
        if (typeof message !== 'string' || new TextEncoder().encode(message).length > 4096) fail('INVALID');
        const a = this.attachment(ws);
        const now = Date.now();
        a.seenAt = now;
        if (message === 'ping' && a.id) { ws.serializeAttachment(a); this.send(ws, 'pong'); return; }
        let command;
        try { command = JSON.parse(message); } catch { /* malformed messages still use the ordinary flood budget */ }
        const validCommand = command && !Array.isArray(command) && typeof command === 'object';
        requestId = validCommand && typeof command.requestId === 'string' && command.requestId.length <= 80 ? command.requestId : undefined;
        if (this.room.game === 'ersomha' && validCommand && command.type === 'drawing_batch' && a.id) {
          a.drawTokens = Math.min(30, (a.drawTokens ?? 30) + Math.max(0, now - (a.drawAt ?? now)) * 15 / 1000); a.drawAt = now;
          if (a.drawTokens < 1) {
            a.drawViolations = (a.drawViolations || 0) + 1; ws.serializeAttachment(a);
            if (a.drawViolations > 30) this.close(ws, 4429, 'RATE_LIMIT'); fail('RATE_LIMIT', 429);
          }
          a.drawTokens--; a.drawViolations = Math.max(0, (a.drawViolations || 0) - 1);
        } else {
          if (!a.windowAt || now - a.windowAt > 10_000) { a.windowAt = now; a.count = 0; }
          a.count = (a.count || 0) + 1;
          if (a.count > 35) { ws.serializeAttachment(a); this.close(ws, 4429, 'RATE_LIMIT'); fail('RATE_LIMIT', 429); }
        }
        ws.serializeAttachment(a);
        if (!validCommand) fail('INVALID');
        if (command.type === 'auth' && !a.id) {
          if (this.room.game === 'ersomha' && command.capabilities?.ersomha !== ERSOMHA_PROTOCOL) fail('CONFIG', 409);
          if (now > a.authDeadline) fail('AUTH', 401);
          const id = await this.authenticate(command);
          if (this.room.game === 'ersomha') {
            // Room tokens identify a seat, not an account. Ask only Ersomha
            // clients for a live bearer before revealing account-scoped words.
            // Older games keep their original single-message seat handshake.
            if (command.accountAuthorization === undefined) { this.send(ws, { type: 'account-auth', game: 'ersomha' }); return; }
            if (typeof command.accountAuthorization !== 'string' || command.accountAuthorization.length > 512) fail('AUTH', 401);
            const request = new Request(`https://room.internal/api/rooms/${this.room.code}/socket`, { headers: { authorization: command.accountAuthorization } });
            let auth;
            try { auth = await requireSession(this.env, request, { rotate: false }); }
            catch (error) { if (error instanceof RoomError && error.status < 500) fail('AUTH', 401); throw error; }
            const seat = member(this.room, id);
            if (auth.user.id !== seat.accountUserId || !await this.env.DB.prepare(`SELECT 1 AS ok WHERE ${liveAccountSql('?')}`).bind(auth.user.id, auth.user.id).first()) fail('AUTH', 401);
          }
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
        if (this.room.game === 'ersomha' && ['drawing_batch', 'drawing_undo', 'drawing_redo', 'drawing_clear', 'drawing_sync'].includes(command.type)) {
          await this.drawingCommand(ws, a.id, command); return;
        }
        const candidate = structuredClone(this.room);
        const deck = command.type === 'start' && candidate.game !== 'ersomha' ? (candidate.game === 'fabraka' ? buildFabrakaDeck(candidate) : meenfinaDeck(candidate)) : [];
        action(candidate, a.id, command, now, deck);
        if (candidate.game === 'ersomha' && command.type === 'start') attemptedStart = candidate;
        if (candidate.game === 'ersomha') await this.prepareErsomha(candidate);
        if (command.type === 'start' && !candidate.trialStarted) {
          // Validate the engine action first. Failed readiness/settings never
          // spend the allowance; a failed DO write can retry this private claim.
          await consumeRoomTrial(this.env, candidate.roomTrialGate, candidate.roomTrialClaim, now,
            candidate.members.some((member) => member.id === candidate.trialOwnerId && !member.left));
          candidate.trialStarted = true;
        }
        await this.commit(candidate, { prepared: candidate.game === 'ersomha' });
        this.send(ws, { type: 'ack', requestId, ok: true });
      } catch (error) {
        if (attemptedStart?.ersomhaLease && this.room?.phase === 'lobby') {
          try { await releaseErsomhaLease(this.env, attemptedStart.ersomhaLease); } catch { /* the short lease expires if D1 is unavailable */ }
        }
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
    let attemptedMatch;
    return this.serial(async () => {
      attemptedMatch = this.room && `${this.room.ersomhaKey}:${this.room.matchId}`;
      await this.advance();
      for (const ws of this.sockets()) {
        const a = this.attachment(ws);
        if (!a.id && a.authDeadline <= Date.now()) this.close(ws, 4401, 'AUTH');
      }
      await this.schedule();
    }).then(() => this.flushStats(), async error => {
      if (this.room?.game !== 'ersomha') throw error;
      if (error instanceof RoomError && ['AUTH', 'ERSOMHA_ACTIVE_ELSEWHERE'].includes(error.code)) {
        await this.serial(async () => {
          if (!this.room || `${this.room.ersomhaKey}:${this.room.matchId}` !== attemptedMatch) return;
          const candidate = structuredClone(this.room); candidate.phase = 'over'; candidate.deadlineAt = null;
          candidate.reason = error.code === 'AUTH' ? 'account_unavailable' : 'account_active_elsewhere';
          await this.commit(candidate);
        }); return;
      }
      // An unavailable database cannot expose a future card or spend a trial.
      // Re-arm explicitly, including in the local adapter, rather than relying
      // on the platform's finite automatic retries for a long outage.
      await this.ctx.storage.setAlarm(Date.now() + 5_000);
    });
  }
}
