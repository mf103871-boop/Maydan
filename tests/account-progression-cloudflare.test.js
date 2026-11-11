import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { WebSocket } from 'ws';
import { migrationStatements } from '../server/local-d1.mjs';
import { issueSession } from '../server/accounts/session.mjs';
import { RoomClient, newCredentials } from '../src/online/client.js';

const ORIGIN = 'http://localhost:3000';
class BrowserSocket extends WebSocket { constructor(url) { super(url, { origin: ORIGIN }); } }
async function until(condition, label) {
  const end = Date.now() + 8000;
  while (Date.now() < end) {
    if (await condition()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.fail('Timed out: ' + label);
}

test('workerd settles a verified multiplayer match, serves an owner-only receipt, and equips the earned frame', { timeout: 60_000 }, async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'maydan-account-progression-'));
  const clients = [];
  let worker;
  t.after(async () => {
    clients.forEach(client => client.stop());
    if (worker) await worker.dispose();
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    await rm(directory, { recursive: true, force: true });
  });
  const scriptPath = path.join(directory, 'worker.mjs');
  await build({ entryPoints: ['server/worker.mjs'], bundle: true, format: 'esm', platform: 'browser', outfile: scriptPath, logLevel: 'silent' });
  worker = new Miniflare(convertV4MiniflareOptions({
    rootPath: directory, name: 'maydan-rooms', modules: true, scriptPath, compatibilityDate: '2026-09-01',
    durableObjects: { ROOMS: { className: 'Room', useSQLite: true }, LIMITERS: { className: 'RequestLimiter', useSQLite: true } },
    d1Databases: { DB: 'progression-tests' }, bindings: { ALLOWED_ORIGINS: ORIGIN, ACCOUNT_PROGRESSION_ENABLED: '1' },
    port: 0, host: '127.0.0.1', cf: false,
  }));
  const server = (await worker.ready).origin;
  const DB = await worker.getD1Database('DB');
  for (const sql of migrationStatements()) await DB.prepare(sql).run();
  const tokens = [];
  for (const id of ['owner', 'other']) {
    const now = Date.now();
    await DB.prepare('INSERT INTO users(id,name,created_at,updated_at) VALUES(?,?,?,?)').bind(id, id, now, now).run();
    tokens.push((await issueSession({ DB }, id)).token);
  }
  async function request(endpoint, { token, body, method = 'GET', expected = 200 } = {}) {
    const response = await fetch(server + endpoint, {
      method, headers: { origin: ORIGIN, ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: 'Bearer ' + token } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const parsed = await response.json();
    assert.equal(response.status, expected, JSON.stringify(parsed));
    return parsed;
  }
  const seats = Array.from({ length: 3 }, (_, n) => ({ ...newCredentials(), name: 'هاتف ' + n, avatar: n, accountUserId: 'forged' }));
  const { code } = await request('/api/rooms', { method: 'POST', body: { ...seats[0], game: 'meenfina', rounds: 5 }, token: tokens[0], expected: 201 });
  for (let n = 1; n < seats.length; n++) await request('/api/rooms/' + code + '/join', { method: 'POST', body: seats[n], token: tokens[n] });
  for (const { id, token } of seats) {
    const client = new RoomClient({ server, code, session: { id, token }, WebSocketImpl: BrowserSocket });
    clients.push(client);
    client.start();
  }
  await until(() => clients.every(c => c.state?.members.every(member => member.connected)), 'connected seats');
  await Promise.all(clients.slice(1).map(c => c.command('ready', { ready: true })));
  await clients[0].command('start');
  for (let round = 1; round <= 5; round++) {
    await until(() => clients.every(c => c.state?.phase === 'vote' && c.state.round === round), 'vote phase');
    assert.ok(clients.every(c => !c.state.progressionReceipt), 'no receipt in an active match');
    await Promise.all(clients.map(c => c.command('vote', { targetId: seats[0].id })));
    await until(() => clients.every(c => c.state?.phase === 'result'), 'round result');
    await clients[0].command('next');
  }
  await until(() => clients.every(c => c.state?.phase === 'over'), 'match end');
  const locator = clients[0].state.progressionReceipt;
  assert.ok(locator?.eventId);
  assert.equal(clients[1].state.progressionReceipt.eventId, locator.eventId);
  assert.equal(clients[2].state.progressionReceipt, undefined);
  assert.doesNotMatch(JSON.stringify(clients[2].state), /forged|progressionPlan|statsMatch/);
  await until(async () => await DB.prepare('SELECT COUNT(*) AS n FROM progression_events').first('n') === 2, 'reward projection');
  const receiptPath = '/api/profiles/me/progression/receipts/' + encodeURIComponent(locator.eventId);
  const { receipt } = await request(receiptPath, { token: tokens[0] });
  assert.equal(receipt.status, 'settled');
  assert.equal(receipt.eventId, locator.eventId);
  assert.equal(receipt.awardedXp, 35);
  assert.equal(receipt.finishedAt, locator.notBefore);
  assert.deepEqual(receipt.nextReward, { itemId: 'progression.frame.10', level: 10 });
  await request(receiptPath, { expected: 401 });
  const { profile } = await request('/api/profiles/me', { token: tokens[0] });
  assert.equal(profile.stats.onlineWins, 0);
  assert.equal(profile.progression.qualifiedMatches, 1);
  assert.equal(profile.progression.owned[0].itemId, 'progression.frame.1');
  assert.deepEqual((await request('/api/profiles/owner', { token: tokens[1] })).profile.progression, { level: 1 });
  const selection = { frameId: 'progression.frame.1' };
  const saved = await request('/api/me/cosmetics', { token: tokens[0], method: 'PATCH', body: { selection, revision: 0 } });
  assert.equal(saved.effective.frameId, selection.frameId);
  assert.equal((await request('/api/profiles/owner', { token: tokens[1] })).profile.cosmetics.frameId, selection.frameId);
  await clients[0].command('restart');
  await until(() => clients.every(c => c.state?.phase === 'lobby'), 'fresh lobby');
  assert.ok(clients.every(c => !c.state.progressionReceipt), 'old receipt never attached to the next match');
  assert.equal(await DB.prepare('SELECT COUNT(*) AS n FROM progression_events').first('n'), 2);
});
