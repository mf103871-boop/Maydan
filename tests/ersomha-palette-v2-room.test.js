import test from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../server/room.mjs';
import { createLocalD1 } from '../server/local-d1.mjs';
import { createRoom, joinRoom, connected, action } from '../server/game-model.mjs';
import { bindSeatAccount } from '../server/room-stats.mjs';
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
async function fixture({ count = 3, trial = false, settings = {}, enabled = false } = {}) {
  const DB = createLocalD1(), now = Date.now(), storage = new Storage(), profiles = [], sessions = [];
  const observed = { reads: 0, statements: [], failHistory: false };
  const env = { ERSOMHA_PALETTE_V2_ENABLED: enabled ? '1' : '0', DB: {
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


for(const enabled of [false,true])test(`Room flag${Number(enabled)} pins palette, ACK/sync/archive and preserves old clients without changing admission`,async()=>{
 const f=await fixture({enabled});try{
 await begin(f);const version=enabled?2:1;
 assert.deepEqual(f.room.stateFor('seat-0').capabilities.ersomhaPaletteVersions,[1,2]);
 assert.equal(f.room.stateFor('seat-0').protocol,1);assert.equal(f.room.stateFor('seat-0').drawing.paletteVersion,version);
 assert.equal((await f.command(0,'drawing_batch',stroke(0,{color:'#9250bd'}))).ok,true,'legacy command has no capability/version field');
 const lavender=await f.command(0,'drawing_batch',stroke(1,{color:'#efd3fa',paletteVersion:version}));
 assert.equal(lavender.ok,enabled);if(enabled)assert.equal(lavender.drawing.paletteVersion,2);else assert.equal(lavender.error,'INVALID');
 assert.equal((await f.command(0,'drawing_batch',stroke(2,{paletteVersion:99}))).error,'ERSOMHA_PALETTE_UNSUPPORTED');
 assert.equal((await f.command(1,'drawing_batch',stroke(3))).error,'ERSOMHA_DRAWER_ONLY');
 f.env.ERSOMHA_PALETTE_V2_ENABLED=enabled?'0':'1';await f.restore();
 assert.equal(f.room.drawing.paletteVersion,version,'flag changes do not migrate durable boards');
 assert.equal((await f.command(0,'drawing_clear',{epoch:1,paletteVersion:version})).drawing.paletteVersion,version);
 await f.restore();assert.equal(f.room.drawing.paletteVersion,version);
 assert.equal((await f.command(0,'drawing_batch',stroke(4,{epoch:2,color:'#9250bd'}))).ok,true);
 f.sockets[1].messages=[];const ack=await f.command(1,'drawing_sync');assert.equal(ack.drawing.paletteVersion,version);
 const sync=f.sockets[1].messages.filter(m=>m.type==='drawing');assert.ok(sync.length);assert.ok(sync.every(m=>m.paletteVersion===version));assert.equal(sync[0].ops[0].color,'#9250bd');
 const answer=f.room.room.draw.word.answer;await f.command(1,'guess',{text:answer});await f.command(2,'guess',{text:answer});
 const candidate=structuredClone(f.room.room);action(candidate,candidate.hostId,{type:'next',matchId:1,round:1},candidate.deadlineAt);await f.room.serial(()=>f.room.commit(candidate));
 assert.equal(f.room.drawing.paletteVersion,enabled?1:2,'only a new board observes the changed flag');
 const res=await f.room.fetch(new Request('https://room.internal/drawing-evidence',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({accountUserId:'account-1',matchId:1,round:1})}));
 assert.equal(res.status,200);const evidence=await res.json();assert.equal(evidence.canvas.paletteVersion,version);assert.equal(evidence.canvas.strokes[0].color,'#9250bd');assert.equal(JSON.stringify(evidence).includes(answer),false);
 }finally{f.close();}
});
