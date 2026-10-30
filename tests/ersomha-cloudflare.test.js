import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { WebSocket } from 'ws';
import { RoomClient, newCredentials } from '../src/online/client.js';
import { ROOM_CAPABILITIES } from '../src/online/shared.js';
import { EMPTY_COSMETICS } from '../src/plus/catalog.js';
import { migrationSql } from '../server/local-d1.mjs';

const ORIGIN = 'http://localhost:3000';
class BrowserSocket extends WebSocket { constructor(url) { super(url, { origin: ORIGIN }); } }
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label, timeout = 10_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await predicate()) return; await sleep(15); }
  assert.fail(`Timed out: ${label}`);
}
async function runtime() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'maydan-ersomha-api-'));
  const scriptPath = path.join(dir, 'worker.mjs');
  await build({ entryPoints: ['server/worker.mjs'], outfile: scriptPath, bundle: true, format: 'esm', platform: 'browser', logLevel: 'silent' });
  const mf = new Miniflare(convertV4MiniflareOptions({ rootPath: dir, name: 'ersomha-acceptance', modules: true, scriptPath,
    compatibilityDate: '2026-09-01', durableObjects: { ROOMS: { className: 'Room', useSQLite: true }, LIMITERS: { className: 'RequestLimiter', useSQLite: true } },
    d1Databases: { DB: 'ersomha-db' }, bindings: { ALLOWED_ORIGINS: ORIGIN, APP_ORIGIN: ORIGIN, AUTH_DEV_FAKE: '1', SESSION_SECRET: 'ersomha-test-only' }, port: 0, host: '127.0.0.1', cf: false }));
  const server = (await mf.ready).origin;
  const DB = await mf.getD1Database('DB'); await DB.exec(migrationSql());
  const api = async (endpoint, body, token) => {
    const response = await fetch(server + endpoint, { method: body === undefined ? 'GET' : 'POST', headers: { origin: ORIGIN, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  };
  const sign = async subject => {
    const result = await api('/api/auth/dev', { subject, name: subject });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return { token: result.body.session.token, userId: result.body.me.user.id };
  };
  return { server, DB, mf, api, sign, dispose: async () => { await mf.dispose(); await rm(dir, { recursive: true, force: true }); } };
}

test('workerd rejects unsupported clients and guests before allocating any Ersomha seat', { timeout: 40_000 }, async () => {
  const run = await runtime(); const clients = [];
  try {
    const owner = await run.sign('draw-admission-owner');
    const session = { ...newCredentials(), name: 'المضيف', avatar: 0, game: 'ersomha', deviceId: 'a'.repeat(32) };
    assert.equal((await run.api('/api/rooms', session, owner.token)).body.error, 'CONFIG');
    assert.equal((await run.api('/api/rooms', { ...session, capabilities: ROOM_CAPABILITIES })).body.error, 'AUTH_REQUIRED');
    const result = await run.api('/api/rooms', { ...session, capabilities: ROOM_CAPABILITIES }, owner.token);
    assert.equal(result.status, 201, JSON.stringify(result.body));
    const code = result.body.code;
    const visitor = { ...newCredentials(), name: 'الزائر', avatar: 1 };
    assert.equal((await run.api(`/api/rooms/${code}/join`, visitor)).body.error, 'CONFIG');
    assert.equal((await run.api(`/api/rooms/${code}/join`, { ...visitor, capabilities: ROOM_CAPABILITIES, accountUserId: owner.userId })).body.error, 'AUTH_REQUIRED');
    const other = await run.sign('draw-admission-other');
    assert.equal((await run.api(`/api/rooms/${code}/join`, visitor, other.token)).body.error, 'CONFIG');
    const client = new RoomClient({ server: run.server, code, session, getAccountAuthorization: () => `Bearer ${owner.token}`, WebSocketImpl: BrowserSocket }); clients.push(client); client.start();
    await until(() => client.state?.members[0].connected, 'owner connected');
    assert.equal(client.state.members.length, 1, 'failed admission leaves no ghost seat');
    const old = new BrowserSocket(`${run.server.replace('http:', 'ws:')}/api/rooms/${code}/socket`);
    const incompatible = new Promise((resolve, reject) => { old.on('error', reject); old.on('open', () => old.send(JSON.stringify({ type: 'auth', id: session.id, token: session.token }))); old.on('message', message => { const value = JSON.parse(message.toString()); if (value.error) resolve(value.error); }); });
    assert.equal(await incompatible, 'CONFIG'); old.close();
    assert.equal((await run.api('/health')).body.games.includes('ersomha'), true);
    assert.equal((await run.DB.prepare("SELECT COUNT(*) AS n FROM trials WHERE game='ersomha'").first()).n, 0);
  } finally { clients.forEach(client => client.stop()); await run.dispose(); }
});

test('Ersomha seat recovery requires its live account and rejects logout, account switching, suspension and deletion before any state', { timeout: 40_000 }, async () => {
  const run = await runtime(); const clients = [];
  try {
    const owner = await run.sign('draw-socket-owner'), other = await run.sign('draw-socket-other');
    await run.DB.prepare("UPDATE player_profiles SET avatar_preset='fox',theme='ocean',revision=7 WHERE user_id=?").bind(owner.userId).run();
    await run.DB.prepare("UPDATE player_profiles SET avatar_preset='owl',theme='violet',revision=4 WHERE user_id=?").bind(other.userId).run();
    const forged = { id: other.userId, avatarPreset: 'forged', theme: 'gold', avatarUrl: 'https://attacker.test/fake.jpg', revision: 999 };
    const session = { ...newCredentials(), name: 'المضيف', avatar: 0, game: 'ersomha', deviceId: 'b'.repeat(32), capabilities: ROOM_CAPABILITIES, profile: forged };
    const created = await run.api('/api/rooms', session, owner.token);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const code = created.body.code;
    const visitor = { ...newCredentials(), name: 'زائر', avatar: 1, capabilities: ROOM_CAPABILITIES, profile: forged };
    assert.equal((await run.api(`/api/rooms/${code}/join`, visitor, other.token)).status, 200);
    async function attempt(authorization, expectedError = null) {
      const states = [], errors = [];
      const client = new RoomClient({ server: run.server, code, session, getAccountAuthorization: () => authorization,
        onState: state => states.push(state), onError: error => errors.push(error), WebSocketImpl: BrowserSocket });
      clients.push(client); client.start();
      if (expectedError) {
        await until(() => client.connectionStatus === 'ended', `reject ${expectedError}`);
        assert.ok(errors.includes(expectedError), JSON.stringify(errors));
        assert.equal(states.length, 0, 'no account-bound choices or room state before successful account authorization');
      } else await until(() => client.connectionStatus === 'connected', 'matching account recovers seat');
      client.stop();
      return states;
    }
    await attempt(null, 'AUTH_REQUIRED');
    await attempt(`Bearer ${other.token}`, 'AUTH');
    const states = await attempt(`Bearer ${owner.token}`);
    assert.deepEqual(states.at(-1).members.find(m => m.id === session.id).profile, { avatarPreset: 'fox', theme: 'ocean', avatarUrl: null, revision: 7, cosmetics: EMPTY_COSMETICS });
    assert.deepEqual(states.at(-1).members.find(m => m.id === visitor.id).profile, { avatarPreset: 'owl', theme: 'violet', avatarUrl: null, revision: 4, cosmetics: EMPTY_COSMETICS });
    assert.equal(JSON.stringify(states).includes('attacker.test'), false, 'client profile fields are never trusted');
    assert.equal(JSON.stringify(states).includes(other.userId), false, 'public snapshot has no account-id field');
    assert.equal((await run.api('/api/auth/signout', {}, owner.token)).status, 204);
    await attempt(`Bearer ${owner.token}`, 'AUTH');
    const refreshed = await run.sign('draw-socket-owner');
    await run.DB.prepare('INSERT INTO moderation_suspensions(user_id,actor_id,reason,created_at,updated_at) VALUES(?,?,?,?,?)')
      .bind(owner.userId, other.userId, 'test', Date.now(), Date.now()).run();
    await attempt(`Bearer ${refreshed.token}`, 'AUTH');
    await run.DB.prepare('DELETE FROM moderation_suspensions WHERE user_id=?').bind(owner.userId).run();
    await attempt(`Bearer ${refreshed.token}`);
    const deleted = await fetch(`${run.server}/api/account`, { method: 'DELETE', headers: { origin: ORIGIN, authorization: `Bearer ${refreshed.token}` } });
    assert.equal(deleted.status, 204, await deleted.text());
    await attempt(`Bearer ${refreshed.token}`, 'AUTH');
  } finally { clients.forEach(client => client.stop()); await run.dispose(); }
});

test('workerd plays cooperative and competitive matches, streams eight seats, restores canvas and saves authorized evidence', { timeout: 150_000 }, async () => {
  const run = await runtime(); const clients = [];
  try {
    for (const count of [2, 3, 8]) {
      const accounts = await Promise.all(Array.from({ length: count }, (_, i) => run.sign(`draw-${count}-player-${i}`)));
      const seats = accounts.map((_, i) => ({ ...newCredentials(), name: `لاعب ${i + 1}`, avatar: i % 4, capabilities: ROOM_CAPABILITIES }));
      const created = await run.api('/api/rooms', { ...seats[0], game: 'ersomha', deviceId: count.toString(16).repeat(32), settings: { cycles: 1, difficulty: 'medium', categories: [] } }, accounts[0].token);
      assert.equal(created.status, 201, JSON.stringify(created.body));
      const code = created.body.code;
      for (let i = 1; i < count; i++) assert.equal((await run.api(`/api/rooms/${code}/join`, seats[i], accounts[i].token)).status, 200);
      const pair = seats.map((session, index) => new RoomClient({ server: run.server, code, session, getAccountAuthorization: () => `Bearer ${accounts[index].token}`, WebSocketImpl: BrowserSocket }));
      clients.push(...pair); pair.forEach(client => client.start());
      await until(() => pair.every(client => client.state?.members.filter(m => m.connected).length === count), `${count} seats connected`);
      for (const client of pair.slice(1)) await client.command('ready', { ready: true });
      await pair[0].command('start');
      await until(() => pair.every(client => client.state?.phase === 'select'), 'shared select');
      assert.equal(pair[0].state.settings.mode, count === 2 ? 'cooperative' : 'competitive');
      const turnsToComplete = count === 8 ? 1 : count;
      for (let turn = 1; turn <= turnsToComplete; turn++) {
        await until(() => pair.every(client => client.state.round === turn && client.state.phase === 'select'), `turn ${turn} selection`, 12_000);
        const drawerIndex = seats.findIndex(seat => seat.id === pair[0].state.drawerId), drawer = pair[drawerIndex];
        assert.equal(drawer.state.myChoices.length, 3);
        for (const client of pair.filter(client => client !== drawer)) assert.deepEqual(client.state.myChoices, []);
        const choice = drawer.state.myChoices[0]; await drawer.command('select_word', { choiceId: choice.id });
        await until(() => pair.every(client => client.state.phase === 'draw'), 'drawing started');
        const answer = drawer.state.myWord; assert.equal(typeof answer, 'string');
        for (const client of pair.filter(client => client !== drawer)) {
          assert.equal(client.state.myWord, null); assert.equal(client.state.revealedWord, null);
          assert.equal(JSON.stringify(client.state).includes(answer), false, 'hidden answer is not on guessers state channel');
        }
        if (turn === 1) {
          const updates = pair.map(() => []); const cleanups = pair.map((client, i) => client.subscribeDrawing(event => updates[i].push(event)));
          try {
            for (let batch = 0; batch < 18; batch++) {
              await drawer.command('drawing_batch', { epoch: drawer.state.drawing.epoch, strokeId: 'acceptance-stroke', tool: 'pen', color: '#118d96', width: 6, points: [[0.1 + batch / 30, 0.2 + batch / 100]], end: batch === 17 });
              await sleep(80);
            }
            await until(() => updates.every(events => events.filter(event => event.kind === 'append').length === 18), 'durable drawing reaches every seat');
            await drawer.command('drawing_undo', { epoch: drawer.state.drawing.epoch });
            await drawer.command('drawing_redo', { epoch: drawer.state.drawing.epoch });
            await run.mf.unsafeEvictDurableObject('ersomha-acceptance', 'Room', { name: code, webSockets: 'hibernate' });
            await pair[1].command('drawing_sync');
            await until(() => updates[1].some(event => event.kind === 'sync' && event.ops?.some(op => op.strokeId === 'acceptance-stroke' && op.points.length)), 'drawing restored after DO hibernation');
            const report = await run.api('/api/games/ersomha/reports', { roomCode: code, matchId: drawer.state.matchId, round: turn, reason: 'تجربة حفظ الدليل الخاص', clientId: `acceptance-report-${count}` }, accounts[1].token);
            assert.equal(report.status, 201, JSON.stringify(report.body));
            const saved = await run.DB.prepare('SELECT evidence_json FROM ersomha_drawing_reports WHERE report_id=?').bind(report.body.reportId).first();
            const evidence = JSON.parse(saved.evidence_json);
            assert.equal(evidence.canvas.strokes[0].points.length, 18);
            assert.equal(JSON.stringify(evidence).includes(answer), false);
          } finally { cleanups.forEach(stop => stop()); }
        }
        const guessers = pair.filter(client => client !== drawer);
        for (const client of guessers) await client.command('guess', { text: answer });
        await until(() => pair.every(client => client.state.phase === 'result'), 'correct answers end the turn');
        assert.equal(pair[0].state.revealedWord, answer);
        assert.equal(pair[0].state.guessedIds.length, count - 1);
      }
      if (count !== 8) {
        await until(() => pair.every(client => client.state.phase === 'over'), 'match finishes automatically', 12_000);
        if (count === 2) {
          assert.equal(pair[0].state.cooperative.solvedTurns, 2); assert.ok(pair[0].state.cooperative.remainingMs > 0);
        } else assert.ok(pair[0].state.members.every(member => member.score > 0));
        await until(async () => (await run.DB.prepare("SELECT COUNT(*) AS n FROM player_events WHERE source='online' AND game='ersomha' AND user_id=?").bind(accounts[0].userId).first()).n === 1, 'one authoritative profile event');
        if (count === 2) assert.equal((await run.DB.prepare("SELECT SUM(won+draw) AS n FROM player_events WHERE game='ersomha' AND user_id=?").bind(accounts[0].userId).first()).n, 0, 'cooperative completion cannot invent an individual win');
      }
      for (let i = 0; i < pair.length; i++) {
        await run.api(`/api/rooms/${code}/leave`, seats[i], accounts[i].token); pair[i].stop();
      }
    }
  } finally { clients.forEach(client => client.stop()); await run.dispose(); }
});
