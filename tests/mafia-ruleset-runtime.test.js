import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { startLocalServer } from '../server/local.mjs';
import { createUser } from '../server/accounts/db.mjs';
import { issueSession } from '../server/accounts/session.mjs';
import { first } from '../server/lamma/common.mjs';
import { tick } from '../server/mafia-model.mjs';
import { newCredentials, RoomClient } from '../src/online/client.js';
import { MAFIA_PROTOCOL, MAFIA_MAX_MATCH_MS } from '../src/online/mafia-shared.js';

const origin = 'http://localhost:3000';
class Socket extends WebSocket { constructor(url) { super(url, { origin }); } }
async function until(fn) {
  const end = Date.now() + 5000;
  while (Date.now() < end) { if (await fn()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.fail('Mafia client state timeout');
}
async function setup(t, vars = {}) {
  const app = await startLocalServer({ port: 0, vars: { MAFIA_ENABLED: '1', MAFIA_ACCEPT_NEW_MATCHES: '1', ...vars } }), clients = [];
  const apiOrigin = vars.APP_ORIGIN || origin;
  t.after(async () => { clients.forEach(client => client.stop()); await app.close(); });
  async function user(n) {
    const account = await createUser(app.env, { name: `ضيف ${n}`, email: `${crypto.randomUUID()}@example.test` });
    const session = await issueSession(app.env, account.id);
    return { ...newCredentials(), accountId: account.id, authorization: session.token, name: account.name, avatar: 0,
      game: 'mafia', capabilities: { mafia: MAFIA_PROTOCOL }, settings: { mode: 'classic', capacity: 8, visibility: 'public', voiceMode: 'off' } };
  }
  async function api(person, path, body) {
    const response = await fetch(app.url + path, { method: body === undefined ? 'GET' : 'POST',
      headers: { origin: apiOrigin, authorization: `Bearer ${person.authorization}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  }
  async function group() {
    const people = []; for (let n = 0; n < 6; n++) people.push(await user(n));
    const created = await api(people[0], '/api/rooms', people[0]); assert.equal(created.status, 201);
    const code = created.body.code;
    for (const person of people.slice(1)) assert.equal((await api(person, `/api/rooms/${code}/join`, person)).status, 200);
    const cs = people.map(person => new RoomClient({ server: app.url, code, session: { id: person.id, token: person.token },
      getAccountAuthorization: () => `Bearer ${person.authorization}`, WebSocketImpl: Socket }));
    clients.push(...cs); cs.forEach(client => client.start());
    await until(() => cs.every(client => client.state?.members.filter(member => member.connected).length === 6));
    for (const client of cs.slice(1)) await client.command('ready', { ready: true });
    return { people, code, clients: cs, item: app.rooms.get(code) };
  }
  async function phase(group, now) {
    await group.item.instance.serial(async () => {
      const candidate = structuredClone(group.item.instance.room);
      candidate.deadlineAt = Date.now() - 1;
      tick(candidate, now ?? Date.now()); await group.item.instance.commit(candidate);
    });
  }
  return { app, user, api, group, phase };
}

test('drain refuses Mafia creation before allocating a room or a seat', async t => {
  const h = await setup(t), person = await h.user(0); h.app.env.MAFIA_ACCEPT_NEW_MATCHES = '0';
  assert.deepEqual(await h.api(person, '/api/rooms', person), { status: 503, body: { error: 'MAFIA_DRAINING' } });
  assert.equal(h.app.rooms.size, 0); assert.equal((await first(h.app.env, 'SELECT COUNT(*) n FROM mafia_seats')).n, 0);
  h.app.env.MAFIA_ENABLED = '0';
  assert.equal((await h.api(person, '/api/rooms', person)).body.error, 'MAFIA_DISABLED');
});

test('drain blocks lobby admission/start/promotion but preserves original seat recovery and observation', async t => {
  const h = await setup(t), group = await h.group(), outsider = await h.user(20), watcher = await h.user(21);
  h.app.env.MAFIA_ACCEPT_NEW_MATCHES = '0';
  await assert.rejects(group.clients[0].command('start'), { code: 'MAFIA_DRAINING' });
  assert.equal(group.item.instance.room.phase, 'lobby'); assert.equal(group.item.instance.room.matchId, 0);
  assert.deepEqual(group.item.instance.room.roleStates, {});
  assert.equal((await h.api(outsider, `/api/rooms/${group.code}/join`, outsider)).body.error, 'MAFIA_DRAINING');
  assert.equal((await h.api(outsider, '/api/matchmaking/join', outsider)).body.error, 'MAFIA_DRAINING');
  assert.equal((await h.api(group.people[0], `/api/rooms/${group.code}/join`, group.people[0])).status, 200);
  assert.equal((await h.api(group.people[0], '/api/matchmaking/join', group.people[0])).status, 200);
  assert.equal((await h.api(group.people[0], `/api/rooms/${group.code}/join`, { ...group.people[0], token: 'f'.repeat(64) })).body.error, 'AUTH');
  assert.equal((await h.api(watcher, `/api/rooms/${group.code}/observe`, watcher)).status, 200);
  assert.equal((await h.api(watcher, `/api/rooms/${group.code}/observe/promote`, { ...watcher, seat: newCredentials(), expectedSettingsRevision: 0 })).body.error, 'MAFIA_DRAINING');
  assert.equal((await h.api(watcher, `/api/rooms/${group.code}/observe/leave`, watcher)).status, 200);
  assert.equal((await first(h.app.env, 'SELECT COUNT(*) n FROM mafia_seats')).n, 6);
});

test('a running v1 match advances, restores, reports and finishes during drain; restart waits for reopening', async t => {
  const h = await setup(t), group = await h.group();
  await group.clients[0].command('start');
  h.app.env.MAFIA_ACCEPT_NEW_MATCHES = '0';
  await h.phase(group); await until(() => group.clients.every(client => client.state?.phase === 'opening'));
  assert.equal(group.item.instance.room.rulesetVersion, 1); assert.equal(Boolean(group.item.instance.room.technicalAbort), false);
  await group.clients[1].command('chat', { channel: 'public', text: 'رسالة أثناء الصيانة', clientId: crypto.randomUUID() });
  assert.equal((await h.api(group.people[0], `/api/rooms/${group.code}/mafia-report`, { clientId: crypto.randomUUID(), matchId: 1,
    targetId: group.people[1].id, reason: 'تقرير تجريبي' })).status, 200);
  await h.app.rehydrate(group.code);
  assert.equal((await h.api(group.people[0], `/api/rooms/${group.code}/join`, group.people[0])).status, 200);
  assert.equal(group.item.instance.room.rulesetVersion, 1); assert.equal(group.item.instance.room.matchId, 1);
  await h.phase(group, group.item.instance.room.startedAt + MAFIA_MAX_MATCH_MS + 1);
  await until(() => group.clients.every(client => client.state?.phase === 'over'));
  assert.equal(Boolean(group.item.instance.room.technicalAbort), false);
  await assert.rejects(group.clients[0].command('restart'), { code: 'MAFIA_DRAINING' });
  assert.equal(group.item.instance.room.phase, 'over'); assert.equal(group.item.instance.room.matchId, 1);
  h.app.env.MAFIA_ACCEPT_NEW_MATCHES = '1';
  await group.clients[0].command('restart'); await until(() => group.clients.every(client => client.state?.phase === 'lobby'));
  assert.equal(group.item.instance.room.rulesetVersion, 1);
});

test('explicit v2 capabilities fence old HTTP/socket clients before private state while unchanged v1 rooms remain compatible', async t => {
  const preview = 'https://maydan-mafia-preview.mf103871.workers.dev';
  const h = await setup(t, { APP_ORIGIN: preview, ALLOWED_ORIGINS: preview, MAFIA_EXPERIMENTAL_ROLES_ENABLED: '1' });
  const host = await h.user(0), old = await h.user(1), newcomer = await h.user(2);
  const settings = { ...host.settings, visibility: 'private', experimentalRole: 'tracker' };
  const denied = await h.api(old, '/api/rooms', { ...old, settings });
  assert.deepEqual(denied, { status: 409, body: { error: 'UPDATE_REQUIRED' } });
  assert.equal((await first(h.app.env, 'SELECT COUNT(*) n FROM mafia_seats')).n, 0);
  const created = await h.api(host, '/api/rooms', { ...host, settings, capabilities: { mafia: MAFIA_PROTOCOL, mafiaRulesets: [1, 2] } });
  assert.equal(created.status, 201, JSON.stringify(created));
  const code = created.body.code; assert.equal(h.app.rooms.get(code).instance.room.rulesetVersion, 2);
  for (const capabilities of [{ mafia: MAFIA_PROTOCOL }, { mafia: MAFIA_PROTOCOL, mafiaRulesets: [1] }, { mafia: MAFIA_PROTOCOL, mafiaRulesets: ['2'] }])
    assert.deepEqual(await h.api(old, `/api/rooms/${code}/join`, { ...old, capabilities }), { status: 409, body: { error: 'UPDATE_REQUIRED' } });
  assert.equal((await first(h.app.env, 'SELECT COUNT(*) n FROM mafia_seats')).n, 1);
  const ws = new WebSocket(h.app.url.replace('http:', 'ws:') + `/api/rooms/${code}/socket`, { origin: preview }), messages = [];
  t.after(() => ws.terminate()); ws.on('message', value => messages.push(JSON.parse(String(value))));
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  ws.send(JSON.stringify({ type: 'auth', id: host.id, token: host.token, accountAuthorization: `Bearer ${host.authorization}`, capabilities: { mafia: MAFIA_PROTOCOL } }));
  await until(() => messages.some(message => message.type === 'error' && message.error === 'UPDATE_REQUIRED'));
  assert.equal(messages.some(message => message.type === 'state'), false); ws.terminate();
  const classic = await h.api(old, '/api/rooms', old); assert.equal(classic.status, 201, JSON.stringify(classic));
  assert.equal(h.app.rooms.get(classic.body.code).instance.room.rulesetVersion, 1);
  assert.equal((await h.api(newcomer, `/api/rooms/${classic.body.code}/join`, newcomer)).status, 200);
});
