import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalSessionRecorder } from '../src/profiles/record-session.js';
import { createStorage } from '../src/shared/lib/storage.js';

const settle = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function harness(overrides = {}) {
  const starts = []; const completions = []; const storage = createStorage('test-sessions');
  const recorder = new LocalSessionRecorder({ storage, owner: 'account-a',
    beginSession: async game => { starts.push(game); return { sessionId: `server-${starts.length}` }; },
    completeSession: async id => { completions.push(id); return { ok: true }; }, ...overrides });
  return { recorder, storage, starts, completions };
}
test('game and account reconnect handlers share one in-flight completion', async () => {
  const pending=deferred();const first=harness({completeSession:()=>pending.promise});
  first.recorder.start('beep');await settle();first.recorder.complete(true);
  let duplicateCalls=0;
  const second=new LocalSessionRecorder({storage:first.storage,owner:'account-a',completeSession:async()=>{duplicateCalls++;return {ok:true};}});
  await second.flush();assert.equal(duplicateCalls,0);
  pending.resolve({ok:true});await settle();assert.equal(first.storage.keys().length,0);
});

test('local recording counts only a natural finish, once, and restart gets a separate server session', async () => {
  const { recorder, starts, completions } = harness();
  recorder.start('beep'); await settle(); recorder.complete(false); await settle();
  assert.deepEqual(completions, []);
  recorder.complete(true); recorder.complete(true); await settle();
  assert.deepEqual(completions, ['server-1']);
  recorder.start('beep'); await settle(); recorder.complete(true); await settle();
  assert.deepEqual(starts, ['beep', 'beep']); assert.deepEqual(completions, ['server-1', 'server-2']);
});

test('guest play and a failed start cannot invent an account completion', async () => {
  const guest = harness({ owner: null }); guest.recorder.start('jabeen'); guest.recorder.complete(true); await settle();
  assert.deepEqual(guest.starts, []); assert.deepEqual(guest.completions, []);
  const failed = harness({ beginSession: async () => { throw Object.assign(new Error(), { code: 'NETWORK' }); } });
  failed.recorder.start('jabeen'); await settle(); failed.recorder.complete(true); await failed.recorder.flush();
  assert.deepEqual(failed.completions, []);
});

test('completion before the start response uses that same server session', async () => {
  const pending = deferred(); const { recorder, completions } = harness({ beginSession: () => pending.promise });
  recorder.start('badeeha'); await settle(); recorder.complete(true);
  pending.resolve({ sessionId: 'acknowledged-start' }); await settle();
  assert.deepEqual(completions, ['acknowledged-start']);
});

test('switching accounts invalidates an active game even if its former owner returns', async () => {
  const pending = deferred(); const { recorder, completions, storage } = harness({ beginSession: () => pending.promise });
  const marker = recorder.start('meenfina'); await settle();
  recorder.updateOwner('account-b'); pending.resolve({ sessionId: 'old-owner' }); await settle();
  recorder.complete(true); recorder.updateOwner('account-a'); recorder.resume(marker, 'meenfina'); recorder.complete(true); await settle();
  assert.deepEqual(completions, []); assert.deepEqual(storage.keys(), []);
});

test('resume requires a saved marker for this game and account; historical saves get no session', async () => {
  const { recorder, storage, completions, starts } = harness();
  const marker = recorder.start('fabraka'); await settle(); recorder.stop();
  const next = new LocalSessionRecorder({ storage, owner: 'account-a', beginSession: async () => assert.fail('must not fabricate start'),
    completeSession: async id => { completions.push(id); return { ok: true }; } });
  for (const invalid of [null, { ...marker, ownerUserId: 'account-b' }, { ...marker, key: 'missing' }]) {
    next.resume(invalid, 'fabraka'); next.complete(true);
  }
  next.resume(marker, 'badeeha'); next.complete(true); await settle(); assert.deepEqual(completions, []);
  next.resume(marker, 'fabraka'); next.complete(true); await settle();
  assert.deepEqual(completions, ['server-1']); assert.deepEqual(starts, ['fabraka']);
});

test('transient failures remain owner scoped and retry the identical event; short sessions stay rejected', async () => {
  let code = 'NETWORK'; const calls = [];
  const { recorder, storage } = harness({ completeSession: async id => { calls.push(id); if (code) throw Object.assign(new Error(), { code }); return { ok: true }; } });
  recorder.start('mamnoo'); await settle(); recorder.complete(true); await settle();
  assert.equal(storage.keys().length, 1);
  recorder.updateOwner('account-b'); await recorder.flush(); assert.equal(calls.length, 1);
  recorder.updateOwner('account-a'); code = null; await recorder.flush();
  assert.deepEqual(calls, ['server-1', 'server-1']); assert.equal(storage.keys().length, 0);
  recorder.start('beep'); await settle(); code = 'SESSION_TOO_SHORT'; recorder.complete(true); await settle();
  code = null; await recorder.flush(); assert.equal(calls.length, 3); assert.equal(storage.keys().length, 0);
});

test('a switch during an outbox flush never submits the next old-owner event under the new identity', async () => {
  const pending = deferred(); const calls = [];
  const { recorder, storage } = harness({ completeSession: async id => { calls.push(id); await pending.promise; return { ok: true }; } });
  for (let n = 1; n <= 2; n++) storage.set(`session:${n}`, { completed: true, sessionId: `s${n}`, ownerUserId: 'account-a' });
  const task = recorder.flush(); await settle(); recorder.updateOwner('account-b'); pending.resolve(); await task;
  assert.deepEqual(calls, ['s1']); assert.equal(storage.keys().length, 2);
});

test('stale provider responses and temporary unavailability do not discard a queued completion', async () => {
  let response = null;
  const { recorder, storage } = harness({ completeSession: async () => { if (response instanceof Error) throw response; return response; } });
  recorder.start('beep'); await settle(); recorder.complete(true); await settle();
  assert.equal(storage.keys().length, 1);
  response = Object.assign(new Error(), { code: 'STALE' }); await recorder.flush(); assert.equal(storage.keys().length, 1);
  response = { ok: true, counted: false }; await recorder.flush(); assert.equal(storage.keys().length, 0);
});
