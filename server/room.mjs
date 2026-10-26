import statements from '../src/data/games/meenfina/statements.json' with { type: 'json' };
import { createRoom, joinRoom, connected, leaveRoom, action, tick, snapshot, nextAlarm, member, roomCapacity, RoomError, fail } from './game-model.mjs';
import { buildFabrakaDeck } from './fabraka-content.mjs';
import { credentials, readJson, json, errorResponse, shuffled, createLimit } from './protocol.mjs';
import { bindSeatAccount, prepareRoomStats } from './room-stats.mjs';
import { recordOnlineResult, profileSummaries } from './profiles/db.mjs';
import { consumeRoomTrial, recheckMafiaHost } from './accounts/router.mjs';
import { requireSession } from './accounts/session.mjs';
import { liveAccountSql } from './moderation/access.mjs';
import { ERSOMHA_PROTOCOL, BADEEHA_PROTOCOL, MAFIA_PROTOCOL, ROOM_REACTIONS, REACTION_BURST, REACTION_REFILL_MS, reactionsAllowed } from '../src/online/shared.js';
import { requireMafiaEnabled, claimMafiaSeat, renewMafiaSeats, cleanupMafiaSeats, updateMafiaDirectory, mafiaPlaying, activateMafiaMedia } from './mafia-access.mjs';
import { prepareMafiaVoice, committedMafiaVoice, mafiaVoiceView, mafiaVoiceRequest } from './mafia-voice.mjs';
import { technicalAbort, snapshot as mafiaSnapshot } from './mafia-model.mjs';
import { persistMafiaResult, prepareMafiaResult } from './mafia-results.mjs';
import { blockUser } from './social/db.mjs';
import { getErsomhaPool } from './ersomha-content.mjs';
import { setErsomhaChoices, ERSOMHA_PLAYING, ERSOMHA_SELECT_MS } from './ersomha-model.mjs';
import { acquireErsomhaLease, assertErsomhaLease, renewErsomhaLease, releaseErsomhaLease, releaseErsomhaAccounts, ersomhaSeen, exposeErsomhaCards, buildErsomhaTurnPlan } from './ersomha-history.mjs';
import { ersomhaBoardId, emptyErsomhaDrawing, loadErsomhaDrawing, checkpointErsomhaDrawing, persistErsomhaDrawing,
  prepareErsomhaDrawing, ersomhaSyncMessages, ersomhaDrawingMeta, ersomhaVisibleCanvas, archiveErsomhaDrawing, deleteErsomhaDrawing } from './ersomha-drawing.mjs';
const SOCKET_IDLE = 45_000;
const STATS_RETRY = 30_000;
const STATS_MAX_ATTEMPTS = 48; // a day of half-minute retries
const MAX_QUEUED_SOCKET_MESSAGES = 64;
const MAX_QUEUED_ROOM_MESSAGES = 256;
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
    this.inboundBySocket = new WeakMap(); this.inboundCount = 0;
    this.mafiaLastSnapshots = new WeakMap();
    this.mafiaResultOutbox=[];
    // These are successful D1 synchronization fingerprints, never authority.
    // A cold/rehydrated object starts empty and safely resynchronizes them.
    this.mafiaMetadata={};
    this.ready = ctx.blockConcurrencyWhile(async () => {
      this.room = await ctx.storage.get('room') || null;
      this.profileOutbox = await ctx.storage.get('profileOutbox') || [];
      this.mafiaResultOutbox=await ctx.storage.get('mafiaResultOutbox')||[];
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
  outboxPending() { return Boolean(this.env.DB) && (this.profileOutbox.length > 0||this.mafiaResultOutbox.length>0); }
  mafiaVoiceAlive(room,id,now=Date.now()) {
    const account=room.members.find(m=>m.id===id)?.accountUserId;
    return room.game==='mafia'&&Boolean(room.mafiaMedia?.devices?.[account])&&room.mafiaMedia?.authSessions?.[account]?.expiresAt>now&&now-(room.mafiaMedia?.presence?.[account]||0)<SOCKET_IDLE;
  }
  mafiaAuthDeadline(room) {
    return Math.min(...Object.values(room.mafiaMedia?.authSessions||{}).map(s=>s.expiresAt),...this.sockets().map(ws=>this.attachment(ws).accountExpiresAt).filter(Number.isFinite));
  }
  alarmAt(room, now) {
    if(room.game==='mafia'&&this.mafiaCleanupRetryAt>now)return this.mafiaCleanupRetryAt;
    const deadlines = this.sockets().map((ws) => {
      const a = this.attachment(ws);
      return a.id ? this.lastSeen(ws, a) + SOCKET_IDLE : a.authDeadline;
    }).filter(Number.isFinite);
    return Math.max(now + 1, Math.min(nextAlarm(room, now), ...deadlines, ...(room.game==='mafia'?[room.mafiaRenewAt||now+30_000,this.mafiaAuthDeadline(room)]:[]), ...(this.outboxPending() ? [now + STATS_RETRY] : [])));
  }
  async schedule() {
    if (this.room) await this.ctx.storage.setAlarm(this.alarmAt(this.room, Date.now()));
    else if (this.outboxPending()) await this.ctx.storage.setAlarm(Date.now() + STATS_RETRY);
    else await this.ctx.storage.deleteAlarm();
  }
  async commit(candidate, { prepared = false } = {}) {
    const oldLease = this.room?.ersomhaLease;
    if (candidate.game === 'ersomha' && !prepared) await this.prepareErsomha(candidate);
    if (candidate.game === 'mafia' && !prepared) await this.prepareMafia(candidate);
    if (candidate.game === 'ersomha' && candidate.phase === 'select' && (this.room?.phase !== 'select' || this.room.round !== candidate.round || this.room.matchId !== candidate.matchId)) {
      candidate.deadlineAt = Date.now() + ERSOMHA_SELECT_MS;
    }
    candidate.revision++;
    const outbox = [...this.profileOutbox, ...prepareRoomStats(this.room, candidate)];
    const mafiaResult=candidate.game==='mafia'&&candidate.phase==='over'&&this.room?.phase!=='over'?prepareMafiaResult(candidate):null;
    const mafiaOutbox=[...this.mafiaResultOutbox,...(mafiaResult?[mafiaResult]:[])];
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
      if(mafiaOutbox.length)await tx.put('mafiaResultOutbox',mafiaOutbox);
      await tx.setAlarm(Math.min(this.alarmAt(candidate, Date.now()), ...(outbox.length ? [Date.now() + STATS_RETRY] : [])));
    });
    this.room = candidate;
    if (candidate.game === 'ersomha') { this.drawing = nextDrawing; this.drawingHead = nextDrawingHead; this.drawingArchives = nextArchives; }
    this.profileOutbox = outbox;
    this.mafiaResultOutbox=mafiaOutbox;
    this.broadcast();
    if(candidate.game==='mafia') {
      await this.settleMafiaMetadata(candidate);
      if(this.mafiaResultOutbox.length)await this.flushMafiaResults();
    }
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
  async settleMafiaMetadata(room) {
    const members=room.members.filter(m=>!m.left);
    const accounts=members.map(m=>m.accountUserId).sort();
    const media=room.mafiaMedia;
    const mediaKey=JSON.stringify([room.mafiaKey,room.matchId,room.phase,media?.callId,media?.epoch,media?.failed,media?.quarantineUntil,room.technicalAbort,room.reason,room.trialStarted,room.roomTrialClaim,members.filter(m=>room.participants.includes(m.id)).map(m=>m.accountUserId).sort()]);
    if(this.mafiaMetadata.media!==mediaKey) {
      await committedMafiaVoice(this.ctx,this.env,room);
      this.mafiaMetadata.media=mediaKey;
    }
    const seatKey=JSON.stringify([room.mafiaKey,room.phase==='closed',accounts]);
    if(this.mafiaMetadata.seats!==seatKey) {
      await cleanupMafiaSeats(this.env,room);
      this.mafiaMetadata.seats=seatKey;
    }
    const listed=room.phase==='lobby'&&room.settings.visibility==='public'&&members.length>0;
    const directoryKey=JSON.stringify([room.mafiaKey,listed?{settings:room.settings,hostId:room.hostId,expiresAt:room.expiresAt,members:members.map(m=>[m.id,m.name,!!m.ready])}:null]);
    if(this.mafiaMetadata.directory!==directoryKey||(listed&&Date.now()>=this.mafiaMetadata.directoryRefreshAt)) {
      // Directory is advisory; admission always checks the committed room.
      // Its90s expiry is renewed even when the public lobby does not change.
      await updateMafiaDirectory(this.env,room);
      this.mafiaMetadata.directory=directoryKey;
      this.mafiaMetadata.directoryRefreshAt=Date.now()+30_000;
    }
  }
  async flushMafiaResults() {
    if(!this.env.DB)return;
    while(this.mafiaResultOutbox.length) {
      const event=this.mafiaResultOutbox[0];
      try {await persistMafiaResult(this.env,event);}catch {await this.ctx.storage.setAlarm(Date.now()+STATS_RETRY);return;}
      const rest=this.mafiaResultOutbox.slice(1);
      await this.ctx.storage.put('mafiaResultOutbox',rest);this.mafiaResultOutbox=rest;
    }
  }
  async validateMafiaSessions(candidate,now=Date.now()) {
    const sockets=this.sockets().map(ws=>({ws,...this.attachment(ws)})).filter(a=>a.id&&a.accountSessionId);
    const media=candidate.mafiaMedia;
    const ids=[...new Set([...sockets.map(a=>a.accountSessionId),...Object.values(media?.authSessions||{}).map(a=>a.id)])];
    const sessions=ids.length?(await this.env.DB.prepare(`SELECT id,user_id,expires_at,revoked_at FROM sessions WHERE id IN (${ids.map(()=>'?').join(',')}) AND expires_at>? AND (revoked_at IS NULL OR revoked_at>?) AND ${liveAccountSql('sessions.user_id')}`).bind(...ids,now,now).all()).results||[]:[];
    const valid=(id,userId)=>sessions.find(s=>s.id===id&&s.user_id===userId);
    const affected=new Set();
    for(const a of sockets) {
      const session=valid(a.accountSessionId,a.accountUserId);
      if(!session||a.revoked) {
        // Keep identity until durable media reconciliation, including when the
        // provider fails. The close callback must never turn AUTH into grace.
        a.ws.serializeAttachment({...this.attachment(a.ws),revoked:true});this.close(a.ws,4401,'AUTH');affected.add(a.accountUserId);
      } else {
        const accountExpiresAt=Math.min(session.expires_at,session.revoked_at??Number.MAX_SAFE_INTEGER);
        if(a.accountExpiresAt!==accountExpiresAt)a.ws.serializeAttachment({...this.attachment(a.ws),accountExpiresAt});
      }
    }
    for(const userId of new Set([...Object.keys(media?.sessions||{}),...Object.keys(media?.devices||{}),...(media?.issued||[]).map(i=>i.identity)])) {
      const binding=media.authSessions?.[userId],session=binding&&valid(binding.id,userId);
      if(session) {binding.expiresAt=Math.min(session.expires_at,session.revoked_at??Number.MAX_SAFE_INTEGER);continue;}
      affected.add(userId);
      const nonce=media.sessions?.[userId];media.retiredSessions||={};media.retiredSessions[userId]=[...new Set([...(media.retiredSessions[userId]||[]),...(nonce?[nonce]:[])])];
      delete media.sessions?.[userId];delete media.authSessions?.[userId];delete media.devices?.[userId];delete media.presence?.[userId];
      // Keep issued grants until prepareMafiaVoice has durably journaled and
      // strictly revoked them. Even an otherwise unchanged audience needs it.
      media.signature=null;
    }
    for(const userId of affected) {
      const seat=candidate.members.find(m=>m.accountUserId===userId&&!m.left);
      const otherSocket=sockets.some(a=>a.accountUserId===userId&&!a.revoked&&a.ws.readyState===1&&valid(a.accountSessionId,userId));
      const otherMedia=media?.authSessions?.[userId]&&valid(media.authSessions[userId].id,userId);
      if(seat&&!otherSocket&&!otherMedia)connected(candidate,seat.id,false,now);
    }
  }
  async reconcileMafiaSessions() {
    if(this.room?.game!=='mafia')return;
    const candidate=structuredClone(this.room);
    await this.validateMafiaSessions(candidate);
    if(JSON.stringify(candidate)!==JSON.stringify(this.room)||await this.ctx.storage.get('mafia:voice-transition')) {
      await prepareMafiaVoice(this.ctx,this.env,this.room,candidate);
      await this.commit(candidate,{prepared:true});
    }
    if(candidate.mafiaMedia?.failed)fail('MAFIA_VOICE_UNAVAILABLE',503);
  }
  async prepareMafia(candidate) {
    await this.validateMafiaSessions(candidate);
    if((!candidate.mafiaRenewAt||Date.now()>=candidate.mafiaRenewAt)&&!(candidate.mafiaMedia?.failed&&!mafiaPlaying(candidate))) {
      await renewMafiaSeats(this.env,candidate);
      if(mafiaPlaying(candidate)&&candidate.mafiaMedia)await activateMafiaMedia(this.env,candidate);
    }
    await prepareMafiaVoice(this.ctx,this.env,this.room,candidate);
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
    if (this.room.game === 'mafia') state.mafiaVoice=mafiaVoiceView(this.room,id);
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
  // Quick reactions are ephemeral: a fixed emoji set broadcast to the seated sockets,
  // never written to storage or to the room snapshot. Their own small bucket keeps a
  // tapping thumb from spending the seat's general command budget.
  reaction(ws, a, command, now) {
    if (!ROOM_REACTIONS.includes(command.emoji)) fail('INVALID');
    member(this.room, a.id);
    if (!reactionsAllowed(this.room, a.id)) fail('PRIVATE', 409);
    a.reactTokens = Math.min(REACTION_BURST, (a.reactTokens ?? REACTION_BURST) + Math.max(0, now - (a.reactAt ?? now)) / REACTION_REFILL_MS);
    a.reactAt = now;
    if (a.reactTokens < 1) { ws.serializeAttachment(a); fail('RATE_LIMIT', 429); }
    a.reactTokens -= 1; ws.serializeAttachment(a);
    this.reactionCounter = (this.reactionCounter || 0) + 1;
    const event = { type: 'reaction', id: `${now.toString(36)}-${this.reactionCounter}`, seatId: a.id, emoji: command.emoji, at: now };
    for (const socket of this.sockets()) {
      const seat = this.attachment(socket).id;
      if (seat && this.room.members.some((m) => m.id === seat && !m.left)) this.send(socket, event);
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
      const state=this.stateFor(id);
      if(this.room.game==='mafia') {
        // Identical snapshots are not emitted to uninvolved viewers for secret
        // commands; even their message timing must not reveal team activity.
        const comparison=JSON.stringify({...state,serverNow:0});
        if(this.mafiaLastSnapshots.get(ws)===comparison)continue;
        this.mafiaLastSnapshots.set(ws,comparison);
      }
      this.send(ws, { type: 'state', state });
    }
  }
  async advance({ force = false } = {}) {
    if (!this.room) return;
    const now = Date.now();
    if(this.room.game==='mafia'&&this.mafiaCleanupRetryAt>now)return;
    // Between durable room changes only time can advance the game. Avoid
    // cloning/stringifying the full private turn plan for every ink batch.
    // Rehydration, a changed room object, and alarms always re-evaluate it.
    if (!force && this.fastAdvanceRoom === this.room && now < this.fastAdvanceUntil) return;
    const candidate = structuredClone(this.room);
    // A phone can vanish without a TCP close. Hibernation auto-pongs provide
    // liveness without waking the object on every heartbeat.
    for (const ws of this.sockets()) {
      const a = this.attachment(ws);
      if (a.id && Date.now() - this.lastSeen(ws, a) >= SOCKET_IDLE) {
        ws.serializeAttachment({ timedOut: true });
        this.close(ws, 4000, 'DISCONNECTED');
        if (candidate.members.some((m) => m.id === a.id && !m.left)&&!this.mafiaVoiceAlive(candidate,a.id)) connected(candidate, a.id, false, Date.now());
      }
    }
    if(candidate.game==='mafia')for(const m of candidate.members.filter(m=>!m.left&&m.connected))if(!this.sockets().some(ws=>this.attachment(ws).id===m.id)&&!this.mafiaVoiceAlive(candidate,m.id))connected(candidate,m.id,false,Date.now());
    tick(candidate, Date.now());
    if (candidate.phase === 'closed') {
      const reason = candidate.reason === 'expired' ? 'EXPIRED' : 'NOT_FOUND';
      for (const ws of this.sockets()) { this.send(ws, { type: 'error', error: reason }); this.close(ws, 4404, reason); }
      if (candidate.game === 'ersomha') {
        try { await releaseErsomhaLease(this.env, candidate.ersomhaLease); } catch { /* short lease expiry remains safe */ }
        await deleteErsomhaDrawing(this.ctx.storage, this.drawingHead, this.drawingArchives);
      }
      if(candidate.game==='mafia') {await prepareMafiaVoice(this.ctx,this.env,this.room,candidate);await committedMafiaVoice(this.ctx,this.env,candidate);if(candidate.mafiaMedia?.failed){this.mafiaCleanupRetryAt=Date.now()+STATS_RETRY;await this.ctx.storage.setAlarm(this.mafiaCleanupRetryAt);return;}await cleanupMafiaSeats(this.env,candidate);await updateMafiaDirectory(this.env,candidate);}
      if (this.profileOutbox.length||this.mafiaResultOutbox.length) await this.deleteKey('room');
      else await this.ctx.storage.deleteAll();
      this.room = null;
      this.drawing = null; this.drawingHead = null; this.drawingArchives = [];
      await this.schedule();
      await this.flushMafiaResults();
    } else if (JSON.stringify(candidate) !== JSON.stringify(this.room)
      || candidate.game === 'ersomha' && candidate.ersomhaLease && ERSOMHA_PLAYING.includes(candidate.phase) && Date.now() >= candidate.ersomhaLease.renewAt
      || candidate.game === 'mafia' && (Date.now()>=(candidate.mafiaRenewAt||0)||Date.now()>=this.mafiaAuthDeadline(candidate))) {
      try { await this.commit(candidate); }
      catch (error) {
        if(candidate.game==='mafia') {
          if(!mafiaPlaying(this.room))throw error;
          const stopped=structuredClone(this.room);technicalAbort(stopped,Date.now(),'account_unavailable');
          await prepareMafiaVoice(this.ctx,this.env,this.room,stopped);
          await this.commit(stopped,{prepared:true});return;
        }
        if (candidate.game !== 'ersomha' || !(error instanceof RoomError) || !['AUTH', 'ERSOMHA_ACTIVE_ELSEWHERE'].includes(error.code)) throw error;
        // Every entry point advances first, including HTTP leave and socket
        // close. End a revoked match here so cleanup never depends on its alarm.
        const stopped = structuredClone(this.room); stopped.phase = 'over'; stopped.deadlineAt = null;
        stopped.reason = error.code === 'AUTH' ? 'account_unavailable' : 'account_active_elsewhere';
        await this.commit(stopped);
      }
    } else {
      this.fastAdvanceRoom = this.room;
      this.fastAdvanceUntil = this.alarmAt(this.room, now);
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
    if (!['ersomha','mafia'].includes(room.game)) return;
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
          const input = await credentials(await readJson(request, 4096, createLimit));
          if (input.game === 'badeeha' && input.capabilities?.badeeha !== BADEEHA_PROTOCOL) fail('UPDATE_REQUIRED', 409);
          if(input.game==='mafia') {requireMafiaEnabled(this.env);if(input.capabilities?.mafia!==MAFIA_PROTOCOL)fail('UPDATE_REQUIRED',409);if(!input.accountUserId)fail('AUTH_REQUIRED',401);}
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
            if (['ersomha','mafia'].includes(this.room.game) && owner.accountUserId !== input.accountUserId) fail('AUTH', 401);
            return json({ code: this.room.code, id: input.id, game: this.room.game || 'meenfina' });
          }
          const created = createRoom(code, input, Date.now());
          created.roomTrialGate = input.roomTrialGate || null;
          created.roomTrialClaim = crypto.randomUUID();
          created.trialOwnerId = input.id;
          created.trialStarted = false;
          bindSeatAccount(created, input.id, input.accountUserId);
          if(created.game==='mafia') {created.mafiaKey=crypto.randomUUID();await claimMafiaSeat(this.env,created,input.id);}
          await this.hydrateErsomhaProfile(created, input.id);
          // Reject empty topic selections while the creator can still edit them,
          // rather than trapping an assembled group in an unstartable lobby.
          if (created.game === 'fabraka' && buildFabrakaDeck(created).length < created.rounds) fail('QUESTIONS');
          await this.commit(created);
          return json({ code, id: input.id, game: this.room.game }, 201);
        }
        if (!this.room) fail('NOT_FOUND', 404);
        if(request.method==='POST'&&endpoint==='mafia-session-revoked') {
          if(this.room.game!=='mafia')fail('NOT_FOUND',404);
          // Internal wake-up only: current D1 authorization decides what is
          // revoked, so an old notification cannot remove a successor session.
          await this.reconcileMafiaSessions();await this.schedule();return json({ok:true});
        }
        if(request.method==='POST'&&endpoint==='mafia-account-removed') {
          if(this.room.game!=='mafia')fail('NOT_FOUND',404);
          const body=await readJson(request),seat=this.room.members.find(m=>!m.left&&m.accountUserId===body.accountUserId);
          if(!seat){if(this.room.mafiaMedia?.failed)fail('MAFIA_VOICE_UNAVAILABLE',503);return json({ok:true});}
          const candidate=structuredClone(this.room);leaveRoom(candidate,seat.id,Date.now());
          await prepareMafiaVoice(this.ctx,this.env,this.room,candidate);await this.commit(candidate,{prepared:true});
          if(candidate.mafiaMedia?.failed)fail('MAFIA_VOICE_UNAVAILABLE',503);
          return json({ok:true});
        }
        if(request.method==='POST'&&endpoint==='mafia-voice') {
          if(this.room.game!=='mafia')fail('NOT_FOUND',404);
          const body=await readJson(request),response=await mafiaVoiceRequest(this.ctx,this.env,this.room,body.accountUserId,body);
          this.fastAdvanceRoom=null;await this.schedule();return json(response);
        }
        if(request.method==='POST'&&endpoint==='mafia-evidence') {
          if(this.room.game!=='mafia')fail('NOT_FOUND',404);
          const body=await readJson(request),seat=this.room.members.find(m=>m.accountUserId===body.accountUserId);
          if(!seat||body.matchId!==this.room.matchId)fail('NOT_FOUND',404);
          const target=this.room.members.find(m=>m.id===body.targetId);if(!target?.accountUserId)fail('NOT_FOUND',404);
          // Capture only evidence the reporter was authorized to see. No role
          // map, other faction chat, or voice recording enters the report.
          const view=mafiaSnapshot(this.room,seat.id,Date.now());
          return json({matchKey:`${this.room.mafiaKey}:${this.room.matchId}`,reportedUserId:target.accountUserId,phase:this.room.phase,publicHistory:view.log||[],messages:Object.values(view.chats||{}).flat().filter(m=>!body.messageId||m.id===body.messageId)});
        }
        if(request.method==='POST'&&endpoint==='mafia-block-account') {
          if(this.room.game!=='mafia')fail('NOT_FOUND',404);
          const body=await readJson(request),seat=this.room.members.find(m=>!m.left&&m.accountUserId===body.accountUserId),target=this.room.members.find(m=>!m.left&&m.accountUserId===body.targetAccountUserId);
          if(!seat||!target||seat.id===target.id)return json({ok:true,left:false});
          const candidate=structuredClone(this.room);leaveRoom(candidate,seat.id,Date.now());await this.commit(candidate);
          return json({ok:true,left:true});
        }
        if(request.method==='POST'&&endpoint==='mafia-block') {
          if(this.room.game!=='mafia')fail('NOT_FOUND',404);
          const body=await readJson(request),seat=this.room.members.find(m=>!m.left&&m.accountUserId===body.accountUserId),target=this.room.members.find(m=>m.id===body.targetId);
          if(!seat||!target?.accountUserId||seat.id===target.id)fail('NOT_FOUND',404);
          await blockUser(this.env,seat.accountUserId,target.accountUserId,Date.now());
          const candidate=structuredClone(this.room);leaveRoom(candidate,seat.id,Date.now());await this.commit(candidate);
          return json({ok:true,left:true});
        }
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
          if(this.room.members.filter(m=>!m.left).length >= roomCapacity(this.room))fail(this.room.game === 'fabraka' ? 'FULL_FABRAKA' : this.room.game === 'ersomha' ? 'FULL_ERSOMHA' : this.room.game === 'badeeha' ? 'FULL_BADEEHA' : 'FULL',409);
          return json({game:this.room.game||'meenfina',expiresAt:this.room.expiresAt});
        }
        if (request.method === 'POST' && endpoint === 'join') {
          const input = await credentials(await readJson(request));
          if (this.room.game === 'badeeha' && input.capabilities?.badeeha !== BADEEHA_PROTOCOL) fail('UPDATE_REQUIRED', 409);
          if(this.room.game==='mafia') {
            if(input.capabilities?.mafia!==MAFIA_PROTOCOL)fail('UPDATE_REQUIRED',409);
            if(!input.accountUserId)fail('AUTH_REQUIRED',401);
            const previous=this.room.members.find(m=>!m.left&&m.id===input.id);
            if(previous&&previous.accountUserId!==input.accountUserId)fail('AUTH',401);
            if(!previous&&this.room.phase==='lobby')requireMafiaEnabled(this.env);
            if(input.matchmaking&&(this.room.phase!=='lobby'||this.room.settings.visibility!=='public'))fail('STARTED',409);
          }
          if (this.room.game === 'ersomha') {
            if (input.capabilities?.ersomha !== ERSOMHA_PROTOCOL) fail('CONFIG', 409);
            if (typeof input.accountUserId !== 'string' || !input.accountUserId) fail('AUTH_REQUIRED', 401);
            const previous = this.room.members.find(m => !m.left && m.id === input.id);
            if (previous && previous.accountUserId !== input.accountUserId) fail('AUTH', 401);
          }
          const candidate = structuredClone(this.room);
          joinRoom(candidate, input, Date.now());
          bindSeatAccount(candidate, input.id, input.accountUserId);
          if(candidate.game==='mafia')await claimMafiaSeat(this.env,candidate,input.id);
          await this.hydrateErsomhaProfile(candidate, input.id);
          await this.commit(candidate);
          return json({ code: this.room.code, id: input.id, game: this.room.game || 'meenfina' });
        }
        if (request.method === 'POST' && endpoint === 'leave') {
          const id = await this.authenticate(await readJson(request));
          if(this.room.game==='mafia'){const auth=await requireSession(this.env,request,{rotate:false});if(member(this.room,id).accountUserId!==auth.user.id)fail('AUTH',401);}
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
    // Reject oversized frames before they can wait behind storage. Checking
    // character length first also bounds the temporary UTF-8 encoder buffer.
    if (typeof message !== 'string' || message.length > 4096 || new TextEncoder().encode(message).length > 4096) {
      this.send(ws, { type: 'error', error: 'INVALID' }); this.close(ws, 1009, 'INVALID'); return Promise.resolve();
    }
    const queued = this.inboundBySocket.get(ws) || 0;
    // Admission happens before the serial queue and before storage. A slow
    // write must not let one flooding client retain unbounded frames or delay
    // every other seat; normal rate limits still run inside the durable order.
    if (queued >= MAX_QUEUED_SOCKET_MESSAGES || this.inboundCount >= MAX_QUEUED_ROOM_MESSAGES) {
      this.close(ws, 4429, 'RATE_LIMIT'); return Promise.resolve();
    }
    this.inboundBySocket.set(ws, queued + 1); this.inboundCount++;
    return this.serial(async () => {
      let requestId, attemptedStart;
      try {
        if (ws.readyState !== 1) return;
        await this.advance();
        if (ws.readyState !== 1) return;
        if (!this.room) fail('NOT_FOUND', 404);
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
        } else if (!(a.id && requestId && validCommand && command.type === 'react' && ROOM_REACTIONS.includes(command.emoji))) {
          if (!a.windowAt || now - a.windowAt > 10_000) { a.windowAt = now; a.count = 0; }
          a.count = (a.count || 0) + 1;
          if (a.count > 35) { ws.serializeAttachment(a); this.close(ws, 4429, 'RATE_LIMIT'); fail('RATE_LIMIT', 429); }
        }
        ws.serializeAttachment(a);
        if (!validCommand) fail('INVALID');
        if (command.type === 'auth' && !a.id) {
          if (this.room.game === 'badeeha' && command.capabilities?.badeeha !== BADEEHA_PROTOCOL) fail('UPDATE_REQUIRED', 409);
          if (this.room.game === 'ersomha' && command.capabilities?.ersomha !== ERSOMHA_PROTOCOL) fail('CONFIG', 409);
          if (this.room.game === 'mafia' && command.capabilities?.mafia !== MAFIA_PROTOCOL) fail('UPDATE_REQUIRED', 409);
          if (now > a.authDeadline) fail('AUTH', 401);
          const id = await this.authenticate(command);
          let accountIdentity={};
          if (['ersomha','mafia'].includes(this.room.game)) {
            // Room tokens identify a seat, not an account. Ask only Ersomha
            // clients for a live bearer before revealing account-scoped words.
            // Older games keep their original single-message seat handshake.
            if (command.accountAuthorization === undefined) { this.send(ws, { type: 'account-auth', game: this.room.game }); return; }
            if (typeof command.accountAuthorization !== 'string' || command.accountAuthorization.length > 512) fail('AUTH', 401);
            const request = new Request(`https://room.internal/api/rooms/${this.room.code}/socket`, { headers: { authorization: command.accountAuthorization } });
            let auth;
            try { auth = await requireSession(this.env, request, { rotate: false }); }
            catch (error) { if (error instanceof RoomError && error.status < 500) fail('AUTH', 401); throw error; }
            const seat = member(this.room, id);
            if (auth.user.id !== seat.accountUserId || !await this.env.DB.prepare(`SELECT 1 AS ok WHERE ${liveAccountSql('?')}`).bind(auth.user.id, auth.user.id).first()) fail('AUTH', 401);
            if(this.room.game==='mafia')accountIdentity={accountSessionId:auth.session.id,accountUserId:auth.user.id,accountExpiresAt:Math.min(auth.session.expires_at,auth.session.revoked_at??Number.MAX_SAFE_INTEGER)};
          }
          // Only one controlling connection per seat; old close cannot disconnect the replacement.
          for (const other of this.sockets()) if (other !== ws && this.attachment(other).id === id) {
            other.serializeAttachment({ replaced: true }); this.close(other, 4409, 'REPLACED');
          }
          ws.serializeAttachment({ id, seenAt: now, windowAt: now, count: 1,...accountIdentity });
          const candidate = structuredClone(this.room);
          connected(candidate, id, true, now);
          await this.commit(candidate);
          return;
        }
        // A malformed requestId on an authenticated seat is a bad command, not a
        // failed login: answering with INVALID keeps the player's session alive.
        if (!a.id) fail('AUTH', 401);
        if (!requestId) fail('INVALID');
        if(this.room.game==='mafia'&&!await this.env.DB.prepare(`SELECT 1 FROM sessions WHERE id=? AND user_id=? AND expires_at>? AND (revoked_at IS NULL OR revoked_at>?) AND ${liveAccountSql('sessions.user_id')}`).bind(a.accountSessionId||'',a.accountUserId||'',now,now).first())fail('AUTH',401);
        if (command.type === 'react') { this.reaction(ws, a, command, now); this.send(ws, { type: 'ack', requestId, ok: true }); return; }
        if (this.room.game === 'ersomha' && ['drawing_batch', 'drawing_undo', 'drawing_redo', 'drawing_clear', 'drawing_sync'].includes(command.type)) {
          await this.drawingCommand(ws, a.id, command); return;
        }
        const candidate = structuredClone(this.room);
        const deck = command.type === 'start' && !['ersomha', 'badeeha','mafia'].includes(candidate.game) ? (candidate.game === 'fabraka' ? buildFabrakaDeck(candidate) : meenfinaDeck(candidate)) : [];
        if(candidate.game==='mafia'&&command.type==='start') {requireMafiaEnabled(this.env);await recheckMafiaHost(this.env,candidate,now);}
        action(candidate, a.id, command, now, deck);
        if (candidate.game === 'ersomha' && command.type === 'start') attemptedStart = candidate;
        if (candidate.game === 'ersomha') await this.prepareErsomha(candidate);
        if (candidate.game === 'mafia') await this.prepareMafia(candidate);
        if (command.type === 'start' && !candidate.trialStarted && !(candidate.game==='mafia'&&candidate.phase==='over')) {
          // Validate the engine action first. Failed readiness/settings never
          // spend the allowance; a failed DO write can retry this private claim.
          await consumeRoomTrial(this.env, candidate.roomTrialGate, candidate.roomTrialClaim, now,
            candidate.members.some((member) => member.id === candidate.trialOwnerId && !member.left));
          candidate.trialStarted = true;
        }
        await this.commit(candidate, { prepared: ['ersomha','mafia'].includes(candidate.game) });
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
        if(code==='AUTH'&&seated&&this.room?.game==='mafia') {
          ws.serializeAttachment({...this.attachment(ws),revoked:true});
          try {await this.reconcileMafiaSessions();}catch {await this.ctx.storage.setAlarm(Date.now()+STATS_RETRY);}
        }
        if (['NOT_FOUND', 'EXPIRED'].includes(code) || (code === 'AUTH' && (!seated||this.room?.game==='mafia'))) this.close(ws, 4401, code);
      }
    }).finally(() => {
      this.inboundBySocket.set(ws, Math.max(0, (this.inboundBySocket.get(ws) || 1) - 1));
      this.inboundCount = Math.max(0, this.inboundCount - 1);
    });
  }
  webSocketClose(ws) {
    return this.serial(async () => {
      this.close(ws, 1000, 'closed');
      await this.advance({ force: true });
      const { id } = this.attachment(ws);
      if (!id || !this.room || !this.room.members.some((m) => m.id === id && !m.left)) return;
      if (this.sockets().some((other) => other !== ws && this.attachment(other).id === id && other.readyState === 1)) return;
      if(this.mafiaVoiceAlive(this.room,id))return;
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
      await this.advance({ force: true });
      for (const ws of this.sockets()) {
        const a = this.attachment(ws);
        if (!a.id && a.authDeadline <= Date.now()) this.close(ws, 4401, 'AUTH');
      }
      await this.schedule();
      await this.flushMafiaResults();
    }).then(() => this.flushStats(), async error => {
      if(this.room?.game==='mafia'){this.mafiaCleanupRetryAt=Date.now()+STATS_RETRY;await this.ctx.storage.setAlarm(this.mafiaCleanupRetryAt);return;}
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
