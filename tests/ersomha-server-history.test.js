import test from 'node:test';
import assert from 'node:assert/strict';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { createLocalD1, migrationSql } from '../server/local-d1.mjs';
import { createRoom, joinRoom } from '../server/ersomha-model.mjs';
import { buildErsomhaChoices } from '../server/ersomha-content.mjs';
import { acquireErsomhaLease, assertErsomhaLease, renewErsomhaLease, releaseErsomhaLease, ersomhaSeen, exposeErsomhaCards,
  ersomhaAccountHash, ersomhaDeleteStatements, buildErsomhaTurnPlan, ERSOMHA_LEASE_MS } from '../server/ersomha-history.mjs';

function roomFor(ids = ['account-a', 'account-b', 'account-c']) {
  const input = n => ({ id: `seat-${n}`, tokenHash: `token-${n}`, name: `لاعب ${n}`, avatar: n });
  const room = createRoom('123456', input(0), 1000);
  ids.slice(1).forEach((_, n) => joinRoom(room, input(n + 1), 1000));
  room.members.forEach((m, n) => { m.accountUserId = ids[n]; }); room.participants = room.members.map(m => m.id); return room;
}
async function users(DB) {
  for (const id of ['account-a', 'account-b', 'account-c', 'account-d']) await DB.prepare('INSERT INTO users(id,name,created_at,updated_at) VALUES(?,?,?,?)').bind(id, id, 1000, 1000).run();
}
const rejects = (code, promise) => assert.rejects(promise, e => e.code === code);
test('real D1 atomic batches fence concurrent rooms sharing an authenticated account', { timeout: 30_000 }, async () => {
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: 'export default {fetch(){return new Response("ok")}}', compatibilityDate: '2026-09-01', d1Databases: ['DB'], cf: false }));
  try {
    const DB = await mf.getD1Database('DB'); await DB.exec(migrationSql()); await users(DB);
    const first = roomFor(), second = roomFor(['account-a', 'account-d']);
    const outcomes = await Promise.allSettled([acquireErsomhaLease({ DB }, first, 1000), acquireErsomhaLease({ DB }, second, 1000)]);
    assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(outcomes.find(r => r.status === 'rejected').reason.code, 'ERSOMHA_ACTIVE_ELSEWHERE');
    const lease = outcomes.find(r => r.status === 'fulfilled').value;
    const held = (await DB.prepare('SELECT * FROM ersomha_leases WHERE expires_at>1000').all()).results;
    assert.equal(held.every(row => row.room_key === lease.roomKey), true, 'loser cannot acquire a partial set');
  } finally { await mf.dispose(); }
});
test('expired leases increment fencing, and a stale room cannot renew or expose a new word', async () => {
  const DB = createLocalD1(); try {
    await users(DB); const env = { DB }, first = roomFor(), second = roomFor();
    const old = await acquireErsomhaLease(env, first, 1000);
    const now = 1000 + ERSOMHA_LEASE_MS + 1, current = await acquireErsomhaLease(env, second, now);
    assert.ok(current.accounts.every(a => a.fence > old.accounts.find(b => b.hash === a.hash).fence));
    await rejects('ERSOMHA_ACTIVE_ELSEWHERE', renewErsomhaLease(env, old, now));
    await rejects('ERSOMHA_ACTIVE_ELSEWHERE', exposeErsomhaCards(env, old, buildErsomhaChoices(), ['account-a'], 'stale:choice', { now }));
    await assertErsomhaLease(env, current, now); assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM ersomha_seen').first()).n, 0);
  } finally { DB.close(); }
});
test('three choices are recorded before exposure and selection records every viewer without silent replay', async () => {
  const DB = createLocalD1(); try {
    await users(DB); const env = { DB }, lease = await acquireErsomhaLease(env, roomFor(), 1000), choices = buildErsomhaChoices();
    await exposeErsomhaCards(env, lease, choices, ['account-a'], 'turn:1:choice', { now: 1100 });
    assert.equal((await ersomhaSeen(env, lease)).length, 3);
    await exposeErsomhaCards(env, lease, choices, ['account-a'], 'turn:1:choice', { now: 1101 });
    await exposeErsomhaCards(env, lease, [choices[0]], ['account-a', 'account-b', 'account-c'], 'turn:1:selected', { now: 1200, acceptedExposureIds: ['turn:1:choice'] });
    const seen = await ersomhaSeen(env, lease); assert.equal(seen.length, 5);
    await rejects('ERSOMHA_HISTORY_CONFLICT', exposeErsomhaCards(env, lease, [choices[0]], ['account-b'], 'turn:2:choice', { now: 1300 }));
    const unseen = buildErsomhaChoices({ excludedConceptIds: seen.map(s => s.concept_id), excludedFamilyIds: seen.map(s => s.family_id) });
    assert.equal(unseen.some(c => choices.some(old => old.familyId === c.familyId || old.conceptId === c.conceptId)), false);
    await exposeErsomhaCards(env, lease, [choices[0]], ['account-b'], 'turn:2:choice', { now: 1400, allowReplay: true });
    assert.equal((await ersomhaSeen(env, lease)).filter(r => r.exposure_id === 'turn:2:choice').length, 1);
  } finally { DB.close(); }
});
test('history fails closed on a suspended/deleted account or unavailable database', async () => {
  const DB = createLocalD1(); try {
    await users(DB); const env = { DB }, lease = await acquireErsomhaLease(env, roomFor(), 1000);
    await DB.prepare('INSERT INTO moderation_suspensions(user_id,actor_id,reason,created_at,updated_at) VALUES(?,?,?,?,?)').bind('account-b', 'moderator', 'test', 1000, 1000).run();
    await rejects('AUTH', assertErsomhaLease(env, lease, 1100));
    await rejects('AUTH', exposeErsomhaCards(env, lease, buildErsomhaChoices(), ['account-a'], 'suspended:choice', { now: 1100 }));
    await DB.prepare('DELETE FROM moderation_suspensions').run(); await DB.prepare('DELETE FROM users WHERE id=?').bind('account-c').run();
    await rejects('AUTH', assertErsomhaLease(env, lease, 1200));
    await rejects('ERSOMHA_UNAVAILABLE', acquireErsomhaLease({}, roomFor(), 1000));
    assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM ersomha_seen').first()).n, 0);
  } finally { DB.close(); }
});
test('account deletion between acquisition precheck and D1 batch cannot resurrect any lease', async () => {
  const DB = createLocalD1(); try {
    await users(DB); const env = { DB }, batch = DB.batch.bind(DB);
    DB.batch = async queries => {
      DB.batch = batch;
      await batch([...(await ersomhaDeleteStatements(env, 'account-b')), DB.prepare('DELETE FROM users WHERE id=?').bind('account-b')]);
      return batch(queries);
    };
    await rejects('AUTH', acquireErsomhaLease(env, roomFor(), 1000));
    assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM ersomha_leases').first()).n, 0, 'all participants are fenced inside each atomic insert');
  } finally { DB.close(); }
});
test('suspension between acquisition precheck and batch cannot reserve the other accounts', async () => {
  const DB = createLocalD1(); try {
    await users(DB); const env = { DB }, batch = DB.batch.bind(DB);
    DB.batch = async queries => {
      DB.batch = batch;
      await DB.prepare('INSERT INTO moderation_suspensions(user_id,actor_id,reason,created_at,updated_at) VALUES(?,?,?,?,?)')
        .bind('account-b', 'moderator', 'test', 1000, 1000).run();
      return batch(queries);
    };
    await rejects('AUTH', acquireErsomhaLease(env, roomFor(), 1000));
    assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM ersomha_leases').first()).n, 0);
  } finally { DB.close(); }
});
test('account deletion racing an exposure cannot resurrect history or partially expose the remaining players', async () => {
  const DB = createLocalD1(); try {
    await users(DB); const env = { DB }, lease = await acquireErsomhaLease(env, roomFor(), 1000), batch = DB.batch.bind(DB);
    DB.batch = async queries => {
      DB.batch = batch;
      await batch([...(await ersomhaDeleteStatements(env, 'account-a')), DB.prepare('DELETE FROM users WHERE id=?').bind('account-a')]);
      return batch(queries);
    };
    await rejects('AUTH', exposeErsomhaCards(env, lease, buildErsomhaChoices(), ['account-a', 'account-b'], 'deleted:choice', { now: 1100 }));
    assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM ersomha_seen').first()).n, 0, 'no write after the account deletion transaction');
  } finally { DB.close(); }
});
test('account deletion racing renewal cannot extend leases for a now-invalid participant set', async () => {
  const DB = createLocalD1(); try {
    await users(DB); const env = { DB }, lease = await acquireErsomhaLease(env, roomFor(), 1000), prepare = DB.prepare.bind(DB);
    DB.prepare = sql => {
      const statement = prepare(sql);
      if (!sql.startsWith('UPDATE ersomha_leases SET expires_at=?,updated_at=?')) return statement;
      return { bind(...args) {
        const bound = statement.bind(...args), run = bound.run.bind(bound);
        bound.run = async () => {
          DB.prepare = prepare;
          await DB.batch([...(await ersomhaDeleteStatements(env, 'account-a')), prepare('DELETE FROM users WHERE id=?').bind('account-a')]);
          return run();
        };
        return bound;
      } };
    };
    await rejects('AUTH', renewErsomhaLease(env, lease, 1100));
    const remaining = (await DB.prepare('SELECT expires_at FROM ersomha_leases').all()).results;
    assert.equal(remaining.length, 2);
    assert.ok(remaining.every(row => row.expires_at === lease.expiresAt), 'invalidated room cannot prolong other accounts reservations');
  } finally { DB.close(); }
});
test('a fresh room preserves account history after release, and account deletion removes only its private records', async () => {
  const DB = createLocalD1(); try {
    await users(DB); const env = { DB }, room = roomFor(), lease = await acquireErsomhaLease(env, room, 1000), cards = buildErsomhaChoices();
    await exposeErsomhaCards(env, lease, cards, ['account-a'], 'original:choice', { now: 1100 });
    await releaseErsomhaLease(env, lease, 1200);
    const next = await acquireErsomhaLease(env, roomFor(), 1300); assert.equal((await ersomhaSeen(env, next)).length, 3);
    const statements = await ersomhaDeleteStatements(env, 'account-a'); await DB.batch(statements);
    assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM ersomha_seen WHERE account_hash=?').bind(await ersomhaAccountHash('account-a')).first()).n, 0);
    assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM ersomha_leases').first()).n, 2);
  } finally { DB.close(); }
});
const cardPool = counts => Object.entries(counts).flatMap(([category, count]) => Array.from({ length: count }, (_, n) => ({ id: `${category}-${n}`, conceptId: `${category}-${n}`, familyId: `${category}-${n}`, category, difficulty: 'medium', answer: `${category} ${n}`, aliases: [] })));
test('full-match preflight rejects a pool that offers one turn but cannot supply every later turn', () => {
  const insufficient = cardPool({ animals: 4, food: 1, home: 1 });
  assert.equal(new Set(insufficient.map(c => c.category)).size, 3);
  assert.deepEqual(buildErsomhaTurnPlan(insufficient, 2), []);
  const pool = cardPool({ animals: 2, food: 2, home: 2, nature: 1 });
  pool.push({ ...pool[0], id: 'shared-alternative', conceptId: 'shared-alternative', category: 'nature' });
  const plan = buildErsomhaTurnPlan(pool, 2); assert.equal(plan.length, 2);
  assert.ok(plan.every(cards => cards.length === 3 && new Set(cards.map(c => c.category)).size === 3));
  assert.equal(new Set(plan.flat().map(c => c.familyId)).size, 6, 'cross-category synonyms never consume a second slot');
});
test('preflight handles imbalanced categories without false greedy exhaustion through sixteen turns', () => {
  for (let turns = 2; turns <= 16; turns++) for (let seed = 0; seed < 10; seed++) {
    const counts = Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f'].map((category, n) => [category, (n * 7 + seed * 3) % (turns + 3)]));
    const possible = Object.values(counts).reduce((sum, n) => sum + Math.min(turns, n), 0) >= turns * 3;
    const plan = buildErsomhaTurnPlan(cardPool(counts), turns);
    assert.equal(plan.length === turns, possible, JSON.stringify({ turns, counts }));
    if (possible) assert.ok(plan.every(cards => cards.length === 3 && new Set(cards.map(c => c.category)).size === 3));
  }
});
test('explicit recycling prefers a completely fresh plan, then the least seen older families without within-match repeats', () => {
  const pool = cardPool({ a: 3, b: 3, c: 3 });
  const seen = pool.filter(c => !c.id.endsWith('-0')).map(c => ({ family_id: c.familyId, concept_id: c.conceptId, seen_count: c.id.endsWith('-1') ? 1 : 5, seen_at: 1000, exposure_id: 'old' }));
  assert.deepEqual(buildErsomhaTurnPlan(pool, 2, { seen }), []);
  const replay = buildErsomhaTurnPlan(pool, 2, { seen, allowReplay: true }); assert.equal(replay.length, 2);
  assert.ok(replay.flat().every(c => !c.id.endsWith('-2')), 'the heavily repeated alternatives are not chosen over unseen/less-seen families');
  const enoughFresh = cardPool({ a: 3, b: 3, c: 3, d: 3 });
  const old = enoughFresh.filter(c => ['a', 'd'].includes(c.category)).map(c => ({ family_id: c.familyId, concept_id: c.conceptId, seen_count: 1, seen_at: 1000 }));
  // Two remaining categories cannot fill three distinct categories per turn.
  assert.deepEqual(buildErsomhaTurnPlan(enoughFresh, 2, { seen: old }), []);
  const freshPlan = buildErsomhaTurnPlan(cardPool({ a: 3, b: 3, c: 3, d: 3 }), 2, { seen: old.filter(c => c.family_id.startsWith('d')), allowReplay: true });
  assert.ok(freshPlan.flat().every(c => c.category !== 'd'));
});
