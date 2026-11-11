import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalD1, LocalD1, migrationStatements } from '../server/local-d1.mjs';
import { routeRequest } from '../server/worker.mjs';
import { issueSession } from '../server/accounts/session.mjs';
import { rewardedStatus, issueRewardedAttempt } from '../server/rewarded/attempts.mjs';
import { startRewardedLocalMatch, reserveRewardedMatch, commitRewardedMatch, rewardedAccess } from '../server/rewarded/ledger.mjs';
import { gameplayAccessDescriptor } from '../server/rewarded/settings.mjs';
import { GAMEPLAY_OFFERS, TICKET_POLICY } from '../src/shared/account/gameplay-policy.mjs';

const origin = 'http://127.0.0.1:4182';
function setup(t, extra = {}) {
  const DB = createLocalD1(); t.after(() => DB.close());
  return { DB, APP_ORIGIN: origin, ALLOWED_ORIGINS: origin, AUTH_DEV_FAKE: '1',
    REWARDED_ENV: 'local', REWARDED_PREVIEW_ENABLED: '1', REWARDED_ADS_ENABLED: '1', GAMEPLAY_ACCESS_POLICY: TICKET_POLICY, ...extra };
}
async function user(env) {
  const userId = crypto.randomUUID(), now = Date.now();
  await env.DB.prepare('INSERT INTO users(id,created_at,updated_at) VALUES(?,?,?)').bind(userId,now,now).run();
  return { userId, ...await issueSession(env,userId,'web',now) };
}
const claim = (userId, offer) => ({ userId, offer, matchId: crypto.randomUUID() });
async function get(env, path, token) {
  return routeRequest(new Request((env.REWARDED_ORIGIN || env.APP_ORIGIN) + path, {
    headers: { origin: env.REWARDED_ORIGIN || env.APP_ORIGIN, ...(token && { authorization: 'Bearer ' + token }) },
  }), env, {});
}

test('all six actual local engines have first full match, strict second gate, idempotent replay and real Plus', async t => {
  const env = setup(t);
  for (const offer of GAMEPLAY_OFFERS.filter(item => item.mode === 'local')) {
    const account = await user(env), first = claim(account.userId, offer.id);
    assert.equal((await rewardedStatus(env, account.userId, offer.id, 'web')).group, 'B');
    assert.equal((await startRewardedLocalMatch(env, first)).source, 'trial', offer.id);
    assert.deepEqual(await startRewardedLocalMatch(env, first), { matchId: first.matchId, source: 'trial', state: 'committed' });
    await assert.rejects(startRewardedLocalMatch(env, claim(account.userId, offer.id)), { code: 'REWARDED_REQUIRED' });
    await env.DB.prepare(`INSERT INTO subscriptions(source,external_id,user_id,status,until,updated_at) VALUES('promo',?,?,'active',?,?)`)
      .bind(crypto.randomUUID(),account.userId,Date.now()+86_400_000,Date.now()).run();
    assert.equal((await startRewardedLocalMatch(env, claim(account.userId, offer.id))).source, 'plus');
  }
});

test('local and online compete for one account/game trial; one wins and neither invents a ticket', async t => {
  const env = setup(t), account = await user(env);
  const starts = await Promise.allSettled([
    startRewardedLocalMatch(env, claim(account.userId,'fabraka-local')),
    reserveRewardedMatch(env, claim(account.userId,'fabraka-online')),
  ]);
  assert.equal(starts.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM rewarded_match_claims WHERE user_id=? AND game_key='fabraka' AND source='trial'").bind(account.userId).first()).n, 1);
});

test('legacy duplicate per-mode trials survive additive migration and do not reopen a trial', async t => {
  const DB = new LocalD1(); t.after(() => DB.close());
  const statements = migrationStatements(), at = statements.findIndex(sql => sql === 'ALTER TABLE rewarded_match_claims ADD COLUMN game_key TEXT;');
  assert.ok(at > 0);
  for (const sql of statements.slice(0,at)) DB.database.exec(sql);
  const env = { ...setup(t), DB }, account = await user(env);
  for (const offer of ['fabraka-local','fabraka-online']) await DB.prepare(`INSERT INTO rewarded_match_claims
    (match_id,environment,user_id,offer,source,state,updated_at) VALUES(?,'local',?,?,'trial','committed',?)`)
    .bind(crypto.randomUUID(),account.userId,offer,Date.now()).run();
  await DB.prepare('INSERT INTO trials(user_id,game,created_at) VALUES(?,?,?)').bind(account.userId,'beep',Date.now()).run();
  for (const sql of statements.slice(at)) DB.database.exec(sql);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM rewarded_match_claims WHERE game_key IS NULL').first()).n, 2);
  assert.equal(await rewardedAccess(env,account.userId,'fabraka-local'), 'required');
  assert.equal(await rewardedAccess(env,account.userId,'fabraka-online'), 'required');
  assert.equal(await rewardedAccess(env,account.userId,'beep-local'), 'required');
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM trials').first()).n, 1);
});

test('no-fill, skipped/unverified callbacks and disabled ads never grant a match ticket', async t => {
  const env = setup(t), account = await user(env), offer = 'jabeen-local';
  await startRewardedLocalMatch(env,claim(account.userId,offer));
  const attempt = await issueRewardedAttempt(env,account.userId,offer,'web');
  assert.equal(await rewardedAccess(env,account.userId,offer), 'required');
  await env.DB.prepare("UPDATE rewarded_attempts SET state='cancelled' WHERE id=?").bind(attempt.attemptId).run();
  assert.equal(await rewardedAccess(env,account.userId,offer), 'required');
  const disabled = { ...env, REWARDED_ADS_ENABLED: '0' };
  assert.equal((await rewardedStatus(disabled,account.userId,offer,'web')).adsAvailable, false);
  await assert.rejects(startRewardedLocalMatch(disabled, claim(account.userId,offer)), { code:'REWARDED_REQUIRED' });
  assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM rewarded_attempts WHERE state='verified'").first()).n, 0);
});

test('production ad configuration outage preserves trials, existing tickets, Plus and started settlement without failing free', async t => {
  const production = 'https://maydan-game.mf103871.workers.dev';
  const env = setup(t, { AUTH_DEV_FAKE:'0', APP_ORIGIN:'', REWARDED_ENV:'production', REWARDED_ORIGIN:production,
    ALLOWED_ORIGINS:production, REWARDED_PRODUCTION_ENABLED:'0', REWARDED_IOS_AD_UNIT:undefined,
    LIMITERS: { idFromName: value => value, get: () => ({ fetch: async () => new Response(null) }) } });
  const account = await user(env), now = Date.now();
  await env.DB.prepare("INSERT INTO identities(provider,subject,user_id,created_at) VALUES('google',?,?,?)").bind(account.userId,account.userId,now).run();
  assert.equal(gameplayAccessDescriptor(env).policy, TICKET_POLICY);
  assert.equal(gameplayAccessDescriptor({ GAMEPLAY_ACCESS_POLICY:TICKET_POLICY }).policy, TICKET_POLICY, 'missing DB is unavailable rather than free');
  const config = await (await get(env,'/api/billing/config',account.token)).json();
  assert.equal(config.gameplay.access,'trial-ticket');
  const first = claim(account.userId,'meenfina-online');
  assert.equal((await reserveRewardedMatch(env,first)).source,'trial');
  assert.equal((await commitRewardedMatch(env,first)).state,'committed');
  const status = await rewardedStatus(env,account.userId,'meenfina-online','ios');
  assert.equal(status.access,'required'); assert.equal(status.adsAvailable,false);
  await assert.rejects(issueRewardedAttempt(env,account.userId,'meenfina-online','ios'), { code:'REWARDED_UNAVAILABLE' });
  await env.DB.prepare(`INSERT INTO rewarded_attempts(id,environment,user_id,offer,custom_hash,ad_unit,reward_item,state,created_at,expires_at,verified_at,transaction_id)
    VALUES(?,'production',?,'meenfina-online',?,'owned','match ticket','verified',?,?,?,?)`).bind(crypto.randomUUID(),account.userId,'a'.repeat(64),now,now+1000,now,crypto.randomUUID()).run();
  const ticket = claim(account.userId,'meenfina-online');
  assert.equal((await reserveRewardedMatch(env,ticket)).source,'ticket');
  assert.equal((await commitRewardedMatch(env,ticket)).state,'committed');
  assert.equal(await rewardedAccess(env,account.userId,'meenfina-online'),'required');
  assert.equal(gameplayAccessDescriptor({ ...env,GAMEPLAY_ACCESS_POLICY:undefined }).access,'free');
});
