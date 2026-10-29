import test from 'node:test';
import assert from 'node:assert/strict';
import { localEnvironment } from '../server/local.mjs';
import { createUser, deleteUser } from '../server/accounts/db.mjs';
import { persistMafiaProgress, mafiaProgressStatements, mafiaProgressDeleteStatements } from '../server/mafia-progression.mjs';
import { readMafiaAchievements, readMafiaRewardAchievements } from '../server/mafia-achievements.mjs';
import { cleanupMafia } from '../server/mafia-access.mjs';
import { MAFIA_ROLES } from '../src/online/mafia-shared.js';
import { MAFIA_ACHIEVEMENT_LIST, getMafiaAchievement } from '../src/profiles/mafia-catalog.js';
import { getCosmetic } from '../src/plus/catalog.js';

const NOW = Date.now();
const tables = ['mafia_progress_events', 'mafia_player_progress', 'mafia_role_progress', 'mafia_achievements', 'mafia_cosmetic_grants'];
async function setup(t) {
  const runtime = localEnvironment({ vars: { MAFIA_ENABLED: '1', MAFIA_PROGRESS_ENABLED: '1' } }); t.after(() => runtime.dispose());
  const id = (await createUser(runtime.env, { name: 'Synthetic achievements' })).id;
  return { env: runtime.env, id, count: async table => (await runtime.env.DB.prepare(`SELECT COUNT(*) n FROM ${table}`).first()).n };
}
function event(id, { roleId = 'citizen', faction = MAFIA_ROLES[roleId].faction, won = false, draw = false, forfeited = false, visibility = 'public' } = {}) {
  return { eventSchemaVersion: 1, eventKind: 'match_completed', source: 'live', rewardPolicyVersion: 1,
    key: `ach:${crypto.randomUUID()}`, eventId: `online:${crypto.randomUUID()}`, rulesetVersion: 1,
    startedAt: NOW - 240_000, finishedAt: NOW - 31_000, notBefore: NOW - 1000,
    mode: 'shadow', visibility, capacity: 12, participantCount: 12, draw,
    results: [{ userId: id, roleId, initialFaction: MAFIA_ROLES[roleId].faction, faction, won, forfeited, eliminatedAt: null }] };
}

test('curated rewards are existing profile cosmetics and the 30-second receipt gate also gates achievements', async t => {
  const h = await setup(t);
  assert.equal(getMafiaAchievement('__proto__'), null);
  const rewards = MAFIA_ACHIEVEMENT_LIST.filter(value => value.cosmeticItemId).map(value => getCosmetic(value.cosmeticItemId));
  assert.equal(rewards.length, 3); assert.ok(rewards.every(item => ['frame', 'nameColor', 'cover'].includes(item.kind)));
  const early = event(h.id); early.finishedAt = Date.now(); early.notBefore = early.finishedAt + 30_000;
  await assert.rejects(persistMafiaProgress(h.env, early), { code: 'MAFIA_PROGRESS_PENDING' });
  for (const table of tables) assert.equal(await h.count(table), 0);
});

test('qualified receipt facts award final-faction wins and three distinct roles/factions, once', async t => {
  const h = await setup(t), converted = event(h.id, { roleId: 'doctor', faction: 'shadow', won: true });
  await persistMafiaProgress(h.env, converted);
  let result = await readMafiaAchievements(h.env, h.id);
  assert.deepEqual(result.earned.map(value => value.id).sort(), ['mafia_first_qualified', 'mafia_win_shadow']);
  assert.equal(result.grants[0].itemId, 'noir.frame');
  const first = await readMafiaRewardAchievements(h.env, h.id, converted.key);
  assert.equal(first.achievements.length, 2); assert.equal(first.grants.length, 1);
  assert.ok(first.achievements.every(value => value.label && value.description)); assert.equal(first.grants[0].kind, 'frame');
  assert.deepEqual(await readMafiaRewardAchievements(h.env, h.id, converted.key), first);
  await persistMafiaProgress(h.env, event(h.id, { roleId: 'citizen', won: true }));
  const third = event(h.id, { roleId: 'mafia', won: true }); await persistMafiaProgress(h.env, third);
  await persistMafiaProgress(h.env, converted); await persistMafiaProgress(h.env, third);
  result = await readMafiaAchievements(h.env, h.id);
  assert.equal(result.earned.length, 6); assert.equal(result.grants.length, 3);
  assert.deepEqual(result.grants.map(value => value.itemId).sort(), ['noir.cover', 'noir.frame', 'noir.nameColor']);
  const unlocks = await readMafiaRewardAchievements(h.env, h.id, third.key);
  assert.deepEqual(unlocks.grants.map(value => value.itemId).sort(), ['noir.cover', 'noir.nameColor']);
  assert.equal((await readMafiaRewardAchievements(h.env, 'other-user', third.key)).achievements.length, 0);
  assert.equal((await h.env.DB.prepare("SELECT earned_match_key FROM mafia_achievements WHERE achievement_id='mafia_first_qualified'").first()).earned_match_key, converted.key);
});

test('legacy, forfeited wins and private matches beyond the quota cannot advance achievements', async t => {
  const h = await setup(t), legacy = { ...event(h.id), source: 'legacy', rewardPolicyVersion: null, startedAt: null, visibility: null, participantCount: null };
  await h.env.DB.batch(await mafiaProgressStatements(h.env, legacy, { legacy: true }));
  await persistMafiaProgress(h.env, event(h.id, { roleId: 'mafia', won: true, forfeited: true }));
  assert.equal(await h.count('mafia_achievements'), 0); assert.equal(await h.count('mafia_cosmetic_grants'), 0);
  for (let i = 0; i < 3; i++) await persistMafiaProgress(h.env, event(h.id, { visibility: 'private' }));
  await persistMafiaProgress(h.env, event(h.id, { roleId: 'mafia', won: true, visibility: 'private' }));
  assert.deepEqual((await readMafiaAchievements(h.env, h.id)).earned.map(value => value.id), ['mafia_first_qualified']);
});

test('a grant failure rolls receipt, XP, achievements and licenses back in one transaction', async t => {
  const h = await setup(t), value = event(h.id);
  await h.env.DB.exec("CREATE TRIGGER fail_grant BEFORE INSERT ON mafia_cosmetic_grants BEGIN SELECT RAISE(ABORT,'grant failure'); END;");
  await assert.rejects(persistMafiaProgress(h.env, value), /grant failure/);
  for (const table of tables) assert.equal(await h.count(table), 0);
  await h.env.DB.exec('DROP TRIGGER fail_grant;'); await persistMafiaProgress(h.env, value);
  assert.equal(await h.count('mafia_progress_events'), 1); assert.equal(await h.count('mafia_cosmetic_grants'), 1);
  assert.equal((await h.env.DB.prepare('SELECT total_xp FROM mafia_player_progress').first()).total_xp, 50);
});

test('license revocation survives retries and later matches; cleanup preserves awards while account deletion removes them', async t => {
  const h = await setup(t), value = event(h.id);
  await persistMafiaProgress(h.env, value);
  await h.env.DB.prepare('UPDATE mafia_cosmetic_grants SET revoked_at=? WHERE user_id=?').bind(NOW, h.id).run();
  await persistMafiaProgress(h.env, value);
  const later = event(h.id); await persistMafiaProgress(h.env, later);
  assert.equal((await readMafiaAchievements(h.env, h.id)).grants.length, 0);
  assert.equal((await readMafiaRewardAchievements(h.env, h.id, later.key)).achievements.length, 0);
  await cleanupMafia(h.env, NOW + 31 * 86_400_000);
  assert.equal(await h.count('mafia_achievements'), 1); assert.equal(await h.count('mafia_cosmetic_grants'), 1);
  const deletes = mafiaProgressDeleteStatements(h.env, h.id).map(statement => statement.sql).join('\n');
  assert.match(deletes, /mafia_achievements/); assert.match(deletes, /mafia_cosmetic_grants/); assert.match(deletes, /mafia_profile_preferences/);
  await deleteUser(h.env, h.id);
  for (const table of tables) assert.equal(await h.count(table), 0);
  await persistMafiaProgress(h.env, value);
  for (const table of tables) assert.equal(await h.count(table), 0);
});
