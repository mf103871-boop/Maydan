import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { startLocalServer } from '../server/local.mjs';
import { issueSession } from '../server/accounts/session.mjs';
import { rewardedAccess } from '../server/rewarded/ledger.mjs';
import { RoomClient, newCredentials } from '../src/online/client.js';

const ORIGIN = 'http://localhost:3000';
const OFFER = 'meenfina-demo';
const INTENT = 'rewarded:start-intent';
class BrowserSocket extends WebSocket {
  constructor(url) { super(url, { origin: ORIGIN }); }
}
async function until(predicate) {
  const deadline = Date.now() + 3500;
  while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(predicate(), 'room state did not reach expected phase');
}
async function setup(t, enabled = true) {
  const app = await startLocalServer({ port: 0, origins: ORIGIN, vars: {
    APP_ORIGIN: ORIGIN, AUTH_DEV_FAKE: '1', REWARDED_ENV: 'local',
    REWARDED_PREVIEW_ENABLED: enabled ? '1' : '0', REWARDED_ADS_ENABLED: '1',
  } });
  const clients = [];
  t.after(async () => {
    clients.forEach(client => client.stop());
    await app.close();
  });
  const db = app.env.DB;
  async function account(id) {
    const now = Date.now();
    await db.prepare('INSERT INTO users(id,name,created_at,updated_at) VALUES(?,?,?,?)').bind(id, id, now, now).run();
    return 'Bearer ' + (await issueSession(app.env, id)).token;
  }
  async function post(endpoint, data, authorization) {
    const headers = { origin: ORIGIN, 'content-type': 'application/json' };
    if (authorization) headers.authorization = authorization;
    const response = await fetch(app.url + endpoint, { method: 'POST', headers, body: JSON.stringify(data) });
    return { status: response.status, body: await response.json() };
  }
  const seat = n => ({ ...newCredentials(), name: `لاعب ${n}`, avatar: n, rounds: 5, game: 'meenfina' });
  async function lobby(authorization, offer = OFFER) {
    const seats = [seat(0), seat(1), seat(2)];
    const created = await post('/api/rooms', { ...seats[0], rewardedOffer: offer }, authorization);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const { code } = created.body;
    for (const guest of seats.slice(1)) assert.equal((await post(`/api/rooms/${code}/join`, guest)).status, 200);
    const group = seats.map(session => new RoomClient({ server: app.url, code, session, WebSocketImpl: BrowserSocket }));
    clients.push(...group);
    group.forEach(client => client.start());
    await until(() => group.every(client => client.state?.members.length === 3 && client.state.members.every(member => member.connected)));
    return { code, seats, group, host: group[0], storage: app.rooms.get(code).storage,
      start: fields => group[0].command('start', { accountAuthorization: authorization, ...fields }) };
  }
  async function ready(room) {
    await Promise.all(room.group.slice(1).map(client => client.command('ready', { ready: true })));
  }
  async function ticket(userId) {
    const id = crypto.randomUUID(), now = Date.now();
    // The SSV suite covers verification. Put a verified attempt into the same
    // table here to isolate the room's claim protocol and failure cases.
    await db.prepare(`INSERT INTO rewarded_attempts
      (id,environment,user_id,offer,custom_hash,ad_unit,reward_item,state,created_at,expires_at,verified_at,transaction_id)
      VALUES(?,'local',?,?,?,'unit','match','verified',?,?,?,?)`).bind(id, userId, OFFER, id, now, now + 30_000, now, id).run();
    return id;
  }
  const claims = async () => (await db.prepare('SELECT match_id, user_id, source, state, ticket_id FROM rewarded_match_claims ORDER BY updated_at, match_id').all()).results;
  return { app, db, account, post, seat, lobby, ready, ticket, claims };
}
const isError = code => error => error.code === code;

test('demo creation is preview-only, host account-only and private; normal rooms stay free', async t => {
  const env = await setup(t);
  const auth = await env.account('host');
  const ticket = await env.ticket('host');
  assert.equal((await env.post('/api/rooms', { ...env.seat(0), accountUserId: 'host', rewardedOffer: OFFER })).body.error, 'AUTH_REQUIRED');
  assert.equal((await env.post('/api/rooms', { ...env.seat(0), rewardedOffer: 'badeeha-demo' }, auth)).body.error, 'REWARDED_UNAVAILABLE');
  assert.equal((await env.post('/api/rooms', { ...env.seat(0), rewardedOffer: OFFER, directory: { visibility: 'public', name: 'غرفة' } }, auth)).body.error, 'REWARDED_UNAVAILABLE');
  assert.equal((await env.post('/api/rooms', { ...env.seat(0), rewardedOffer: OFFER, rounds: 4 }, auth)).body.error, 'INVALID');
  assert.equal((await env.db.prepare('SELECT state FROM rewarded_attempts WHERE id=?').bind(ticket).first()).state, 'verified');
  const room = await env.lobby(undefined, null);
  await env.ready(room);
  await room.start();
  assert.equal(room.host.state.phase, 'vote');
  assert.deepEqual(await env.claims(), []);
  env.app.env.REWARDED_PREVIEW_ENABLED = '0';
  assert.equal((await env.post('/api/rooms', { ...env.seat(0), rewardedOffer: OFFER }, auth)).body.error, 'REWARDED_UNAVAILABLE');
});

test('only the authenticated host starts; retry, guest reconnect and rematch preserve claim boundaries', async t => {
  const env = await setup(t);
  const auth = await env.account('host');
  const other = await env.account('other');
  const room = await env.lobby(auth);
  assert.equal(room.host.state.rewardedOffer, OFFER);
  assert.equal(room.group[1].state.rewardedOffer, undefined);
  await assert.rejects(room.start(), isError('NOT_READY'));
  assert.deepEqual(await env.claims(), []);
  await env.ready(room);
  await assert.rejects(room.start({ accountAuthorization: null }), isError('AUTH_REQUIRED'));
  await assert.rejects(room.start({ accountAuthorization: other }), isError('AUTH'));
  await assert.rejects(room.group[1].command('start', { accountAuthorization: auth }), isError('HOST_ONLY'));
  const staleMatchId = room.host.state.matchId;
  await room.start();
  const firstId = (await room.storage.get('room')).rewardedMatchId;
  await assert.rejects(room.start({ matchId: staleMatchId }), isError('STALE'));
  assert.deepEqual(await env.claims(), [{ match_id: firstId, user_id: 'host', source: 'trial', state: 'committed', ticket_id: null }]);
  const guest = room.group[1];
  guest.stop();
  await until(() => !room.host.state.members.find(m => m.id === room.seats[1].id).connected);
  guest.start();
  await until(() => guest.connectionStatus === 'connected' && guest.state?.phase === 'vote');
  assert.equal(guest.state.matchId, room.host.state.matchId);
  for (let round = 1; round <= room.host.state.rounds; round++) {
    await until(() => room.group.every(c => c.state.phase === 'vote' && c.state.round === round));
    await Promise.all(room.group.map(client => client.command('vote', { targetId: room.seats[0].id })));
    await until(() => room.host.state.phase === 'result');
    await room.host.command('next');
  }
  await until(() => room.host.state.phase === 'over');
  await room.host.command('restart');
  await until(() => room.group.every(client => client.state.phase === 'lobby'));
  await env.ready(room);
  await assert.rejects(room.start(), isError('REWARDED_REQUIRED'));
  const ticket = await env.ticket('host');
  env.app.env.REWARDED_ADS_ENABLED = '0'; // Already verified tickets remain spendable.
  await room.start();
  const secondId = (await room.storage.get('room')).rewardedMatchId;
  assert.notEqual(secondId, firstId);
  assert.ok((await env.claims()).some(row => row.match_id === secondId && row.source === 'ticket' && row.ticket_id === ticket && row.state === 'committed'));
});

test('a verified ticket admits only one simultaneous start across separate rooms', async t => {
  const env = await setup(t);
  const auth = await env.account('host');
  const other = await env.account('other');
  const trial = await env.lobby(auth);
  await env.ready(trial);
  await trial.start();
  const first = await env.lobby(auth), second = await env.lobby(auth);
  await Promise.all([env.ready(first), env.ready(second)]);
  await env.ticket('other');
  await assert.rejects(first.start(), isError('REWARDED_REQUIRED'));
  assert.equal(await rewardedAccess(env.app.env, 'other', OFFER), 'trial');
  const ticket = await env.ticket('host');
  const results = await Promise.allSettled([first.start(), second.start()]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.ok(['REWARDED_REQUIRED', 'REWARDED_BUSY'].includes(results.find(r => r.status === 'rejected').reason.code));
  assert.equal((await env.claims()).filter(row => row.ticket_id === ticket && row.state === 'committed').length, 1);
  assert.equal((await env.post(`/api/rooms/${first.code}/join`, first.seats[0], other)).body.error, 'AUTH');
});

test('a DO failure before room persistence releases the exact reservation and permits retry', async t => {
  const env = await setup(t);
  const auth = await env.account('host');
  const trial = await env.lobby(auth);
  await env.ready(trial);
  await trial.start();
  const ticket = await env.ticket('host');
  const room = await env.lobby(auth);
  await env.ready(room);
  const originalPut = room.storage.put.bind(room.storage);
  let interrupted = false;
  room.storage.put = async (key, value) => {
    if (!interrupted && key === 'room' && value.phase === 'vote') {
      interrupted = true;
      throw new Error('injected room write failure');
    }
    return originalPut(key, value);
  };
  await assert.rejects(room.start(), isError('REWARDED_UNAVAILABLE'));
  assert.equal((await room.storage.get('room')).phase, 'lobby');
  assert.equal((await room.storage.get(INTENT)) ?? null, null);
  const released = (await env.claims()).find(row => row.ticket_id === ticket);
  assert.equal(released?.state, 'released');
  assert.equal(await rewardedAccess(env.app.env, 'host', OFFER), 'ticket');
  await room.start();
  const started = (await env.claims()).find(row => row.ticket_id === ticket && row.state === 'committed');
  assert.notEqual(started?.match_id, released.match_id);
  assert.equal((await room.storage.get('room')).rewardedMatchId, started?.match_id);
});

test('a lost DO acknowledgement cannot refund a start that was written', async t => {
  const env = await setup(t);
  const auth = await env.account('host');
  const room = await env.lobby(auth);
  await env.ready(room);
  const originalTx = room.storage.transaction.bind(room.storage);
  room.storage.transaction = async operation => {
    const result = await originalTx(operation);
    if ((await room.storage.get('room')).phase === 'vote') {
      room.storage.transaction = originalTx;
      throw new Error('injected lost acknowledgement');
    }
    return result;
  };
  await room.start();
  await until(() => room.host.state.phase === 'vote');
  const persisted = await room.storage.get('room');
  assert.equal((await env.claims()).find(row => row.match_id === persisted.rewardedMatchId)?.state, 'committed');
  assert.equal(await rewardedAccess(env.app.env, 'host', OFFER), 'required');
});

test('an unreadable DO write outcome keeps the ticket reserved and the stale lobby frozen', async t => {
  const env = await setup(t);
  const auth = await env.account('host');
  const room = await env.lobby(auth);
  await env.ready(room);
  const originalTx = room.storage.transaction.bind(room.storage);
  const originalGet = room.storage.get.bind(room.storage);
  let roomUnreadable = false;
  room.storage.get = async key => {
    if (roomUnreadable && key === 'room') throw new Error('injected room read failure');
    return originalGet(key);
  };
  room.storage.transaction = async operation => {
    const result = await originalTx(operation);
    if ((await originalGet('room')).phase === 'vote') {
      room.storage.transaction = originalTx;
      roomUnreadable = true;
      throw new Error('injected lost acknowledgement');
    }
    return result;
  };
  await assert.rejects(room.start(), isError('REWARDED_UNAVAILABLE'));
  await assert.rejects(room.group[1].command('ready', { ready: false }), isError('REWARDED_UNAVAILABLE'));
  const persisted = await originalGet('room');
  assert.equal((await env.claims()).find(row => row.match_id === persisted.rewardedMatchId)?.state, 'reserved');
  assert.ok(await room.storage.getAlarm());
  roomUnreadable = false;
  await env.app.rehydrate(room.code);
  await env.app.rooms.get(room.code).instance.alarm();
  await until(() => room.host.state.phase === 'vote');
  assert.equal((await env.claims()).find(row => row.match_id === persisted.rewardedMatchId)?.state, 'committed');
});

test('a D1 settlement outage keeps a started match playable and reconciles on cold room wake', async t => {
  const env = await setup(t);
  const auth = await env.account('host');
  const room = await env.lobby(auth);
  await env.ready(room);
  const originalPrepare = env.db.prepare.bind(env.db);
  env.db.prepare = sql => {
    if (sql.startsWith("UPDATE rewarded_match_claims SET state='committed'")) throw new Error('injected D1 settlement outage');
    return originalPrepare(sql);
  };
  await room.start();
  const intent = await room.storage.get(INTENT);
  assert.equal((await env.claims()).find(row => row.match_id === intent.matchId)?.state, 'reserved');
  assert.equal(await rewardedAccess(env.app.env, 'host', OFFER), 'busy');
  await until(() => room.group.every(client => client.state.phase === 'vote'));
  await room.group[1].command('vote', { targetId: room.seats[0].id });
  env.db.prepare = originalPrepare;
  await env.app.rehydrate(room.code);
  await env.app.rooms.get(room.code).instance.alarm();
  assert.equal((await room.storage.get(INTENT)) ?? null, null);
  assert.equal((await env.claims()).find(row => row.match_id === intent.matchId)?.state, 'committed');
  assert.equal((await room.storage.get('room')).rewardedMatchId, intent.matchId);
});
