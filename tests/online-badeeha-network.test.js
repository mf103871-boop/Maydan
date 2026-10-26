import test from 'node:test';
import assert from 'node:assert/strict';
import { startLocalServer } from '../server/local.mjs';
import { issueSession } from '../server/accounts/session.mjs';
import { newCredentials } from '../src/online/client.js';
import { RoomClient } from '../src/online/client.js';
import { WebSocket } from 'ws';
import { BADEEHA_PROTOCOL } from '../src/online/shared.js';

const ORIGIN = 'http://localhost:3000';
const capabilities = { badeeha: BADEEHA_PROTOCOL };
class BrowserSocket extends WebSocket { constructor(url) { super(url, { origin: ORIGIN }); } }
async function until(fn) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) { if (await fn()) return; await new Promise((resolve) => setTimeout(resolve, 10)); }
  assert.fail('Timed out awaiting Badeeha state/result');
}
const profile = (name) => ({ ...newCredentials(), name, avatar: 0 });
function settings() {
  const categories = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'];
  const deck = Object.fromEntries(categories.map((id) => [id, []]));
  for (let n = 0; n < 20; n++) deck[categories[n % 6]].push({ qid: `q-${n}`, p: 200 });
  return { mode: 'standard', roundSize: 20, timer: 60, categories, deck };
}
async function post(app, path, data, token) {
  const response = await fetch(app.url + path, { method: 'POST', headers: {
    origin: ORIGIN, 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}),
  }, body: JSON.stringify(data) });
  return { status: response.status, body: await response.json() };
}
test('Badeeha refuses unsupported phones before creating or allocating a seat', async (t) => {
  const app = await startLocalServer({ port: 0, vars: {} }); t.after(() => app.close());
  const host = { ...profile('المضيف'), game: 'badeeha', settings: settings() };
  const oldCreate = await post(app, '/api/rooms', host);
  assert.deepEqual(oldCreate, { status: 409, body: { error: 'UPDATE_REQUIRED' } });
  assert.equal(app.rooms.size, 0);
  const created = await post(app, '/api/rooms', { ...host, capabilities });
  assert.equal(created.status, 201);
  const guest = profile('ضيف');
  const oldJoin = await post(app, `/api/rooms/${created.body.code}/join`, guest);
  assert.deepEqual(oldJoin, { status: 409, body: { error: 'UPDATE_REQUIRED' } });
  assert.equal(app.rooms.get(created.body.code).instance.room.members.length, 1);
  assert.equal((await post(app, `/api/rooms/${created.body.code}/join`, { ...guest, capabilities })).status, 200);
});
test('free Badeeha hosting binds the verified account and never a supplied account ID', { timeout: 35_000 }, async (t) => {
  const app = await startLocalServer({ port: 0, vars: {} }); t.after(() => app.close());
  await app.env.DB.prepare('INSERT INTO users(id,name,created_at,updated_at) VALUES(?,?,?,?)').bind('real-host', 'المضيف', Date.now(), Date.now()).run();
  const { token } = await issueSession(app.env, 'real-host');
  const host = { ...profile('المضيف'), game: 'badeeha', settings: settings(), capabilities, accountUserId: 'forged' };
  const created = await post(app, '/api/rooms', host, token);
  assert.equal(created.status, 201);
  const room = app.rooms.get(created.body.code).instance.room;
  assert.equal(room.members[0].accountUserId, 'real-host');
  const duplicate = await post(app, `/api/rooms/${created.body.code}/join`, { ...profile('مكرر'), capabilities }, token);
  assert.equal(duplicate.body.error, 'ACCOUNT_IN_ROOM');
  assert.equal((await app.env.DB.prepare('SELECT COUNT(*) AS n FROM trials').first()).n, 0);
  assert.equal((await app.env.DB.prepare('SELECT COUNT(*) AS n FROM online_room_trial_claims').first()).n, 0);

  const guest = { ...profile('ضيف'), capabilities };
  assert.equal((await post(app, `/api/rooms/${created.body.code}/join`, guest)).status, 200);
  const clients = [host, guest].map((seat) => new RoomClient({ server: app.url, code: created.body.code, session: seat, WebSocketImpl: BrowserSocket }));
  t.after(() => clients.forEach((client) => client.stop()));
  clients.forEach((client) => client.start());
  await until(() => clients.every((client) => client.state?.members.every((member) => member.connected)));
  await clients[1].command('ready', { ready: true });
  await clients[0].command('start');
  for (let round = 1; round <= 20; round++) {
    await until(() => clients.every((client) => client.state?.phase === 'board' && client.state.round === round));
    const state = clients[0].state;
    const categoryId = state.settings.categories.find((id) => state.settings.deck[id].some((cell) => !state.used.includes(cell.qid)));
    const index = state.settings.deck[categoryId].findIndex((cell) => !state.used.includes(cell.qid));
    await clients[0].command('open', { categoryId, index });
    await clients[0].command('reveal');
    await clients[0].command('judge', { teamId: host.id });
    // This synthetic match answers instantly. Honor the real command quota,
    // rather than weakening it for a test that sends sixty actions in a second.
    if (round === 8 || round === 16) await new Promise((resolve) => setTimeout(resolve, 10_050));
  }
  await until(() => clients.every((client) => client.state?.phase === 'over'));
  await until(async () => (await app.env.DB.prepare('SELECT COUNT(*) AS n FROM player_events').first()).n === 1);
  const stats = await app.env.DB.prepare('SELECT online_matches,online_wins FROM player_stats WHERE user_id=?').bind('real-host').first();
  assert.deepEqual(stats, { online_matches: 1, online_wins: 1 });
  assert.equal((await app.env.DB.prepare('SELECT COUNT(*) AS n FROM trials').first()).n, 0, 'free hosting must stay free after play');
});
