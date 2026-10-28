import test from 'node:test';
import assert from 'node:assert/strict';
import { createSocialGameLauncher, joinSocialGameRoom, socialJoinFallbackKey } from '../src/social/game-launch.js';

const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function fixture(extra = {}) {
  const memory = new Map(); const calls = []; let sequence = 0;
  const account = { user: { id: 'alice', name: 'علي' }, gameAccess: () => 'trial', authHeaders: () => ({ Authorization: 'Bearer fixture' }), markTrial: () => { throw new Error('Creating a room must not consume a trial'); } };
  const options = { account, target: { targetType: 'group', targetId: 'g' }, server: 'https://example.test',
    read: (server,key) => memory.get(key), store: (server,key,value) => { memory.set(key,value); return true; },
    credentials: () => ({ id: `player-${++sequence}`, token: `secret-${sequence}` }), getDeviceId: () => 'device',
    createRoom: async (...args) => { calls.push(args); return { code: '234567' }; }, ...extra };
  return { launcher: createSocialGameLauncher(options), options, calls, memory };
}

test('group launches create and persist the host before sending the invitation, without consuming trial', async () => {
  const { launcher, calls, memory } = fixture(); let invited;
  const result = await launcher.launch('fabraka', async payload => {
    assert.deepEqual(memory.get('234567'), { id: 'player-1', token: 'secret-1' }); invited = payload;
  });
  assert.equal(calls.length, 1); assert.equal(calls[0][2].settings.mode, 'classic');
  assert.equal(calls[0][2].settings.writeSeconds, 30);
  assert.deepEqual(invited, { targetType: 'group', targetId: 'g', roomCode: '234567' });
  assert.equal(result.code, '234567'); assert.equal(memory.get('lastRoom'), '234567');
});
test('Ersomha launched from a group starts with easy drawable concepts',async()=>{
  const {launcher,calls}=fixture();
  await launcher.launch('ersomha',async()=>{});
  assert.equal(calls[0][2].game,'ersomha');
  assert.equal(calls[0][2].settings.difficulty,'easy');
  assert.equal(calls[0][2].settings.drawSeconds,60);
  assert.equal(calls[0][2].settings.cycles,1);
});

test('a Mafia group launch preserves the chosen three-team room and capability without charging a trial',async()=>{
  const {launcher,calls}=fixture();
  const settings={mode:'shadow',capacity:12,visibility:'private'};
  await launcher.launch('mafia',async()=>{}, {settings});
  assert.equal(calls[0][2].game,'mafia');assert.deepEqual(calls[0][2].settings,settings);
  assert.equal(calls[0][2].capabilities.mafia,1);
  assert.equal(calls[0][3].headers.Authorization,'Bearer fixture');
});

test('a Badeeha group launch sends the round dealt on the host phone and refuses one without it', async () => {
  const { launcher, calls } = fixture();
  await assert.rejects(launcher.launch('badeeha', async () => {}), { code: 'INVALID' });
  assert.equal(calls.length, 0, 'no room without a dealt round');
  const settings = { mode: 'standard', roundSize: 30, timer: 60, categories: ['a', 'b', 'c', 'd', 'e', 'f'], deck: { a: [{ qid: 'a:1', p: 200 }] } };
  await launcher.launch('badeeha', async () => {}, { settings });
  assert.equal(calls[0][2].game, 'badeeha'); assert.deepEqual(calls[0][2].settings, settings);
  assert.equal(calls[0][2].capabilities.badeeha, 1);
});

test('invitation failure and repeated taps reuse the same room and credentials', async () => {
  const wait = deferred(); const { launcher, calls } = fixture(); let attempts = 0;
  const first = launcher.launch('fabraka', async () => { ++attempts; await wait.promise; });
  assert.equal(launcher.launch('fabraka', () => { throw new Error('duplicate send'); }), first);
  wait.reject(new Error('offline')); await assert.rejects(first);
  const room = await launcher.launch('fabraka', async () => { ++attempts; });
  assert.equal(room.code, '234567'); assert.equal(calls.length, 1); assert.equal(attempts, 2);
});

test('an uncertain create response reuses pending credentials after dialog reopen', async () => {
  const { launcher, options } = fixture({ createRoom: async () => { throw new Error('lost response'); } });
  await assert.rejects(launcher.launch('meenfina', async () => {}));
  let body;
  const reopened = createSocialGameLauncher({ ...options, createRoom: async (server,path,payload) => { body = payload; return { code: '234567' }; } });
  await reopened.launch('meenfina', async () => {});
  assert.equal(body.id, 'player-1'); assert.equal(body.token, 'secret-1'); assert.equal(body.game, 'meenfina');
});

test('account change during room creation cannot persist or invite the previous account', async () => {
  const wait = deferred(); let current = true; let sent = false;
  const { launcher, memory } = fixture({ isCurrent: () => current, createRoom: () => wait.promise });
  const task = launcher.launch('fabraka', async () => { sent = true; });
  current = false; wait.resolve({ code: '234567' });
  await assert.rejects(task, { code: 'STALE' }); assert.equal(sent, false); assert.equal(memory.has('234567'), false);
});

test('legacy locked access no longer blocks free hosting, while malformed rooms cannot invite', async () => {
  const free = fixture({ account: { user: { id: 'alice' }, gameAccess: () => 'locked', authHeaders:()=>({Authorization:'Bearer fixture'}) } });
  let invited=false;
  await free.launcher.launch('fabraka', async () => { invited=true; });
  assert.equal(free.calls.length,1);assert.equal(invited,true);
  const broken = fixture({ createRoom: async () => ({ code: 'bad' }) });
  await assert.rejects(broken.launcher.launch('fabraka', async () => { throw new Error('must not invite'); }), { code: 'NETWORK' });
});

function joinFixture(extra = {}) {
  const memory = new Map(), calls = []; let sequence = 0;
  const options = { account: { user: { id: 'alice', name: '  علي  ميدان ' }, authHeaders: () => ({ Authorization: 'Bearer fixture' }), markTrial() { throw new Error('Joining never consumes a trial'); } }, roomCode: '234567', server: 'https://example.test',
    read: (server, key) => memory.get(key), store: (server, key, value) => { memory.set(key, value); return true; }, credentials: () => ({ id: `seat-${++sequence}`, token: `secret-${sequence}` }),
    joinRoom: async (...args) => { calls.push(args); return { code: '234567' }; }, ...extra };
  return { options, calls, memory };
}

test('accepted room invitations join with the signed-in profile and persist one reusable seat', async () => {
  const { options, calls, memory } = joinFixture();
  const first = await joinSocialGameRoom(options), retry = await joinSocialGameRoom(options);
  assert.equal(first.joined, true); assert.equal(retry.joined, true);
  assert.equal(calls[0][1], '/api/rooms/234567/join');
  assert.equal(calls[0][2].name, 'علي ميدان'); assert.equal(calls[0][2].avatar, 0);
  assert.equal(calls[0][3].headers.Authorization, 'Bearer fixture');
  assert.equal(calls[0][2].id, calls[1][2].id);
  assert.equal(memory.get('lastRoom'), '234567'); assert.equal(memory.get('roomOwner:234567'), 'alice');
});

test('uncertain join responses retain credentials across retries; a name conflict explains the existing entry fallback', async () => {
  const f = joinFixture({ joinRoom: async () => { throw Object.assign(new Error('lost response'), { code: 'NETWORK' }); } });
  await assert.rejects(joinSocialGameRoom(f.options), { code: 'NETWORK' });
  let body;
  const conflict = await joinSocialGameRoom({ ...f.options, joinRoom: async (server, path, payload) => { body = payload; throw Object.assign(new Error('duplicate name'), { code: 'NAME_TAKEN' }); } });
  assert.equal(conflict.joined, false); assert.equal(conflict.error, 'NAME_TAKEN'); assert.equal(body.id, 'seat-1');
  const fallback = f.memory.get(socialJoinFallbackKey('alice', '234567'));
  assert.equal(fallback.name, 'علي ميدان'); assert.equal(fallback.session.id, 'seat-1'); assert.equal(fallback.error, 'NAME_TAKEN');
  assert.equal(f.memory.has('234567'), false, 'failed joins cannot become connected sessions');
});

test('account changes during an accepted invitation join cannot persist or enter the old account room', async () => {
  const wait = deferred(); let current = true;
  const f = joinFixture({ isCurrent: () => current, joinRoom: () => wait.promise });
  const joined = joinSocialGameRoom(f.options); current = false; wait.resolve({ code: '234567' });
  await assert.rejects(joined, { code: 'STALE' });
  assert.equal(f.memory.has('234567'), false); assert.equal(f.memory.has('lastRoom'), false);
  assert.equal(f.memory.has(socialJoinFallbackKey('alice', '234567')), false);
});
