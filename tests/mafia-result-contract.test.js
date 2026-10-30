import test from 'node:test';
import assert from 'node:assert/strict';
import * as mafia from '../server/mafia-model.mjs';
import { bindSeatAccount, prepareRoomStats } from '../server/room-stats.mjs';
import { prepareMafiaResult, persistMafiaResult } from '../server/mafia-results.mjs';
import { mafiaProgressEnabled } from '../server/mafia-progression.mjs';
import { createLocalD1 } from '../server/local-d1.mjs';
import { Room } from '../server/room.mjs';
import { errorResponse } from '../server/protocol.mjs';

const NOW = 1_800_000_000_000;
const person = n => ({ id: `seat-${n}`, tokenHash: `token-${n}`, name: `لاعب ${n}`, avatar: n % 4 });
function started({ enabled = false, protocol = 2 } = {}) {
  const room = mafia.createRoom('ABC123', { ...person(0), settings: { mode: 'classic', capacity: 8, visibility: 'public', voiceMode: 'off' } }, NOW);
  for (let n = 1; n < 6; n++) mafia.joinRoom(room, person(n), NOW);
  for (let n = 0; n < 6; n++) {
    bindSeatAccount(room, `seat-${n}`, `account-${n}`); mafia.connected(room, `seat-${n}`, true, NOW);
    mafia.action(room, `seat-${n}`, { type: 'ready', ready: true, matchId: room.matchId, phaseId: room.phaseId }, NOW);
  }
  const previous = structuredClone(room);
  let random = 12;
  mafia.action(room, 'seat-0', { type: 'start', matchId: room.matchId, phaseId: room.phaseId }, NOW, { randomWord: () => (random = (Math.imul(random, 1664525) + 1013904223) >>> 0) });
  Object.assign(room, { mafiaKey: 'mafia-room-identity', protocol });
  assert.deepEqual(prepareRoomStats(previous, room, NOW, { mafiaProgressEnabled: enabled }), []);
  return room;
}
function finished(room) {
  const over = structuredClone(room);
  Object.assign(over, { phase: 'over', phaseId: room.phaseId + 1, outcome: { faction: 'town', endedAt: NOW + 1_000, reason: 'faction' }, winners: room.participants.filter(id => room.roleStates[id].faction === 'town') });
  return over;
}
const count = async (env, table) => (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n;

test('progression is off by default and policy v1 is issued only by an enabled start transition', () => {
  for (const value of [undefined, null, '', '0', 'true', true, '01', 2]) {
    assert.equal(mafiaProgressEnabled({ MAFIA_PROGRESS_ENABLED: value }), false, String(value));
    assert.equal(started({ enabled: mafiaProgressEnabled({ MAFIA_PROGRESS_ENABLED: value }) }).statsMatch.rewardPolicyVersion, undefined);
  }
  for (const value of ['1', 1]) {
    assert.equal(mafiaProgressEnabled({ MAFIA_PROGRESS_ENABLED: value }), true);
    assert.equal(started({ enabled: true }).statsMatch.rewardPolicyVersion, 1);
  }
  assert.equal(started({ enabled: true, protocol: 1 }).statsMatch.rewardPolicyVersion, undefined, 'legacy protocol never receives a new reward policy');
  const old = started(), over = finished(old);
  prepareRoomStats(old, over, NOW + 90_000, { mafiaProgressEnabled: true });
  assert.equal(over.statsMatch.rewardPolicyVersion, undefined, 'enabling halfway through a match cannot issue its policy');
  assert.equal(prepareMafiaResult(over, NOW + 90_000).rewardPolicyVersion, null);
});

test('one completed event carries the frozen account mapping and identical profile facts', () => {
  const room = started({ enabled: true }), over = finished(room), completedAt = NOW + 100_000;
  over.members[0].left = true; over.members[0].accountUserId = 'replacement-account';
  over.roleStates['seat-0'].forfeited = true;
  over.chats.public = [{ text: 'PRIVATE_OR_CHAT_SENTINEL', recipients: [], viewIds: {} }]; over.chats.mafia = [{ text: 'SECRET_TEAM_SENTINEL', recipients: [], viewIds: {} }];
  const event = prepareMafiaResult(over, completedAt);
  const profiles = prepareRoomStats(room, over, completedAt + 200, { mafiaResult: event });
  assert.equal(event.eventSchemaVersion, 1); assert.equal(event.eventKind, 'match_completed');
  assert.equal(event.source, 'live'); assert.equal(event.rewardPolicyVersion, 1);
  assert.equal(event.key, 'mafia-room-identity:1'); assert.equal(event.eventId, room.statsMatch.eventId);
  assert.equal(event.startedAt, NOW); assert.equal(event.finishedAt, completedAt);
  assert.equal(event.notBefore, completedAt + 30_000, 'use END commit time even when outcome.endedAt is older');
  assert.equal(event.mode, 'classic'); assert.equal(event.visibility, 'public');
  assert.equal(event.capacity, 8); assert.equal(event.participantCount, 6);
  assert.equal(event.results.find(result => result.playerId === 'seat-0').userId, 'account-0');
  for (const profile of profiles) {
    const result = event.results.find(result => result.userId === profile.userId);
    assert.equal(profile.eventId, event.eventId); assert.equal(profile.finishedAt, event.finishedAt);
    assert.equal(profile.notBefore, event.notBefore); assert.equal(profile.draw, event.draw); assert.equal(profile.won, result.won);
  }
  const summary = JSON.parse(event.summary);
  assert.equal(summary.eventSchemaVersion, 1); assert.equal(summary.rewardPolicyVersion, 1);
  assert.equal(summary.eventKind, 'match_completed'); assert.equal(summary.source, 'live');
  assert.doesNotMatch(event.summary, /account-|replacement-account|SENTINEL|tokenHash|statsMatch/);
  assert.deepEqual(prepareRoomStats(over, structuredClone(over), completedAt + 1), []);
  for (const id of over.participants.filter(id => !over.members.find(member => member.id === id).left)) assert.doesNotMatch(JSON.stringify(mafia.snapshot(over, id, completedAt)), /account-|replacement-account|rewardPolicyVersion|statsMatch|online:/);
});

test('a frozen missing account never falls back to an account attached after start', () => {
  const room = started({ enabled: true }), over = finished(room);
  over.statsMatch.accounts['seat-0'] = null;
  over.members[0].accountUserId = 'new-after-start';
  const event = prepareMafiaResult(over, NOW + 40_000);
  assert.equal(event.results.length, 5);
  assert.ok(!event.results.some(result => result.userId === 'new-after-start'));
  const profiles = prepareRoomStats(room, over, NOW + 40_000, { mafiaResult: event });
  assert.equal(profiles.length, 5);
});

test('pre-marker and pre-policy matches archive as legacy without inventing progression eligibility', () => {
  const room = started(), over = finished(room);
  const event = prepareMafiaResult(over, NOW + 20_000);
  assert.equal(event.rewardPolicyVersion, null); assert.equal(JSON.parse(event.summary).rewardPolicyVersion, null);
  delete over.statsMatch;
  const legacy = prepareMafiaResult(over, NOW + 20_000);
  assert.equal(legacy.rewardPolicyVersion, null); assert.equal(legacy.eventId, null);
  assert.equal(legacy.results.length, 6, 'keep pre-marker archive compatibility');
  assert.deepEqual(prepareRoomStats(room, over, NOW + 20_000, { mafiaProgressEnabled: true }), []);
  const v1 = prepareMafiaResult(finished(started({ protocol: 1 })), NOW + 20_000);
  assert.equal(v1.notBefore, undefined, 'legacy protocol timing stays compatible');
});

test('an unknown saved policy is preserved for consumer rejection rather than acknowledged as legacy', () => {
  const room = finished(started({ enabled: true })); room.statsMatch.rewardPolicyVersion = 2;
  const event = prepareMafiaResult(room, NOW + 40_000);
  assert.equal(event.rewardPolicyVersion, 2); assert.equal(JSON.parse(event.summary).rewardPolicyVersion, 2);
});

test('technical abort has no completed event while an actual finish over text does', () => {
  const room = started({ enabled: true }), over = finished(room);
  over.mafiaMedia = { failed: true };
  assert.equal(prepareMafiaResult(over, NOW + 20_000).eventKind, 'match_completed');
  over.technicalAbort = true;
  assert.equal(prepareMafiaResult(over, NOW + 20_000), null);
  assert.deepEqual(prepareRoomStats(room, over, NOW + 20_000), []);
  assert.equal(prepareMafiaResult(room), null);
});

test('archive persistence is delayed, idempotent and refuses incomplete participant identities', async t => {
  const env = { DB: createLocalD1() }; t.after(() => env.DB.close());
  const room = started({ enabled: true }), event = prepareMafiaResult(finished(room), NOW + 40_000);
  for (let n = 0; n < 6; n++) await env.DB.prepare('INSERT INTO users(id,name,created_at,updated_at) VALUES(?,?,?,?)').bind(`account-${n}`, `لاعب ${n}`, NOW, NOW).run();
  t.mock.method(Date, 'now', () => event.notBefore - 1);
  await persistMafiaResult(env, event); assert.equal(await count(env, 'mafia_history'), 0); assert.equal(await count(env, 'mafia_results'), 0);
  t.mock.method(Date, 'now', () => event.notBefore);
  await persistMafiaResult(env, event); await persistMafiaResult(env, structuredClone(event));
  assert.equal(await count(env, 'mafia_history'), 1); assert.equal(await count(env, 'mafia_results'), 6);
  await persistMafiaResult(env, { ...event, key: 'missing-identity', results: event.results.slice(1) });
  assert.equal(await count(env, 'mafia_history'), 1, 'cannot archive a reveal when one participant has no known account');
});

class Storage {
  constructor(event) { this.data = new Map(event ? [['mafiaResultOutbox', [structuredClone(event)]]] : []); this.alarm = null; this.failDrain = false; }
  async get(key) { return structuredClone(this.data.get(key)); }
  async put(key, value) { if (this.failDrain && key === 'mafiaResultOutbox' && !value.length) throw new Error('injected durable drain outage'); this.data.set(key, structuredClone(value)); }
  async setAlarm(value) { this.alarm = value; }
  async deleteAlarm() { this.alarm = null; }
  async delete(key) { this.data.delete(key); }
  async transaction(fn) { const before = new Map(this.data); try { return await fn(this); } catch (error) { this.data = before; throw error; } }
}
const instantiate = (storage, env) => new Room({ storage, blockConcurrencyWhile: fn => fn(), getWebSockets: () => [] }, env);
async function outboxFixture(t) {
  const DB = createLocalD1(); t.after(() => DB.close());
  const env = { DB, MAFIA_PROGRESS_ENABLED: '1' };
  const room = started({ enabled: true }), event = prepareMafiaResult(finished(room), NOW + 200_000);
  for (let n = 0; n < 6; n++) await DB.prepare('INSERT INTO users(id,name,created_at,updated_at) VALUES(?,?,?,?)').bind(`account-${n}`, `لاعب ${n}`, NOW, NOW).run();
  const storage = new Storage(event), instance = instantiate(storage, env); await instance.ready;
  return { DB, env, event, storage, instance };
}

test('Room commit passes the actual environment gate and durably queues one shared END envelope', async t => {
  const DB = createLocalD1(); t.after(() => DB.close()); t.mock.method(Date, 'now', () => NOW + 100);
  const env = { DB, MAFIA_PROGRESS_ENABLED: '1' }, candidate = started(); delete candidate.statsMatch;
  const previous = { ...structuredClone(candidate), phase: 'lobby', matchId: 0, participants: [], roleStates: {} };
  const storage = new Storage(); await storage.put('room', previous);
  const instance = instantiate(storage, env); await instance.ready;
  // The provider and directory are outside this contract test; state and both
  // outboxes still pass through the real Room commit/storage transaction.
  instance.settleMafiaMetadata = async () => {}; instance.broadcast = () => {};
  await instance.serial(() => instance.commit(candidate, { prepared: true }));
  assert.equal(instance.room.statsMatch.rewardPolicyVersion, 1);
  assert.equal((await storage.get('room')).statsMatch.rewardPolicyVersion, 1);
  const over = finished(instance.room);
  t.mock.method(Date, 'now', () => NOW + 200_000);
  await instance.serial(() => instance.commit(over, { prepared: true }));
  await instance.flushingStats;
  const event = (await storage.get('mafiaResultOutbox'))[0], profiles = await storage.get('profileOutbox');
  assert.equal(event.rewardPolicyVersion, 1); assert.equal(event.eventId, over.statsMatch.eventId);
  assert.equal(event.finishedAt, NOW + 200_000); assert.equal(event.notBefore, NOW + 230_000);
  assert.equal(profiles.length, 6);
  assert.ok(profiles.every(profile => profile.eventId === event.eventId && profile.finishedAt === event.finishedAt && profile.notBefore === event.notBefore));
  assert.equal(await count(env, 'mafia_history'), 0); assert.equal(await count(env, 'mafia_progress_events'), 0);
});

test('an enabled match keeps its outbox if progression is disabled before completion; archive retry still grants once', async t => {
  const f = await outboxFixture(t);
  t.mock.method(Date, 'now', () => f.event.notBefore - 1);
  await f.instance.serial(() => f.instance.flushMafiaResults());
  assert.equal(await count(f.env, 'mafia_history'), 0); assert.equal(await count(f.env, 'mafia_progress_events'), 0);
  t.mock.method(Date, 'now', () => f.event.notBefore);
  delete f.env.MAFIA_PROGRESS_ENABLED;
  await f.instance.serial(() => f.instance.flushMafiaResults());
  assert.equal(await count(f.env, 'mafia_history'), 1);
  assert.equal(await count(f.env, 'mafia_progress_events'), 0);
  const failed=(await f.storage.get('mafiaResultOutbox'))[0];
  assert.deepEqual(failed.lastFailure,{code:'MAFIA_PROGRESS_DISABLED',attempts:1,at:f.event.notBefore});
  assert.ok(f.storage.alarm > f.event.notBefore);
  f.env.MAFIA_PROGRESS_ENABLED = '1';
  await f.instance.serial(() => f.instance.flushMafiaResults());
  assert.equal(await count(f.env, 'mafia_history'), 1, 'an existing archive does not suppress the progression consumer');
  assert.equal(await count(f.env, 'mafia_results'), 6); assert.equal(await count(f.env, 'mafia_progress_events'), 6);
  assert.equal(await count(f.env, 'mafia_player_progress'), 6); assert.equal(f.instance.mafiaResultOutbox.length, 0);
  assert.equal((await f.storage.get('mafiaResultOutbox')).length, 0);
});

test('outbox diagnostics allow only a safe code, capped attempts and time; recovery removes them without secret logging', async t => {
  const f=await outboxFixture(t),secret='RAW_SECRET_ROLE_CHAT_SQL_DO_NOT_LOG';
  t.mock.method(Date,'now',()=>f.event.notBefore);
  const logs=[];
  t.mock.method(console,'error',(...args)=>logs.push(args)); t.mock.method(console,'warn',(...args)=>logs.push(args));
  f.instance.mafiaResultOutbox[0].lastFailure={code:'MAFIA_RESULT_RETRY',attempts:254,at:f.event.notBefore-1};
  await f.storage.put('mafiaResultOutbox',f.instance.mafiaResultOutbox);
  const error=Object.assign(new Error(secret),{code:secret});
  const injected=t.mock.method(f.DB,'batch',async()=>{throw error;});
  for(let n=0;n<2;n++) {
    await f.instance.serial(()=>f.instance.flushMafiaResults());
    const diagnostic=(await f.storage.get('mafiaResultOutbox'))[0].lastFailure;
    assert.deepEqual(diagnostic,{code:'MAFIA_RESULT_RETRY',attempts:255,at:f.event.notBefore});
    assert.doesNotMatch(JSON.stringify(diagnostic),/RAW_SECRET|account-|roleId|chat/);
  }
  assert.ok(!JSON.stringify(logs).includes(secret));
  injected.mock.restore();
  await f.instance.serial(()=>f.instance.flushMafiaResults());
  assert.equal(f.instance.mafiaResultOutbox.length,0);
  assert.deepEqual(await f.storage.get('mafiaResultOutbox'),[],'successful recovery removes lastFailure with the event');
  assert.equal(await count(f.env,'mafia_progress_events'),6);
});

test('progression D1 failure after archive success survives reconstruction and retries the same event', async t => {
  const f = await outboxFixture(t); t.mock.method(Date, 'now', () => f.event.notBefore);
  let failProgress = true;
  f.env.DB = { prepare: f.DB.prepare.bind(f.DB), batch: async statements => {
    if (failProgress && statements.some(statement => statement.sql.includes('INSERT INTO mafia_progress_events'))) throw new Error('injected progression D1 outage');
    return f.DB.batch(statements);
  } };
  await f.instance.serial(() => f.instance.flushMafiaResults());
  assert.equal(await count(f.env, 'mafia_history'), 1); assert.equal(await count(f.env, 'mafia_progress_events'), 0);
  const queued = (await f.storage.get('mafiaResultOutbox'))[0];
  assert.equal(queued.key, f.event.key); assert.equal(queued.eventId, f.event.eventId); assert.equal(queued.notBefore, f.event.notBefore);
  failProgress = false;
  const restored = instantiate(f.storage, f.env); await restored.ready;
  await restored.serial(() => restored.flushMafiaResults());
  assert.equal(await count(f.env, 'mafia_progress_events'), 6); assert.equal(await count(f.env, 'mafia_history'), 1);
  assert.equal(restored.mafiaResultOutbox.length, 0);
});

test('D1 success followed by durable outbox drain failure cannot duplicate a grant on reconstruction', async t => {
  const f = await outboxFixture(t); t.mock.method(Date, 'now', () => f.event.notBefore);
  f.storage.failDrain = true;
  await assert.rejects(f.instance.serial(() => f.instance.flushMafiaResults()), {code:'MAFIA_RESULT_RETRY'});
  assert.equal(await count(f.env, 'mafia_progress_events'), 6);
  const totalBefore = await f.DB.prepare('SELECT SUM(total_xp) AS xp FROM mafia_player_progress').first();
  assert.ok(totalBefore.xp > 0); assert.equal((await f.storage.get('mafiaResultOutbox')).length, 1);
  f.storage.failDrain = false;
  const restored = instantiate(f.storage, f.env); await restored.ready;
  await restored.serial(() => restored.flushMafiaResults());
  assert.deepEqual(await f.DB.prepare('SELECT SUM(total_xp) AS xp FROM mafia_player_progress').first(), totalBefore);
  assert.equal(await count(f.env, 'mafia_progress_events'), 6); assert.equal(restored.mafiaResultOutbox.length, 0);
});

test('durable storage errors are sanitized before the generic HTTP error logger can receive them', async t => {
  const f=await outboxFixture(t),secret='PRIVATE_STORAGE_ROLE_CHAT_SECRET'; t.mock.method(Date,'now',()=>f.event.notBefore);
  const logs=[]; t.mock.method(console,'error',(...args)=>logs.push(args));
  const put=f.storage.put.bind(f.storage);
  t.mock.method(f.storage,'put',async(key,value)=>{if(key==='mafiaResultOutbox'&&!value.length)throw new Error(secret);return put(key,value);});
  let caught;
  try {await f.instance.serial(()=>f.instance.flushMafiaResults());} catch(error) {caught=error;}
  assert.equal(caught?.code,'MAFIA_RESULT_RETRY');
  const response=errorResponse(caught);
  assert.equal(response.status,503); assert.deepEqual(await response.json(),{error:'MAFIA_RESULT_RETRY'});
  assert.ok(!JSON.stringify(logs).includes(secret)); assert.doesNotMatch(JSON.stringify(caught),/PRIVATE_STORAGE/);
  assert.deepEqual((await f.storage.get('mafiaResultOutbox'))[0].lastFailure,{code:'MAFIA_RESULT_RETRY',attempts:1,at:f.event.notBefore});
});
