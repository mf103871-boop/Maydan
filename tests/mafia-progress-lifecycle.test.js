import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalD1 } from '../server/local-d1.mjs';
import { createUser, reserveAccountDeletion, deleteUser } from '../server/accounts/db.mjs';
import { cleanupMafia } from '../server/mafia-access.mjs';
import { persistMafiaResult } from '../server/mafia-results.mjs';
import { persistMafiaProgress } from '../server/mafia-progression.mjs';
import { importLegacyMafiaProgress, assertLegacyMafiaProgressCutover, MAFIA_LEGACY_IMPORT_SCOPE } from '../server/mafia-progress-legacy.mjs';

const NOW = Date.now(), DAY = 86_400_000;
const tables = ['mafia_progress_events', 'mafia_player_progress', 'mafia_role_progress'];
const contract = (now = NOW) => ({ schemaVersion: 1, scope: MAFIA_LEGACY_IMPORT_SCOPE, activationConfirmed: true,
  worker: 'maydan-mafia-preview', databaseId: 'cf5fb670-9fb5-4eeb-9717-ed76edb152e1', progressionPolicyVersion: 1,
  legacyCutoffAt: new Date(NOW - 60_000).toISOString(), progressionEnabledAt: new Date(NOW - 30_000).toISOString(), capturedAt: new Date(now).toISOString() });
async function setup(t) {
  const env = { DB: createLocalD1(), MAFIA_ENABLED: '1', MAFIA_PROGRESS_ENABLED: '1' };
  t.after(() => env.DB.close());
  const user = async () => (await createUser(env, { name: 'Synthetic progress account' })).id;
  const count = async (table, userId) => (await env.DB.prepare(`SELECT COUNT(*) n FROM ${table}${userId ? ' WHERE user_id=?' : ''}`).bind(...(userId ? [userId] : [])).first()).n;
  return { env, user, count };
}
async function archive(env, userId, { key = crypto.randomUUID(), role = 'citizen', initialFaction = 'town', faction = initialFaction,
  finishedAt = NOW - 120_000, summary = '{}', won = 0, draw = 0, forfeited = 0 } = {}) {
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO mafia_history(match_key,room_code,ruleset_version,finished_at,summary) VALUES(?,?,?,?,?)').bind(key, '123456', 1, finishedAt, summary),
    env.DB.prepare('INSERT INTO mafia_results(user_id,match_key,role_id,initial_faction,faction,won,draw,forfeited,finished_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(userId, key, role, initialFaction, faction, won, draw, forfeited, finishedAt),
  ]);
  return key;
}
function live(userId, key = crypto.randomUUID(), { won = false } = {}) {
  return { eventSchemaVersion: 1, eventKind: 'match_completed', source: 'live', rewardPolicyVersion: 1,
    key, eventId: `online:${crypto.randomUUID()}`, rulesetVersion: 1, startedAt: NOW - 360_000,
    finishedAt: NOW - 120_000, notBefore: NOW - 90_000, mode: 'classic', visibility: 'public', capacity: 8, participantCount: 6, draw: false,
    results: [{ userId, roleId: 'citizen', initialFaction: 'town', faction: 'town', won, forfeited: false, eliminatedAt: null }] };
}

test('an unconfirmed or overlapping cutover refuses before reading or mutating progress', async t => {
  const h = await setup(t); let calls = 0;
  const db = { prepare() { calls++; throw new Error('must not read'); } };
  for (const bad of [undefined, {}, { ...contract(), activationConfirmed: false }, { ...contract(), progressionEnabledAt: new Date(NOW - 90_000).toISOString() },
    { ...contract(), capturedAt: new Date(NOW - 30 * 60_000 - 1).toISOString() }, { ...contract(), capturedAt: new Date(NOW + 1).toISOString() }]) {
    await assert.rejects(importLegacyMafiaProgress({ ...h.env, DB: db }, bad, { now: NOW }), { code: 'MAFIA_LEGACY_CUTOVER_REQUIRED' });
  }
  assert.equal(calls, 0); assert.equal((assertLegacyMafiaProgressCutover(contract(), NOW)).cutoff, NOW - 60_000);
});

test('legacy dry-run is read-only and duplicate imports share a permanent XP0 receipt', async t => {
  const h = await setup(t), id = await h.user();
  await archive(h.env, id); await archive(h.env, id, { role: 'doctor' });
  const dry = await importLegacyMafiaProgress(h.env, contract(), { now: NOW });
  assert.equal(dry.dryRun, true); assert.equal(dry.selected, 2); assert.equal(dry.imported, 0);
  for (const table of tables) assert.equal(await h.count(table), 0);
  const first = await importLegacyMafiaProgress(h.env, contract(), { apply: true, now: NOW });
  assert.equal(first.imported, 2); assert.equal(first.xpAwarded, 0); assert.equal(first.masteryAwarded, 0);
  const second = await importLegacyMafiaProgress(h.env, contract(), { apply: true, now: NOW });
  assert.equal(second.imported, 0); assert.equal(second.alreadyReceipted, 2);
  const player = await h.env.DB.prepare('SELECT total_xp,rewarded_matches,legacy_matches FROM mafia_player_progress WHERE user_id=?').bind(id).first();
  assert.deepEqual(player, { total_xp: 0, rewarded_matches: 0, legacy_matches: 2 });
  const roles = (await h.env.DB.prepare('SELECT qualified_matches,wins,draws,legacy_matches FROM mafia_role_progress WHERE user_id=?').bind(id).all()).results;
  assert.deepEqual(roles, [{ qualified_matches: 0, wins: 0, draws: 0, legacy_matches: 1 }, { qualified_matches: 0, wins: 0, draws: 0, legacy_matches: 1 }]);
  const receipts = (await h.env.DB.prepare('SELECT event_kind,source,started_at,visibility,status,participation_granted,xp_awarded FROM mafia_progress_events').all()).results;
  for (const row of receipts) assert.deepEqual(row, { event_kind: 'match_completed', source: 'legacy', started_at: null, visibility: null, status: 'processed', participation_granted: 0, xp_awarded: 0 });
});

test('import never infers a role from generic events and skips unknown, modern, malformed and out-of-window archives', async t => {
  const h = await setup(t), id = await h.user();
  await h.env.DB.prepare("INSERT INTO player_events(user_id,event_id,source,game,created_at) VALUES(?,?,'online','mafia',?)").bind(id, 'online:generic-without-role', NOW - 120_000).run();
  await archive(h.env, id, { role: 'invented' });
  await archive(h.env, id, { summary: '{' });
  await archive(h.env, id, { summary: '{"rewardPolicyVersion":1}' });
  await archive(h.env, id, { summary: '{"rewardPolicyVersion":"1"}' });
  await archive(h.env, id, { finishedAt: NOW - 59_999 });
  await archive(h.env, id, { finishedAt: NOW - 30 * DAY - 1 });
  await archive(h.env, id, { finishedAt: NOW - 32 * DAY });
  const report = await importLegacyMafiaProgress(h.env, contract(), { apply: true, now: NOW });
  assert.equal(report.selected, 0); assert.equal(report.imported, 0);
  for (const table of tables) assert.equal(await h.count(table), 0);
});

test('a modern archived event keeps its live reward even when archive committed before the consumer', async t => {
  const h = await setup(t), id = await h.user(), event = live(id, undefined, { won: true });
  await archive(h.env, id, { key: event.key, summary: '{"rewardPolicyVersion":1}', won: 1 });
  assert.equal((await importLegacyMafiaProgress(h.env, contract(), { apply: true, now: NOW })).imported, 0);
  await persistMafiaProgress(h.env, event); await persistMafiaProgress(h.env, event);
  assert.equal(await h.count('mafia_progress_events'), 1);
  assert.deepEqual(await h.env.DB.prepare('SELECT total_xp,rewarded_matches,legacy_matches FROM mafia_player_progress').first(), { total_xp: 70, rewarded_matches: 1, legacy_matches: 0 });
  assert.equal((await importLegacyMafiaProgress(h.env, contract(), { apply: true, now: NOW })).imported, 0);
});

test('a modern result without any replay remains excluded by the cutover until its live consumer succeeds', async t => {
  const h = await setup(t), id = await h.user(), event = live(id);
  event.finishedAt = NOW - 45_000; event.notBefore = NOW - 15_000;
  await h.env.DB.prepare("INSERT INTO mafia_results VALUES(?,?,'citizen','town','town',0,0,0,?)").bind(id, event.key, event.finishedAt).run();
  const evidence = { ...contract(), progressionEnabledAt: contract().legacyCutoffAt };
  assert.equal((await h.env.DB.prepare('SELECT COUNT(*) n FROM mafia_history').first()).n, 0);
  assert.equal((await importLegacyMafiaProgress(h.env, evidence, { apply: true, now: NOW })).selected, 0);
  assert.equal(await h.count('mafia_progress_events'), 0);
  await persistMafiaProgress(h.env, event);
  assert.deepEqual(await h.env.DB.prepare('SELECT total_xp,rewarded_matches,legacy_matches FROM mafia_player_progress').first(), { total_xp: 50, rewarded_matches: 1, legacy_matches: 0 });
});

test('a receipt claimed by the live consumer cannot also be imported from an old-looking archive', async t => {
  const h = await setup(t), id = await h.user(), event = live(id);
  await archive(h.env, id, { key: event.key }); await persistMafiaProgress(h.env, event);
  const report = await importLegacyMafiaProgress(h.env, contract(), { apply: true, now: NOW });
  assert.equal(report.alreadyReceipted, 1); assert.equal(report.imported, 0);
  assert.equal((await h.env.DB.prepare('SELECT total_xp,legacy_matches FROM mafia_player_progress').first()).total_xp, 50);
  assert.equal((await h.env.DB.prepare('SELECT total_xp,legacy_matches FROM mafia_player_progress').first()).legacy_matches, 0);
});

test('a live claim arriving between import selection and its batch wins the same receipt without duplicate counters', async t => {
  const h = await setup(t), id = await h.user(), event = live(id);
  await archive(h.env, id, { key: event.key });
  const original = h.env.DB.batch.bind(h.env.DB); let injected = false;
  t.mock.method(h.env.DB, 'batch', async statements => {
    if (!injected) { injected = true; await persistMafiaProgress(h.env, event); }
    return original(statements);
  });
  const report = await importLegacyMafiaProgress(h.env, contract(), { apply: true, now: NOW });
  assert.equal(report.selected, 1); assert.equal(report.imported, 0);
  assert.equal(await h.count('mafia_progress_events'), 1);
  assert.deepEqual(await h.env.DB.prepare('SELECT total_xp,rewarded_matches,legacy_matches FROM mafia_player_progress').first(), { total_xp: 50, rewarded_matches: 1, legacy_matches: 0 });
});

test('a failed aggregate rolls the legacy receipt and player counter back before a safe retry', async t => {
  const h = await setup(t), id = await h.user(); await archive(h.env, id);
  await h.env.DB.exec("CREATE TRIGGER fail_legacy_role BEFORE INSERT ON mafia_role_progress BEGIN SELECT RAISE(ABORT,'injected role failure'); END;");
  await assert.rejects(importLegacyMafiaProgress(h.env, contract(), { apply: true, now: NOW }), /injected role failure/);
  for (const table of tables) assert.equal(await h.count(table), 0);
  await h.env.DB.exec('DROP TRIGGER fail_legacy_role;');
  assert.equal((await importLegacyMafiaProgress(h.env, contract(), { apply: true, now: NOW })).imported, 1);
});

test('bounded repeated import can progress across batches without rescanning claimed rows', async t => {
  const h = await setup(t), id = await h.user();
  for (let i = 0; i < 3; i++) await archive(h.env, id, { key: `bounded:${i}` });
  const first = await importLegacyMafiaProgress(h.env, contract(), { apply: true, limit: 2, now: NOW });
  assert.equal(first.imported, 2); assert.equal(first.hasMore, true);
  const second = await importLegacyMafiaProgress(h.env, contract(), { apply: true, limit: 2, now: NOW });
  assert.equal(second.imported, 1); assert.equal(second.hasMore, false); assert.equal(await h.count('mafia_progress_events'), 3);
});

test('deletion reserved after import selection prevents its receipt and preserves another player', async t => {
  const h = await setup(t), a = await h.user(), b = await h.user();
  await archive(h.env, a, { key: 'delete-race' }); await archive(h.env, b, { key: 'delete-race' });
  const original = h.env.DB.batch.bind(h.env.DB); let reserved = false;
  t.mock.method(h.env.DB, 'batch', async statements => {
    if (!reserved && statements.some(statement => statement.sql.includes('INSERT INTO mafia_progress_events'))) {
      reserved = true; await reserveAccountDeletion(h.env, a, 'race-at-batch');
    }
    return original(statements);
  });
  assert.equal((await importLegacyMafiaProgress(h.env, contract(), { apply: true, now: NOW })).imported, 1);
  for (const table of tables) { assert.equal(await h.count(table, a), 0); assert.equal(await h.count(table, b), 1); }
  await deleteUser(h.env, a);
  assert.equal((await h.env.DB.prepare('SELECT COUNT(*) n FROM mafia_history').first()).n, 0);
});

test('outbox between deletion reservation and deleteUser cannot preserve a deleted participant replay', async t => {
  const h = await setup(t), a = await h.user(), b = await h.user();
  await reserveAccountDeletion(h.env, a, 'pending-deletion');
  const event = { key: 'reserved-delete-outbox', roomCode: '123456', rulesetVersion: 1, finishedAt: NOW - 120_000,
    summary: '{"participants":["deleted-seat","other-seat"]}', draw: true,
    results: [a, b].map((id, index) => ({ userId: id, playerId: index ? 'other-seat' : 'deleted-seat', roleId: 'citizen', initialFaction: 'town', faction: 'town', won: false, forfeited: false })) };
  await persistMafiaResult(h.env, event);
  assert.equal((await h.env.DB.prepare('SELECT COUNT(*) n FROM mafia_history').first()).n, 0);
  assert.equal((await h.env.DB.prepare('SELECT COUNT(*) n FROM mafia_results WHERE user_id=?').bind(b).first()).n, 1);
  await deleteUser(h.env, a); await persistMafiaResult(h.env, event);
  assert.equal((await h.env.DB.prepare('SELECT COUNT(*) n FROM mafia_history').first()).n, 0);
});

test('31-day cleanup removes replay rows but retains progress and receipts through a late outbox retry', async t => {
  const h = await setup(t), id = await h.user(), event = live(id);
  await archive(h.env, id, { key: event.key, summary: '{"rewardPolicyVersion":1}' });
  await archive(h.env, id, { key: 'old-import' });
  await persistMafiaProgress(h.env, event); await importLegacyMafiaProgress(h.env, contract(), { apply: true, now: NOW });
  const before = await h.env.DB.prepare('SELECT total_xp,rewarded_matches,legacy_matches FROM mafia_player_progress').first();
  await cleanupMafia(h.env, NOW + 31 * DAY);
  assert.equal((await h.env.DB.prepare('SELECT COUNT(*) n FROM mafia_results').first()).n, 0);
  assert.equal((await h.env.DB.prepare('SELECT COUNT(*) n FROM mafia_history').first()).n, 0);
  assert.equal(await h.count('mafia_progress_events'), 2);
  await persistMafiaProgress(h.env, event);
  assert.deepEqual(await h.env.DB.prepare('SELECT total_xp,rewarded_matches,legacy_matches FROM mafia_player_progress').first(), before);
  assert.equal(await h.count('mafia_progress_events'), 2);
  await deleteUser(h.env, id);
  for (const table of tables) assert.equal(await h.count(table), 0);
  await persistMafiaProgress(h.env, event);
  for (const table of tables) assert.equal(await h.count(table), 0);
});
