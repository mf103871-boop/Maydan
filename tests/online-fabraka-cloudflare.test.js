import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { WebSocket } from 'ws';
import { RoomClient, newCredentials } from '../src/online/client.js';
import questions from '../src/data/games/fabraka/questions.json' with { type: 'json' };

const ORIGIN = 'http://localhost:3000';
class BrowserSocket extends WebSocket { constructor(url) { super(url, { origin: ORIGIN }); } }
async function until(fn, label = 'condition') {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) { if (fn()) return; await new Promise((r) => setTimeout(r, 15)); }
  assert.fail(`Timed out: ${label}`);
}

test('Fabraka on workerd: private simultaneous play, SQLite hibernation, reconnection and friends rotation', { timeout: 40_000 }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'maydan-fabraka-cloudflare-'));
  const scriptPath = path.join(dir, 'worker.mjs');
  let mf; const allClients = [];
  try {
    await build({ entryPoints: ['server/worker.mjs'], bundle: true, format: 'esm', platform: 'browser', outfile: scriptPath, logLevel: 'silent' });
    mf = new Miniflare(convertV4MiniflareOptions({ rootPath: dir, name: 'maydan-rooms', modules: true, scriptPath, compatibilityDate: '2026-09-01',
      durableObjects: { ROOMS: { className: 'Room', useSQLite: true }, LIMITERS: { className: 'RequestLimiter', useSQLite: true } },
      bindings: { ALLOWED_ORIGINS: ORIGIN }, port: 0, host: '127.0.0.1', cf: false }));
    const server = (await mf.ready).origin;
    const invalid = await fetch(server + '/api/rooms', { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' },
      body: JSON.stringify({ ...newCredentials(), name: 'اختبار', avatar: 0, game: 'fabraka', settings: { categories: ['NO_SUCH_TOPIC'] } }) });
    assert.equal(invalid.status, 400); assert.equal((await invalid.json()).error, 'QUESTIONS');
    async function api(endpoint, data) {
      const res = await fetch(server + endpoint, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify(data) });
      const body = await res.json(); assert.ok(res.ok, `${res.status}: ${body.error}`); return body;
    }
    async function group(mode) {
      const profiles = Array.from({ length: 3 }, (_, n) => ({ ...newCredentials(), name: `هاتف ${n}`, avatar: n }));
      const created = await api('/api/rooms', { ...profiles[0], game: 'fabraka', settings: { mode, rounds: 3, writeSeconds: 0, discussionSeconds: 0, finalDouble: false, funnyVote: true } });
      assert.equal(created.game, 'fabraka');
      const clients = [];
      for (const [n, p] of profiles.entries()) {
        if (n) assert.equal((await api(`/api/rooms/${created.code}/join`, p)).game, 'fabraka');
        const client = new RoomClient({ server, code: created.code, session: { id: p.id, token: p.token }, WebSocketImpl: BrowserSocket });
        clients.push(client); allClients.push(client); client.start();
        await until(() => client.connectionStatus === 'connected', 'join authentication');
      }
      await until(() => clients.every((c) => c.state.members.filter((m) => m.connected).length === 3));
      await Promise.all(clients.slice(1).map((c) => c.command('ready', { ready: true })));
      await clients[0].command('start');
      return { clients, profiles, code: created.code };
    }
    async function reveal(clients) {
      await until(() => clients.every((c) => c.state.phase === 'reveal'));
      while (clients[0].state.phase === 'reveal') {
        assert.equal(clients[0].state.question.answer, undefined);
        await clients[0].command(clients[0].state.reveal.shown ? 'next_reveal' : 'reveal');
      }
      await until(() => clients.every((c) => c.state.phase === 'result'));
    }
    const { clients, profiles, code } = await group('classic');
    for (let round = 1; round <= 3; round++) {
      await until(() => clients.every((c) => c.state.phase === 'write' && c.state.round === round));
      assert.equal(clients[0].state.protocol, 3);
      const question = questions.find((q) => q.text === clients[0].state.question.text);
      assert.ok(question);
      assert.equal(clients[0].state.question.answer, undefined);
      assert.equal(clients[0].state.question.aliases, undefined);
      if (round === 1) {
        await clients[1].command('help');
        assert.ok(clients[1].state.myHelp);
        assert.equal(clients[2].state.myHelp, null);
      } else assert.equal(clients[1].state.helpAvailable, false);
      await clients[0].command('lie', { text: 'SECRET_ALPHA' });
      await until(() => clients[2].state.writingCount === 1);
      assert.equal(JSON.stringify(clients[2].state).includes('SECRET_ALPHA'), false);
      await assert.rejects(clients[0].command('lie', { text: 'CHANGED_ALPHA' }), (e) => e.code === 'SUBMITTED');
      if (round === 1) await mf.unsafeEvictDurableObject('maydan-rooms', 'Room', { name: code, webSockets: 'hibernate' });
      await clients[1].command('lie', { text: 'SECRET_BETA' });
      await clients[2].command('lie', { text: 'SECRET_GAMMA' });
      await until(() => clients.every((c) => c.state.phase === 'vote'));
      const option = (text) => clients[0].state.options.find((o) => o.text === text).id;
      const options = clients[0].state.options;
      assert.ok(options.every((o) => !('truth' in o) && !('owners' in o) && !('voters' in o)));
      await assert.rejects(clients[0].command('vote', { optionId: option('SECRET_ALPHA') }), (e) => e.code === 'OWN_ANSWER');
      await clients[0].command('vote', { optionId: option('SECRET_BETA'), funnyId: option('SECRET_GAMMA') });
      await until(() => clients[2].state.submittedCount === 1);
      assert.equal(clients[2].state.myVote.submitted, false);
      if (round === 1) {
        clients[0].stop(); clients[0].start();
        await until(() => clients[0].connectionStatus === 'connected' && clients[0].state.myVote.submitted);
        assert.equal(clients[0].state.myVote.optionId, option('SECRET_BETA'));
        assert.deepEqual(clients[0].state.options, options);
      }
      await clients[1].command('vote', { optionId: option(question.answer) });
      await clients[2].command('vote', { optionId: option(question.answer) });
      await reveal(clients);
      for (const c of clients) {
        assert.equal(c.state.question.answer, question.answer);
        assert.deepEqual(c.state.members.map((m) => m.score), [0, 1000 + (round - 1) * 1500, round * 1000]);
        for (const p of profiles) assert.equal(JSON.stringify(c.state).includes(p.token), false);
      }
      const previous = { round, matchId: clients[0].state.matchId };
      await clients[0].command('next');
      if (round < 3) {
        await until(() => clients[1].state.round === round + 1);
        await assert.rejects(clients[1].command('lie', { text: 'OLD_SCREEN', ...previous }), (e) => e.code === 'STALE');
        assert.equal(clients[1].state.mySubmission.submitted, false);
      }
    }
    await until(() => clients.every((c) => c.state.phase === 'over'));
    assert.equal(clients[0].state.history.length, 3);
    assert.equal(clients[2].state.members[2].stats.laughs, 3);
    await clients[0].command('restart');
    await until(() => clients.every((c) => c.state.phase === 'lobby'));
    clients.forEach((c) => c.stop());

    const friends = await group('friends');
    const totals = [0, 0, 0];
    for (let round = 1; round <= 3; round++) {
      const owner = round - 1, truth = `PRIVATE_TRUTH_${round}`;
      await until(() => friends.clients.every((c) => c.state.phase === 'host' && c.state.round === round));
      assert.equal(friends.clients[0].state.hostId, friends.profiles[0].id);
      assert.equal(friends.clients[0].state.truthHostId, friends.profiles[owner].id);
      await friends.clients[owner].command('truth', { text: truth, aliases: [`ALIAS_${round}`] });
      await until(() => friends.clients.every((c) => c.state.phase === 'write'));
      const writers = [0, 1, 2].filter((n) => n !== owner);
      for (const n of writers) {
        assert.equal(JSON.stringify(friends.clients[n].state).includes(truth), false);
        await friends.clients[n].command('lie', { text: `FRIEND_LIE_${n}` });
      }
      await until(() => friends.clients.every((c) => c.state.phase === 'vote'));
      const truthId = friends.clients[0].state.options.find((o) => o.text === truth).id;
      await assert.rejects(friends.clients[owner].command('vote', { optionId: truthId }), (e) => e.code === 'TRUTH_OWNER');
      for (const n of writers) { await friends.clients[n].command('vote', { optionId: truthId }); totals[n] += 1000; }
      await reveal(friends.clients);
      assert.deepEqual(friends.clients[0].state.members.map((m) => m.score), totals);
      await friends.clients[0].command('next');
    }
    await until(() => friends.clients.every((c) => c.state.phase === 'over'));
    assert.deepEqual(totals, [2000, 2000, 2000]);
  } finally {
    allClients.forEach((c) => c.stop());
    if (mf) await mf.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});
