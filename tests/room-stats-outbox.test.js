import test from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../server/room.mjs';
import { createLocalD1 } from '../server/local-d1.mjs';
import { createRoom, joinRoom } from '../server/game-model.mjs';
import { bindSeatAccount, prepareRoomStats } from '../server/room-stats.mjs';

class Storage {
  constructor() { this.data = new Map(); this.alarm = null; this.failDelete = false; }
  async get(k) { return structuredClone(this.data.get(k)); }
  async put(k,v) { this.data.set(k,structuredClone(v)); }
  async delete(k) { if (this.failDelete && k === 'profileOutbox') throw new Error('DO storage temporarily unavailable'); this.data.delete(k); }
  async deleteAll() { this.data.clear(); }
  async setAlarm(value) { this.alarm = value; }
  async deleteAlarm() { this.alarm = null; }
  async transaction(fn) { const before = new Map(this.data); try { return await fn(this); } catch(e) { this.data = before; throw e; } }
}
function instantiate(storage, env) {
  return new Room({ storage, blockConcurrencyWhile: fn => fn(), getWebSockets: () => [] },env);
}
async function fixture() {
  const DB = createLocalD1(); const env = { DB }; const now = Date.now(); const storage = new Storage();
  await DB.prepare('INSERT INTO users(id,name,created_at,updated_at) VALUES(?,?,?,?)').bind('account-a','أحمد',now,now).run();
  const input = n => ({id:`seat-${n}`,tokenHash:`token-${n}`,name:`لاعب ${n}`,avatar:n,rounds:5});
  const lobby = createRoom('123456',input(0),now);
  for(let n=1;n<3;n++) joinRoom(lobby,input(n),now);
  bindSeatAccount(lobby,'seat-0','account-a');
  const previous = { ...structuredClone(lobby),phase:'vote',round:1,matchId:1,participants:lobby.members.map(m=>m.id),scores:{} };
  prepareRoomStats(lobby,previous,now); previous.phase='result'; previous.round=5;
  await storage.put('room',previous);
  const room = instantiate(storage,env); await room.ready;
  return { DB,env,storage,room,over:{...structuredClone(previous),phase:'over'} };
}

test('a failed database write retains the event through room expiry and object reconstruction', async () => {
  const { DB,env,storage,room,over } = await fixture();
  try {
    env.DB = { prepare: () => { throw new Error('D1 temporarily unavailable'); } };
    await room.serial(()=>room.commit(over)); await room.flushStats();
    assert.equal(room.profileOutbox.length,1); assert.ok(storage.alarm > Date.now());
    room.room.expiresAt=Date.now()-1;
    await room.serial(()=>room.advance());
    assert.equal(room.room,null); assert.equal((await storage.get('profileOutbox')).length,1);
    env.DB=DB;
    const restored=instantiate(storage,env); await restored.alarm();
    assert.equal(await storage.get('profileOutbox'),undefined); assert.equal(storage.alarm,null);
    assert.deepEqual(await DB.prepare('SELECT online_matches,online_wins,online_draws FROM player_stats WHERE user_id=?').bind('account-a').first(),
      {online_matches:1,online_wins:0,online_draws:0});
  } finally { DB.close(); }
});

test('D1 success followed by a DO write failure retries safely without double counting', async () => {
  const { DB,storage,room,over } = await fixture();
  try {
    storage.failDelete=true;
    await room.serial(()=>room.commit(over)); await assert.rejects(room.flushStats(),/temporarily unavailable/);
    assert.equal(room.profileOutbox.length,1);
    assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM player_events').first()).n,1);
    storage.failDelete=false; await room.alarm();
    assert.equal(room.profileOutbox.length,0);
    assert.equal((await DB.prepare('SELECT online_matches FROM player_stats').first()).online_matches,1);
    assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM player_events').first()).n,1);
  } finally { DB.close(); }
});

test('account deletion while an event is queued discards the event without recreating a profile', async () => {
  const { DB,env,storage,room,over } = await fixture();
  try {
    env.DB=null; await room.serial(()=>room.commit(over)); await room.flushStats();
    await DB.prepare('DELETE FROM users WHERE id=?').bind('account-a').run();
    env.DB=DB; await room.alarm();
    assert.equal(room.profileOutbox.length,0); assert.equal(await storage.get('profileOutbox'),undefined);
    assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM player_profiles').first()).n,0);
    assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM player_events').first()).n,0);
  } finally { DB.close(); }
});

test('a hanging database write does not hold the room command queue or lose a newer queued match', async () => {
  const { DB,env,room,over } = await fixture(); let release;
  const gate=new Promise(resolve=>{release=resolve;});
  env.DB={ prepare:sql=>{
    const statement=DB.prepare(sql); const bind=statement.bind.bind(statement);
    statement.bind=(...args)=>{
      const bound=bind(...args); const first=bound.first.bind(bound);
      bound.first=async(...values)=>{await gate;return first(...values);}; return bound;
    };return statement;
  }, batch:items=>DB.batch(items) };
  try {
    await room.serial(()=>room.commit(over));
    let handled=false;
    const command=room.serial(async()=>{
      handled=true;
      const next={...room.profileOutbox[0],eventId:'online:next-match'};
      room.profileOutbox.push(next); await room.ctx.storage.put('profileOutbox',room.profileOutbox);
    });
    await Promise.race([command,new Promise(resolve=>setTimeout(resolve,100))]);
    assert.equal(handled,true,'game commands must proceed while D1 is waiting');
    release(); await room.flushStats();
    assert.equal(room.profileOutbox.length,0);
    assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM player_events').first()).n,2);
  } finally { release(); await room.flushStats().catch(()=>{}); DB.close(); }
});

test('a malformed result is dropped instead of blocking every later event, and a missing database never re-arms the alarm', async () => {
  const { DB,env,storage,room,over } = await fixture();
  try {
    const now = Date.now();
    await storage.put('profileOutbox', [
      { userId: 'account-a', eventId: 'online:broken', game: 'meenfina', won: 'yes', draw: false, finishedAt: now },
      { userId: 'account-a', eventId: 'online:good', game: 'fabraka', won: true, draw: false, finishedAt: now },
    ]);
    const restored = instantiate(storage, env); await restored.ready;
    await restored.flushStats();
    assert.equal(restored.profileOutbox.length, 0, 'the invalid head is dropped and the valid event behind it is recorded');
    assert.deepEqual(await DB.prepare('SELECT online_matches,online_wins FROM player_stats WHERE user_id=?').bind('account-a').first(), { online_matches: 1, online_wins: 1 });
    // Transient failures count attempts on the retained event.
    env.DB = { prepare: () => { throw new Error('D1 down'); } };
    await room.serial(() => room.commit(over)); await room.flushStats();
    assert.equal(room.profileOutbox[0].attempts, 1);
    // Without a database binding there is nothing to drain: the retained event adds no
    // half-minute alarm, and once the room itself is gone no alarm is armed at all.
    const silent = instantiate(storage, {}); await silent.ready;
    await silent.serial(() => silent.schedule());
    assert.ok(storage.alarm > Date.now() + 60_000, 'only the room\'s own deadline remains');
    await storage.delete('room');
    const empty = instantiate(storage, {}); await empty.ready;
    assert.equal(empty.profileOutbox.length, 1);
    await empty.serial(() => empty.schedule());
    assert.equal(storage.alarm, null);
  } finally { DB.close(); }
});
