import test from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../server/room.mjs';
import * as mafia from '../server/mafia-model.mjs';
import { createLocalD1 } from '../server/local-d1.mjs';
import { bindSeatAccount } from '../server/room-stats.mjs';

class Storage {
  constructor(room) { this.data = new Map([['room', structuredClone(room)]]); }
  async get(key) { return structuredClone(this.data.get(key)); }
  async put(key, value) { this.data.set(key, structuredClone(value)); }
  async delete(key) { this.data.delete(key); }
  async setAlarm(at) { this.alarm = at; }
  async deleteAlarm() { this.alarm = null; }
  async transaction(fn) {
    const data = structuredClone(this.data), alarm = this.alarm;
    try { return await fn(this); } catch (error) { this.data = data; this.alarm = alarm; throw error; }
  }
}
async function fixture(t) {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const DB = createLocalD1(); t.after(() => DB.close());
  const person = n => ({ id: `audit-seat-${n}`, tokenHash: `hash-${n}`, name: `لاعب ${n}`, avatar: n % 4 });
  const room = mafia.createRoom('123456', { ...person(0), settings: { mode: 'classic', capacity: 6, visibility: 'public', voiceMode: 'off' } }, now);
  for (let n = 1; n < 6; n++) mafia.joinRoom(room, person(n), now);
  for (let n = 0; n < 6; n++) {
    bindSeatAccount(room, `audit-seat-${n}`, `audit-account-${n}`);
    mafia.connected(room, `audit-seat-${n}`, true, now);
    mafia.action(room, `audit-seat-${n}`, { type: 'ready', ready: true, matchId: room.matchId, phaseId: room.phaseId }, now);
  }
  let random = 3;
  mafia.action(room, room.hostId, { type: 'start', matchId: room.matchId, phaseId: room.phaseId }, now,
    { randomWord: () => random = (Math.imul(random, 1664525) + 1013904223) >>> 0 });
  now = room.deadlineAt; mafia.tick(room, now);
  room.mafiaKey = 'audit-directory-room'; room.mafiaRenewAt = now + 3600000;
  const failures = { directory: true, attempts: 0, security: false };
  const env = { DB: {
    prepare(sql) {
      if (failures.directory && /mafia_public_rooms/.test(sql)) { failures.attempts++; throw new Error('advisory directory unavailable'); }
      if (failures.security && /mafia_seats/.test(sql)) throw new Error('security seat cleanup unavailable');
      return DB.prepare(sql);
    },
    batch: statements => DB.batch(statements),
  } };
  const storage = new Storage(room);
  const sockets = room.members.map(m => ({ readyState: 1, deserializeAttachment: () => ({ id: m.id, seenAt: now }), serializeAttachment() {}, send() {}, close() {} }));
  const instance = new Room({ storage, blockConcurrencyWhile: fn => fn(), getWebSockets: () => sockets }, env);
  await instance.ready;
  // Test a candidate already authorized by preparation. Only advisory directory
  // storage fails; this test never substitutes the actual commit/advance/rules.
  instance.prepareMafia = async () => {};
  return { instance, storage, failures, DB, setNow(value) { now = value; } };
}

test('an advisory public-directory failure cannot reject an already durable Mafia commit', async t => {
  const f = await fixture(t), candidate = structuredClone(f.instance.room);
  mafia.action(candidate, candidate.hostId, { type: 'chat', requestId: 'audit-chat', clientId: 'audit-chat-1', channel: 'public', text: 'نقاش محلي', matchId: candidate.matchId, phaseId: candidate.phaseId }, Date.now());
  await assert.doesNotReject(f.instance.commit(candidate, { prepared: true }));
  assert.equal(f.storage.data.get('room').chats.public.at(-1).text, 'نقاش محلي');
  assert.ok(f.failures.attempts > 0, 'the real advisory D1 path was exercised');
});

test('a failed directory refresh does not turn the next authoritative phase into an account-unavailable abort', async t => {
  const f = await fixture(t), before = f.instance.room.phase;
  f.setNow(f.instance.room.deadlineAt + 1);
  let error;
  try { await f.instance.advance({ force: true }); } catch (caught) { error = caught; }
  t.diagnostic(JSON.stringify({ phase: f.instance.room.phase, reason: f.instance.room.reason, directoryAttempts: f.failures.attempts }));
  assert.equal(error, undefined);
  assert.notEqual(f.instance.room.phase, before);
  assert.notEqual(f.instance.room.phase, 'over');
  assert.notEqual(f.instance.room.reason, 'account_unavailable');
  assert.notEqual(f.storage.data.get('room').phase, 'over');
});

test('critical seat/privacy metadata failures still propagate instead of being swallowed with discovery errors', async t => {
  const f = await fixture(t); f.failures.directory = false; f.failures.security = true;
  await assert.rejects(f.instance.settleMafiaMetadata(f.instance.room), /security seat cleanup unavailable/);
});

test('advisory retry is bounded, never cached as success, and recovers on regular room renewal', async t => {
  const f = await fixture(t);
  await f.instance.settleMafiaMetadata(f.instance.room);
  assert.equal(f.failures.attempts, 1);
  assert.equal(f.instance.mafiaMetadata.directory, undefined, 'failed synchronization is not a successful fingerprint');
  await f.instance.settleMafiaMetadata(f.instance.room);
  assert.equal(f.failures.attempts, 1, 'unrelated chat commits cannot hammer the failed directory');
  f.setNow(Date.now() + 30001); f.failures.directory = false;
  await f.instance.settleMafiaMetadata(f.instance.room);
  const row = await f.DB.prepare('SELECT players FROM mafia_public_rooms WHERE room_key=?').bind(f.instance.room.mafiaKey).first();
  assert.equal(row.players, 6);
  assert.equal(f.instance.mafiaMetadata.directoryRetry, null);
  assert.equal(typeof f.instance.mafiaMetadata.directory, 'string');
});
