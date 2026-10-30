import test from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../server/room.mjs';
import { createLocalD1 } from '../server/local-d1.mjs';
import { createRoom, joinRoom, connected, action } from '../server/game-model.mjs';
import { bindSeatAccount } from '../server/room-stats.mjs';
import { getErsomhaPool } from '../server/ersomha-content.mjs';
import { ersomhaAccountHash } from '../server/ersomha-history.mjs';
import { sha256 } from '../server/protocol.mjs';
import { issueSession } from '../server/accounts/session.mjs';

class Storage {
  constructor() { this.data = new Map(); this.writes = []; this.failRoomOnce = false; this.failHeadOnce = false; }
  async get(key) { return structuredClone(this.data.get(key)); }
  async put(key, value) {
    if (key === 'room' && this.failRoomOnce) { this.failRoomOnce = false; throw new Error('DO room write unavailable'); }
    if (key === 'ersomha:board' && this.failHeadOnce) { this.failHeadOnce = false; throw new Error('DO drawing write unavailable'); }
    this.writes.push(key); this.data.set(key, structuredClone(value));
  }
  async delete(key) { this.data.delete(key); }
  async deleteAll() { this.data.clear(); }
  async setAlarm(at) { this.alarm = at; }
  async deleteAlarm() { this.alarm = null; }
  async transaction(fn) { const data = structuredClone(this.data), alarm = this.alarm; try { return await fn(this); } catch (e) { this.data = data; this.alarm = alarm; throw e; } }
}
class Socket {
  constructor(id, storage, identity) { this.readyState = 1; this.a = { id, seenAt: Date.now(), windowAt: Date.now(), count: 1, ...identity }; this.messages = []; this.storage = storage; }
  serializeAttachment(value) { this.a = structuredClone(value); }
  deserializeAttachment() { return structuredClone(this.a); }
  send(raw) {
    const value = raw === 'pong' ? raw : JSON.parse(raw);
    if (value.type === 'drawing' && value.kind !== 'sync') assert.equal(this.storage.data.get('ersomha:board').seq, value.seq, 'receiver sees only a committed delta');
    this.messages.push(value);
  }
  close(code, reason) { this.readyState = 3; this.closed = { code, reason }; }
}
async function fixture({ count = 3, trial = false, settings = {} } = {}) {
  const DB = createLocalD1(), now = Date.now(), storage = new Storage(), profiles = [], sessions = [];
  const observed = { reads: 0, statements: [], failHistory: false };
  const env = { DB: {
    prepare(sql) { observed.reads++; observed.statements.push(sql); if (observed.failHistory && /ersomha_seen/.test(sql)) throw new Error('history DB unavailable'); return DB.prepare(sql); },
    batch: statements => DB.batch(statements),
  } };
  for (let n = 0; n < count; n++) {
    await DB.prepare('INSERT INTO users(id,name,created_at,updated_at) VALUES(?,?,?,?)').bind(`account-${n}`, `لاعب ${n}`, now, now).run();
    sessions.push(await issueSession({ DB }, `account-${n}`));
    profiles.push({ id: `seat-${n}`, tokenHash: `token-${n}`, name: `لاعب ${n}`, avatar: n % 4, game: 'ersomha', settings });
  }
  const state = createRoom('123456', profiles[0], now);
  for (const p of profiles.slice(1)) joinRoom(state, p, now);
  state.members.forEach((m, n) => { bindSeatAccount(state, m.id, `account-${n}`); connected(state, m.id, true, now); m.ready = true; });
  state.roomTrialGate = trial ? { userId: 'account-0', device: null, game: 'ersomha', premium: false } : null;
  state.roomTrialClaim = crypto.randomUUID(); state.trialOwnerId = 'seat-0'; state.trialStarted = false;
  await storage.put('room', state);
  // These fixtures start after the real handshake. Carry its live account
  // binding as well as the seat identity; authorization is never stubbed out.
  const sockets = profiles.map((p, n) => new Socket(p.id, storage, { accountUserId: `account-${n}`, accountSessionId: sessions[n].id, accountExpiresAt: sessions[n].expiresAt }));
  const ctx = { storage, blockConcurrencyWhile: fn => fn(), getWebSockets: () => sockets.filter(s => s.readyState === 1) };
  let room = new Room(ctx, env); await room.ready; let request = 0;
  async function command(n, type, fields = {}) {
    const requestId = `request-${++request}`;
    await room.webSocketMessage(sockets[n], JSON.stringify({ type, requestId, matchId: room.room.matchId, round: room.room.round, ...fields }));
    return sockets[n].messages.findLast(m => m.type === 'ack' && m.requestId === requestId);
  }
  return { DB, env, storage, observed, sockets, ctx, get room() { return room; }, command,
    async restore() { room = new Room(ctx, env); await room.ready; return room; }, close() { DB.close(); } };
}
async function begin(f) {
  assert.equal((await f.command(0, 'start')).ok, true);
  assert.equal((await f.command(0, 'select_word', { choiceId: f.room.room.draw.choices[0].id })).ok, true);
}
const stroke = (n, extra = {}) => ({ epoch: 1, strokeId: `stroke-${n}`, tool: 'pen', width: 6, color: '#118d96', points: [[0.1, 0.2], [0.2, 0.3]], end: true, ...extra });

test('steady ink does not clone the private room plan on every batch while timed hints still commit before delivery', async () => {
  const f = await fixture(), realNow = Date.now, realClone = structuredClone;
  let roomClones = 0, now;
  try {
    await begin(f); now = realNow(); Date.now = () => now;
    globalThis.structuredClone = value => { if (value === f.room.room) roomClones++; return realClone(value); };
    for (let n = 0; n < 30; n++) { now += 80; assert.equal((await f.command(0, 'drawing_batch', stroke(n))).ok, true); }
    assert.ok(roomClones <= 2, `steady deltas cloned the private plan ${roomClones} times`);
    assert.equal(f.room.room.draw.lengthsRevealed, false);
    now = f.room.room.draw.startedAt + 30_001;
    assert.equal((await f.command(0, 'drawing_batch', stroke('hint'))).ok, true);
    assert.equal(f.room.room.draw.lengthsRevealed, true);
    assert.equal(f.storage.data.get('room').draw.lengthsRevealed, true);
    await f.restore(); now = f.room.room.deadlineAt + 1;
    assert.equal((await f.command(0, 'drawing_batch', stroke('expired'))).error, 'PHASE');
    assert.equal(f.room.room.phase, 'result', 'rehydration cannot reuse a stale fast-path deadline');
  } finally { Date.now = realNow; globalThis.structuredClone = realClone; f.close(); }
});

test('a blocked durable queue rejects flooding before retaining unbounded frames and still serves another seat', async () => {
  const f = await fixture(); let release;
  try {
    await begin(f);
    const blocker = f.room.serial(() => new Promise(resolve => { release = resolve; }));
    await new Promise(resolve => setImmediate(resolve));
    const frames = Array.from({ length: 100 }, (_, n) => f.room.webSocketMessage(f.sockets[0], JSON.stringify({
      type: 'drawing_batch', requestId: `flood-${n}`, matchId: f.room.room.matchId, round: f.room.room.round, ...stroke(n),
    })));
    assert.equal(f.sockets[0].closed?.code, 4429);
    assert.equal(f.room.inboundCount, 64, 'admission is bounded even before storage resumes');
    const other = f.command(1, 'drawing_sync'); release(); await blocker; await Promise.all(frames);
    assert.equal((await other).ok, true); assert.equal(f.sockets[1].readyState, 1);
    assert.equal(f.room.inboundCount, 0); assert.equal(f.room.drawing.seq, 0, 'closed sender queued frames do not create ghost ink');
  } finally { release?.(); f.close(); }
});

test('oversized UTF-8 and binary frames never enter the durable queue', async () => {
  const f = await fixture(); let release;
  try {
    const blocker = f.room.serial(() => new Promise(resolve => { release = resolve; }));
    await new Promise(resolve => setImmediate(resolve));
    for (const [n, message] of ['x'.repeat(4097), 'ع'.repeat(2049), new ArrayBuffer(16)].entries()) {
      await f.room.webSocketMessage(f.sockets[n], message);
      assert.equal(f.sockets[n].closed?.code, 1009);
    }
    assert.equal(f.room.inboundCount, 0); release(); await blocker;
  } finally { release?.(); f.close(); }
});

test('history failure does not expose choices or spend the free start, and retry preserves the room', async () => {
  const f = await fixture({ trial: true }); try {
    f.observed.failHistory = true;
    assert.equal((await f.command(0, 'start')).ok, false); assert.equal(f.room.room.phase, 'lobby');
    assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM trials').first()).n, 0);
    assert.equal(f.sockets.some(s => s.messages.some(m => m.type === 'state' && m.state.myChoices?.length)), false);
    f.observed.failHistory = false; assert.equal((await f.command(0, 'start')).ok, true);
    assert.equal(f.room.room.phase, 'select'); assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM trials').first()).n, 0);
  } finally { f.close(); }
});
test('a persisted word exposure followed by failed DO commit retries the same private choices without trial writes', async () => {
  const f = await fixture({ trial: true }); try {
    f.storage.failRoomOnce = true; assert.equal((await f.command(0, 'start')).ok, false);
    assert.equal(f.room.room.phase, 'lobby');
    const before = (await f.DB.prepare('SELECT concept_id FROM ersomha_seen ORDER BY concept_id').all()).results;
    const pending = await f.storage.get('ersomha:plan'); assert.equal(pending.turns.length, 3);
    assert.equal(new Set(pending.turns.flat().map(card => card.familyId)).size, 9);
    assert.equal(before.length, 3, 'future private plan cards are not marked seen before their turns'); assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM online_room_trial_claims').first()).n, 0);
    assert.equal((await f.command(0, 'start')).ok, true);
    assert.deepEqual(f.room.room.draw.choices.map(c => c.conceptId).sort(), before.map(r => r.concept_id));
    assert.deepEqual(f.room.room.ersomhaPlan, pending.turns, 'the entire private plan is recovered after a failed room write');
    assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM trials').first()).n, 0);
    assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM online_room_trial_claims').first()).n, 0);
  } finally { f.close(); }
});
test('an insufficient fresh pool rejects before exposure/trial; explicit replay prepares the whole match first', async () => {
  for (const difficulty of ['easy', 'medium', 'hard']) {
  const f = await fixture({ trial: true, settings: { difficulty } }); try {
    const pool = getErsomhaPool({ difficulty: f.room.room.settings.difficulty }), categories = [...new Set(pool.map(c => c.category))].slice(0, 3), allowed = new Set();
    for (const category of categories) for (const card of pool.filter(c => c.category === category).slice(0, 2)) allowed.add(card.familyId);
    const hash = await ersomhaAccountHash('account-0');
    await f.DB.batch(pool.filter(c => !allowed.has(c.familyId)).map(c => f.DB.prepare('INSERT OR IGNORE INTO ersomha_seen(account_hash,family_id,concept_id,exposure_id,seen_at) VALUES(?,?,?,?,?)').bind(hash, c.familyId, c.conceptId, 'old:match', 1000)));
    assert.equal((await f.command(0, 'start')).error, 'ERSOMHA_CONTENT_EXHAUSTED');
    assert.equal(f.room.room.phase, 'lobby'); assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM trials').first()).n, 0);
    assert.equal(f.sockets.some(s => s.messages.some(m => m.type === 'state' && m.state.myChoices?.length)), false);
    assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM ersomha_leases WHERE expires_at>?').bind(Date.now()).first()).n, 0, 'a rejected lobby start releases its temporary account locks');
    assert.equal((await f.command(0, 'settings', { settings: { ...f.room.room.settings, allowReplay: true } })).ok, true);
    assert.equal((await f.command(0, 'start')).ok, true); assert.equal(f.room.room.ersomhaPlan.length, 3);
    assert.equal(new Set(f.room.room.ersomhaPlan.flat().map(c => c.familyId)).size, 9);
    assert.ok(f.room.room.ersomhaPlan.flat().every(card => card.difficulty === difficulty));
  } finally { f.close(); }
  }
});
test('a departed participant releases only that account after the leave is durable', async () => {
  const f = await fixture({ count: 4 }); try {
    await begin(f); const previous = structuredClone(f.room.room), candidate = structuredClone(previous);
    const target = candidate.members.find(m => m.id === 'seat-3'); target.left = true; target.connected = false;
    await f.room.serial(() => f.room.commit(candidate));
    assert.equal(f.room.room.ersomhaLease.accounts.length, 3);
    assert.equal((await f.DB.prepare('SELECT expires_at FROM ersomha_leases WHERE account_hash=?').bind(await ersomhaAccountHash('account-3')).first()).expires_at, 0);
    assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM ersomha_leases WHERE expires_at>?').bind(Date.now()).first()).n, 3);
  } finally { f.close(); }
});
test('80 ms drawing cadence uses two fixed authorization reads and no bank/history/stats work, full-state broadcast or room rewrite', async () => {
  const f = await fixture(); const realNow = Date.now; let now = realNow();
  try {
    await begin(f); now = realNow(); Date.now = () => now;
    assert.equal((await f.command(0, 'drawing_sync')).ok, true); // Warm the unchanged-room path.
    f.sockets.forEach(s => { s.messages = []; }); f.storage.writes = []; const reads = f.observed.reads, revision = f.room.room.revision;
    const sqlAt = f.observed.statements.length;
    for (let n = 0; n < 80; n++) { now += 80; assert.equal((await f.command(0, 'drawing_batch', stroke(n))).ok, true); }
    const statements = f.observed.statements.slice(sqlAt);
    const actor = statements.filter(sql => /^SELECT 1 FROM sessions WHERE id=\?/.test(sql));
    const recipients = statements.filter(sql => /^SELECT id,user_id,expires_at,revoked_at FROM sessions WHERE id IN/.test(sql));
    assert.equal(actor.length, 80, 'one live sender read per batch');
    assert.equal(recipients.length, 80, 'one shared recipient read per batch, never per viewer');
    assert.equal(f.observed.reads - reads, 160);
    assert.equal(statements.length, actor.length + recipients.length, 'no bank/history/stats or other SQL enters the steady drawing path');
    assert.equal(statements.some(sql => /^(?:INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql)), false);
    assert.equal(f.room.room.revision, revision);
    assert.equal(f.storage.writes.includes('room'), false);
    for (const socket of f.sockets) {
      assert.equal(socket.messages.filter(m => m.type === 'drawing' && m.kind === 'append').length, 80);
      assert.equal(socket.messages.some(m => m.type === 'state'), false);
      assert.ok(socket.messages.filter(m => m.type === 'drawing').every(m => JSON.stringify(m).length < 4096));
    }
    assert.equal(f.sockets[0].readyState, 1, 'drawing has an independent quota rather than the legacy 35-command window');
  } finally { Date.now = realNow; f.close(); }
});
test('failed delta persistence sends no echo, and reconstructed rooms synchronize undo/redo/clear exactly', async () => {
  const f = await fixture(); try {
    await begin(f); f.sockets.forEach(s => { s.messages = []; }); f.storage.failHeadOnce = true;
    assert.equal((await f.command(0, 'drawing_batch', stroke(1))).ok, false);
    assert.equal(f.room.drawing.seq, 0); assert.equal(f.sockets.some(s => s.messages.some(m => m.type === 'drawing')), false);
    assert.equal((await f.command(0, 'drawing_batch', stroke(1))).ok, true);
    assert.equal((await f.command(1, 'drawing_batch', stroke(2))).error, 'ERSOMHA_DRAWER_ONLY');
    assert.equal((await f.command(0, 'drawing_undo', { epoch: 1 })).ok, true);
    await f.restore(); f.sockets[1].messages = [];
    assert.equal((await f.command(1, 'drawing_sync')).ok, true);
    const synced = f.sockets[1].messages.find(m => m.type === 'drawing' && m.kind === 'sync'); assert.deepEqual(synced.undoneIds, ['stroke-1']);
    assert.equal((await f.command(0, 'drawing_redo', { epoch: 1 })).ok, true);
    assert.equal((await f.command(0, 'drawing_clear', { epoch: 1 })).ok, true);
    await f.restore(); assert.equal(f.room.drawing.epoch, 2); assert.equal(f.room.drawing.strokes.length, 0);
    assert.equal((await f.command(0, 'drawing_batch', stroke(2))).error, 'ERSOMHA_CANVAS_STALE');
  } finally { f.close(); }
});
test('drawing evidence is private to frozen viewers, survives the next turn and contains no word or guess history', async () => {
  const f = await fixture(); try {
    await begin(f); await f.command(0, 'drawing_batch', stroke(1)); const answer = f.room.room.draw.word.answer;
    const request = (id, matchId = 1, round = 1) => new Request('https://room.internal/drawing-evidence', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accountUserId: id, matchId, round }) });
    const denied = await f.room.fetch(request('account-outsider')); assert.equal(denied.status, 404);
    const response = await f.room.fetch(request('account-1')), evidence = await response.json();
    assert.equal(response.status, 200); assert.equal(evidence.drawerUserId, 'account-0'); assert.equal(evidence.canvas.strokes.length, 1);
    const serialized = JSON.stringify(evidence); assert.equal(serialized.includes(answer), false);
    for (const key of ['myWord', 'choices', 'aliases', 'guesses', 'viewers']) assert.equal(serialized.includes(key), false);
    await f.command(1, 'guess', { text: answer }); await f.command(2, 'guess', { text: answer });
    const candidate = structuredClone(f.room.room); action(candidate, candidate.hostId, { type: 'next', matchId: 1, round: 1 }, candidate.deadlineAt);
    await f.room.serial(() => f.room.commit(candidate));
    assert.equal(f.room.room.round, 2); assert.equal(f.room.drawing.strokes.length, 0);
    await f.restore(); assert.equal((await f.room.fetch(request('account-1'))).status, 200);
    f.room.room.members.find(m => m.accountUserId === 'account-1').left = true;
    assert.equal((await f.room.fetch(request('account-1'))).status, 200, 'former witnesses can still report a retained turn');
  } finally { f.close(); }
});
test('a transient next-turn history outage re-arms recovery and never publishes an uncommitted choice', async () => {
  const f = await fixture(); try {
    await begin(f); const answer = f.room.room.draw.word.answer;
    await f.command(1, 'guess', { text: answer }); await f.command(2, 'guess', { text: answer });
    f.room.room.deadlineAt = Date.now() - 1; f.observed.failHistory = true; f.sockets.forEach(s => { s.messages = []; });
    await f.room.alarm(); assert.equal(f.room.room.phase, 'result'); assert.equal(f.room.room.round, 1);
    assert.ok(f.storage.alarm > Date.now() + 4000); assert.equal(f.sockets.some(s => s.messages.some(m => m.type === 'state' && m.state.round === 2)), false);
    f.observed.failHistory = false; await f.room.alarm(); assert.equal(f.room.room.phase, 'select'); assert.equal(f.room.room.round, 2);
  } finally { f.close(); }
});
test('a fenced-out room ends without claiming another owner lease or publishing later private words', async () => {
  const f = await fixture(); try {
    await begin(f);
    await f.DB.prepare("UPDATE ersomha_leases SET room_key='other-room',lease_token='other-token',fence=fence+1").run();
    f.room.room.ersomhaLease.renewAt = Date.now() - 1;
    await f.room.alarm(); assert.equal(f.room.room.phase, 'over'); assert.equal(f.room.room.reason, 'account_active_elsewhere');
    assert.equal(f.room.room.history.length, 0);
    assert.equal((await f.DB.prepare("SELECT COUNT(*) AS n FROM ersomha_leases WHERE room_key='other-room' AND expires_at>?").bind(Date.now()).first()).n, 3);
  } finally { f.close(); }
});
test('HTTP leave can close a fenced-out room before its alarm without releasing the new room lease', async () => {
  const f = await fixture(); try {
    const credentials = [];
    for (let n = 0; n < f.room.room.members.length; n++) {
      const id = String(n + 1).repeat(32), token = String(n + 4).repeat(64);
      f.room.room.members[n].id = id; f.room.room.members[n].tokenHash = await sha256(token);
      f.sockets[n].a.id = id; credentials.push({ id, token });
    }
    f.room.room.hostId = credentials[0].id;
    await begin(f);
    await f.DB.prepare("UPDATE ersomha_leases SET room_key='new-room',lease_token='new-token',fence=fence+1").run();
    f.room.room.ersomhaLease.renewAt = Date.now() - 1;
    f.sockets.forEach(socket => { socket.messages = []; });
    for (const credential of credentials) {
      const response = await f.room.fetch(new Request('https://room.internal/123456/leave', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(credential),
      }));
      assert.equal(response.status, 200, JSON.stringify(await response.json()));
    }
    assert.equal(f.room.room, null, 'HTTP cleanup closes the original room without relying on an alarm');
    assert.equal(await f.storage.get('room'), undefined);
    assert.equal((await f.DB.prepare("SELECT COUNT(*) AS n FROM ersomha_leases WHERE room_key='new-room' AND lease_token='new-token' AND expires_at>?").bind(Date.now()).first()).n, 3);
    assert.equal((await f.DB.prepare("SELECT COUNT(*) AS n FROM player_events WHERE game='ersomha'").first()).n, 0, 'an interrupted match earns no completed result');
    assert.equal(f.sockets.some(socket => socket.messages.some(message => message.state?.round > 1)), false, 'no future turn is exposed during cleanup');
  } finally { f.close(); }
});
