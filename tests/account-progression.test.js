import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalD1 } from '../server/local-d1.mjs';
import { deleteUser } from '../server/accounts/db.mjs';
import { issueSession } from '../server/accounts/session.mjs';
import { accountLevel, onlineRewardPlan, progressionFor, progressionReceipt } from '../server/account-progression.mjs';
import { completeLocalSession, profileFor, recordOnlineResult, startLocalSession } from '../server/profiles/db.mjs';
import { routeProfiles } from '../server/profiles/router.mjs';
import { routePlus } from '../server/plus/router.mjs';
import { noteProgressionAction, prepareRoomStats } from '../server/room-stats.mjs';
import { canUseCosmetic, cosmeticsFor } from '../server/plus/access.mjs';

const startOfYesterday = () => (Math.floor(Date.now() / 86_400_000) - 1) * 86_400_000;
async function fixture(t) {
  const DB = createLocalD1();
  t.after(() => DB.close());
  const now = Date.now();
  for (const id of ['owner', 'other']) {
    await DB.prepare('INSERT INTO users(id,name,created_at,updated_at) VALUES(?,?,?,?)').bind(id, id, now, now).run();
    await DB.prepare('INSERT INTO social_profiles(user_id,code,created_at) VALUES(?,?,?)')
      .bind(id, id === 'owner' ? 'MDN-AAAAAAAAAA' : 'MDN-BBBBBBBBBB', now).run();
  }
  return { DB, ACCOUNT_PROGRESSION_ENABLED: '1' };
}
const result = (patch = {}) => ({
  userId: 'owner', eventId: 'online:' + crypto.randomUUID(), game: 'ersomha',
  won: true, draw: false, finishedAt: Date.now() - 60_000,
  progressionPlan: onlineRewardPlan({ game: 'ersomha', rounds: 5, settings: { mode: 'competitive' } }), ...patch,
});
async function requestOf(env, account, path, method = 'GET', body) {
  const session = await issueSession(env, account);
  return new Request('https://local.example' + path, { method, headers: {
    authorization: 'Bearer ' + session.token, ...(body ? { 'content-type': 'application/json' } : {}),
  }, ...(body ? { body: JSON.stringify(body) } : {}) });
}

test('only newly marked completion grants level experience; visitors see no XP, receipts or inventory', async t => {
  const env = await fixture(t);
  const empty = await progressionFor(env, 'owner', 'owner');
  assert.equal(empty.level, 1);
  assert.equal(empty.totalXp, 0);
  assert.deepEqual(empty.owned, []);
  assert.deepEqual(empty.nextReward, { itemId: 'progression.frame.1', level: 1 });
  await recordOnlineResult(env, result({ progressionPlan: undefined }));
  assert.equal((await progressionFor(env, 'owner', 'owner')).totalXp, 0);
  const event = result();
  assert.equal(await recordOnlineResult(env, event), true);
  assert.equal(await recordOnlineResult(env, event), false);
  // Changed reward configuration on a retry cannot settle the same match again.
  assert.equal(await recordOnlineResult(env, { ...event, progressionPlan: { ...event.progressionPlan, baseXp: 60 } }), false);
  const owner = (await profileFor(env, 'owner', 'owner')).progression;
  assert.equal(owner.totalXp, 43);
  assert.equal(owner.xpIntoLevel, 43);
  assert.equal(owner.xpForNextLevel, 100);
  assert.deepEqual(owner.mastery, [{ game: 'ersomha', completed: 1, grade: 1, maxGrade: 10 }]);
  assert.equal(owner.owned[0].itemId, 'progression.frame.1');
  assert.deepEqual(owner.nextReward, { itemId: 'progression.frame.10', level: 10 });
  assert.deepEqual((await profileFor(env, 'other', 'owner')).progression, { level: 1 });
  assert.deepEqual(await progressionReceipt(env, 'other', event.eventId), { status: 'pending', eventId: event.eventId });
  assert.deepEqual(await progressionReceipt(env, 'owner', event.eventId), {
    status: 'settled', eventId: event.eventId, source: 'online', game: 'ersomha', finishedAt: event.finishedAt,
    nextReward: { itemId: 'progression.frame.10', level: 10 },
    awardedXp: 43, totalXp: 43, ...accountLevel(43), reason: null, rewardRuleVersion: 1, rulesetVersion: 1,
  });
});

test('a D1 batch failure rolls back legacy stats and every reward projection; a lost acknowledgement still settles once', async t => {
  const env = await fixture(t);
  const event = result();
  const batch = env.DB.batch.bind(env.DB);
  env.DB.batch = statements => statements.some(s => s.sql.includes('INSERT INTO progression_cosmetic_grants'))
    ? batch([...statements, env.DB.prepare('INSERT INTO missing_table(id) VALUES(1)')]) : batch(statements);
  await assert.rejects(() => recordOnlineResult(env, event), /missing_table/);
  for (const name of ['player_events', 'progression_events', 'game_mastery', 'player_progression', 'progression_cosmetic_grants']) {
    assert.equal(await env.DB.prepare('SELECT COUNT(*) AS n FROM ' + name).first('n'), 0, name);
  }
  env.DB.batch = async statements => {
    const result = await batch(statements);
    if (statements.some(s => s.sql.includes('INSERT INTO progression_cosmetic_grants'))) throw new Error('lost response after commit');
    return result;
  };
  await assert.rejects(() => recordOnlineResult(env, event), /lost response/);
  env.DB.batch = batch;
  assert.equal(await recordOnlineResult(env, event), false);
  assert.equal((await progressionFor(env, 'owner', 'owner')).totalXp, 43);
});

test('Mafia publication waits for the original finish delay and the owner receipt contains no private faction data', async t => {
  const env = await fixture(t);
  const finishedAt = Date.now() - 300;
  const pending = result({
    game: 'mafia', finishedAt, notBefore: finishedAt + 30_000,
    progressionPlan: onlineRewardPlan({ game: 'mafia', protocol: 2, settings: { mode: 'classic', visibility: 'public' } }),
  });
  await assert.rejects(() => recordOnlineResult(env, pending), error => error.code === 'ACCOUNT_PROGRESSION_PENDING');
  assert.equal((await progressionFor(env, 'owner', 'owner')).totalXp, 0);
  assert.equal((await progressionReceipt(env, 'owner', pending.eventId)).status, 'pending');
  const end = Date.now() - 31_000;
  const complete = { ...pending, finishedAt: end, notBefore: end + 30_000 };
  await recordOnlineResult(env, complete);
  const beforePublication = await progressionReceipt(env, 'owner', complete.eventId, end + 29_999);
  assert.equal(beforePublication.status, 'pending');
  const request = await requestOf(env, 'owner', '/api/profiles/me/progression/receipts/' + encodeURIComponent(complete.eventId));
  const response = await routeProfiles(request, env);
  assert.equal(response.status, 200);
  const { receipt } = await response.json();
  assert.equal(receipt.status, 'settled');
  assert.equal(receipt.awardedXp, 65);
  assert.equal(receipt.finishedAt, end);
  assert.doesNotMatch(JSON.stringify(receipt), /faction|roleId|userId|seat/);
});

test('a passive authenticated seat still has old stats but never gains Meenfina progression', () => {
  const lobby = { game: 'meenfina', phase: 'lobby', matchId: 0 };
  const playing = { ...lobby, phase: 'vote', round: 1, rounds: 5, matchId: 1, scores: {},
    participants: ['seat-a', 'seat-b'], members: [{ id: 'seat-a', accountUserId: 'owner' }, { id: 'seat-b', accountUserId: 'other' }] };
  const now = Date.now();
  prepareRoomStats(lobby, playing, now, { accountProgressionEnabled: true });
  assert.equal(noteProgressionAction(playing, 'seat-b', { type: 'ready' }), false);
  assert.equal(noteProgressionAction(playing, 'seat-a', { type: 'vote' }), true);
  assert.equal(noteProgressionAction(playing, 'seat-a', { type: 'vote' }), false);
  assert.deepEqual(prepareRoomStats({ ...playing, phase: 'result' }, { ...playing, phase: 'over', round: 5 }, now + 30_000)
    .map(event => [event.userId, !!event.progressionPlan]), [['owner', true], ['other', false]]);
});

test('Mafia keeps qualified eliminated players, excludes forfeits, and never rewards technical aborts or old matches', () => {
  const lobby = { game: 'mafia', protocol: 2, rulesetVersion: 1, phase: 'lobby', matchId: 0 };
  const playing = { ...lobby, settings: { mode: 'classic', visibility: 'private' }, phase: 'night', matchId: 1,
    participants: ['seat-a', 'seat-b'], members: [{ id: 'seat-a', accountUserId: 'owner' }, { id: 'seat-b', accountUserId: 'other' }] };
  const start = Date.now() - 100_000;
  prepareRoomStats(lobby, playing, start, { accountProgressionEnabled: true });
  const over = { ...structuredClone(playing), phase: 'over' };
  const now = start + 60_000;
  const mafiaResult = { eventId: playing.statsMatch.eventId, finishedAt: now, notBefore: now + 30_000, draw: false, results: [
    { userId: 'owner', forfeited: false, eliminatedAt: start + 25_000, won: true },
    { userId: 'other', forfeited: true, won: false },
  ] };
  const stats = prepareRoomStats(playing, over, now, { mafiaResult });
  assert.deepEqual(stats.map(event => [event.userId, !!event.progressionPlan]), [['owner', true], ['other', false]]);
  assert.equal(stats[0].progressionPlan.winXp, 0);
  assert.deepEqual(prepareRoomStats(playing, { ...over, technicalAbort: true }, now, { mafiaResult }), []);
  delete over.statsMatch.progressionPlan;
  assert.ok(prepareRoomStats(playing, over, now, { accountProgressionEnabled: true, mafiaResult }).every(e => !e.progressionPlan));
  assert.equal(onlineRewardPlan({ game: 'mafia', protocol: 2, rulesetVersion: 2 }), null);
});

test('local hosting rewards verified elapsed sessions only and applies the cap to the original finish UTC day', async t => {
  const env = await fixture(t);
  const day = startOfYesterday();
  const oldId = await startLocalSession({ DB: env.DB }, 'owner', 'beep', day + 1000);
  await completeLocalSession(env, 'owner', oldId, day + 31_000);
  const notSupported = await startLocalSession(env, 'owner', 'ersomha', day + 2000);
  await completeLocalSession(env, 'owner', notSupported, day + 32_000);
  const sessions = [];
  for (let index = 0; index < 4; index++) {
    const startedAt = day + 60_000 * (index + 1);
    const id = await startLocalSession(env, 'owner', 'beep', startedAt);
    await assert.rejects(() => completeLocalSession(env, 'other', id, startedAt + 30_000), error => error.code === 'NOT_FOUND');
    await assert.rejects(() => completeLocalSession(env, 'owner', id, startedAt + 5000), error => error.code === 'SESSION_TOO_SHORT');
    const completion = await completeLocalSession(env, 'owner', id, startedAt + 30_000);
    sessions.push(completion.progressionEventId);
    assert.equal(completion.counted, true);
  }
  const next = await startLocalSession(env, 'owner', 'meenfina', day + 86_400_000 + 1000);
  assert.equal((await completeLocalSession(env, 'owner', next, day + 86_400_000 + 31_000)).counted, true);
  const replay = await completeLocalSession(env, 'owner', sessions[0].slice('local:'.length), Date.now());
  assert.equal(replay.counted, false);
  const profile = await profileFor(env, 'owner', 'owner');
  assert.equal(profile.progression.totalXp, 48);
  assert.equal(profile.progression.hostedSessions, 4);
  assert.equal(profile.stats.localSessions, 7, 'old hosting counters still count every valid completion');
  assert.equal(profile.stats.onlineWins, 0);
  assert.equal((await progressionReceipt(env, 'owner', sessions[3])).reason, 'local_daily_cap');
  assert.deepEqual(profile.progression.mastery, []);
});

test('earned equipment requires durable grant and survives expiry; Plus cannot equip an unearned frame', async t => {
  const env = await fixture(t);
  const now = Date.now();
  await env.DB.prepare("INSERT INTO subscriptions(source,external_id,user_id,status,until,updated_at) VALUES('apple','sub','owner','active',?,?)")
    .bind(now + 3600_000, now).run();
  const locked = await requestOf(env, 'owner', '/api/me/cosmetics', 'PATCH', { selection: { frameId: 'progression.frame.60' }, revision: 0 });
  await assert.rejects(() => routePlus(locked, env), error => error.code === 'COSMETIC_LOCKED');
  await recordOnlineResult(env, result());
  const equip = await requestOf(env, 'owner', '/api/me/cosmetics', 'PATCH', { selection: { frameId: 'progression.frame.1' }, revision: 0 });
  const response = await routePlus(equip, env);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).effective.frameId, 'progression.frame.1');
  await env.DB.prepare("UPDATE subscriptions SET status='refunded' WHERE external_id='sub'").run();
  const state = await cosmeticsFor(env, 'owner');
  assert.equal(state.plusActive, false);
  assert.equal(state.effective.frameId, 'progression.frame.1');
  assert.equal(await canUseCosmetic(env, 'owner', 'progression.frame.1'), true);
  assert.equal(await canUseCosmetic(env, 'other', 'progression.frame.1'), false);
});

test('deletion cascades across the progression ledger; delayed or replayed matches cannot recreate it', async t => {
  const env = await fixture(t);
  const event = result();
  await recordOnlineResult(env, event);
  await deleteUser(env, 'owner');
  assert.equal(await recordOnlineResult(env, event), false);
  assert.equal(await recordOnlineResult(env, result()), false);
  for (const name of ['progression_events', 'game_mastery', 'player_progression', 'progression_cosmetic_grants']) {
    assert.equal(await env.DB.prepare('SELECT COUNT(*) AS n FROM ' + name).first('n'), 0, name);
  }
  assert.equal((await progressionReceipt(env, 'owner', event.eventId)).status, 'pending');
  assert.equal(await canUseCosmetic(env, 'owner', 'progression.frame.1'), false);
});

test('levels are deterministic, capped at 100, with permanent post-cap milestones', () => {
  assert.deepEqual(accountLevel(100), { level: 2, xpIntoLevel: 0, xpForNextLevel: 105, postMaxMilestones: 0 });
  assert.deepEqual(accountLevel(35_155), { level: 100, xpIntoLevel: 1000, xpForNextLevel: null, postMaxMilestones: 1 });
});
