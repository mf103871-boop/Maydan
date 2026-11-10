import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { issueSession } from '../server/accounts/session.mjs';
import { createLocalD1 } from '../server/local-d1.mjs';
import { routeRequest } from '../server/worker.mjs';
import { routeLocalReward } from '../server/rewarded/local-simulator.mjs';
import { verifyAdMobCallback } from '../server/rewarded/admob-ssv.mjs';
import { issueRewardedAttempt, rewardedGroup, SAMPLE_IOS_REWARDED_UNIT } from '../server/rewarded/attempts.mjs';
import { commitRewardedMatch, releaseRewardedMatch, reserveRewardedMatch, rewardedAccess, rewardedMatchClaim } from '../server/rewarded/ledger.mjs';
import { rewardedPreviewUserHash, REWARDED_PREVIEW_QA_UNIT } from '../server/rewarded/settings.mjs';
import { sha256 } from '../server/protocol.mjs';

const localOrigin = 'http://127.0.0.1:4182';
const previewOrigin = 'https://maydan-mafia-preview.mf103871.workers.dev';
const productionOrigin = 'https://maydan-game.mf103871.workers.dev';
const ownedUnit = 'ca-app-pub-1234567890123456/2312485313';
const ownedUnitSuffix = ownedUnit.split('/')[1];
const offer = 'badeeha-demo';
const now = Date.now();
async function account(env, group, client = 'web') {
  let userId;
  do { userId = crypto.randomUUID(); } while (await rewardedGroup(userId) !== group);
  await env.DB.prepare('INSERT INTO users (id,created_at,updated_at) VALUES (?,?,?)').bind(userId, now, now).run();
  if (client === 'ios') await env.DB.prepare("INSERT INTO identities (provider,subject,user_id,created_at) VALUES ('apple',?,?,?)").bind(userId,userId,now).run();
  return { userId, ...await issueSession(env,userId,client,now) };
}

function setup(t, ios = false) {
  const DB = createLocalD1();
  t.after(() => DB.close());
  const origin = ios ? previewOrigin : localOrigin;
  return { DB, REWARDED_ENV: ios ? 'ios-preview' : 'local', APP_ORIGIN: origin, ALLOWED_ORIGINS: origin,
    AUTH_DEV_FAKE: ios ? '0' : '1', REWARDED_PREVIEW_ENABLED: '1', REWARDED_ADS_ENABLED: '1', REWARDED_SSV_KEYS: 'test' };
}
function hosted(t, production = false) {
  const APP_ORIGIN = production ? productionOrigin : previewOrigin;
  return { ...setup(t, true), APP_ORIGIN: production ? '' : APP_ORIGIN,
    ...(production && { REWARDED_ORIGIN: productionOrigin }), ALLOWED_ORIGINS: APP_ORIGIN + ',maydan://app',
    REWARDED_ENV: production ? 'production' : 'ios-preview', REWARDED_PRODUCTION_ENABLED: '1',
    REWARDED_IOS_AD_UNIT: ownedUnit, REWARDED_SSV_KEYS: 'production',
    LIMITERS: { idFromName: value => value, get: () => ({ fetch: async () => new Response(null) }) } };
}

function req(env, path, user, data, extraHeaders = {}) {
  const origin = env.REWARDED_ENV === 'production' ? productionOrigin : env.APP_ORIGIN;
  return new Request(origin + path, { method: data === undefined ? 'GET' : 'POST',
    headers: { origin, ...(user && { authorization: 'Bearer ' + user.token }),
      ...(data !== undefined && { 'content-type': 'application/json' }), ...extraHeaders },
    body: data === undefined ? undefined : JSON.stringify(data) });
}
const api = (env, path, user, data) => routeRequest(req(env, '/api/rewarded/' + path, user, data), env, {});
const status = async (env, user, target = offer) => (await api(env, 'status?offer=' + target, user)).json();
const match = (userId, target = offer) => ({ userId, offer: target, matchId: crypto.randomUUID() });
const localStart = (env, user, id = crypto.randomUUID()) => api(env, 'local-start', user, { offer, matchId: id });
const show = (env, user) => api(env, 'attempt', user, { offer });
const simulated = (env, user, attemptId) => routeLocalReward(req(env, '/__rewarded_lab__/complete', user, { attemptId }),env);

test('rewarded configuration is fenced to the preview and the simulator stays out of the Worker', async t => {
  const env = setup(t);
  const config = await api(env, 'config');
  assert.equal(config.status,200);
  assert.deepEqual((await config.json()).offers.map(o => [o.id,o.game,o.mode]),
    [['badeeha-demo','badeeha','local'],['meenfina-demo','meenfina','online']]);
  assert.equal((await api({...env, REWARDED_PREVIEW_ENABLED:'0'}, 'config')).status,404);
  assert.equal((await api({...env, PADDLE_ENV:'production'}, 'config')).status,404);
  const wrongHost = {...env, APP_ORIGIN:'https://maydan-game.example', ALLOWED_ORIGINS:'https://maydan-game.example'};
  assert.equal((await api(wrongHost, 'config')).status,404);
  assert.equal((await api(env, 'status?offer=' + offer)).status,401);
  const user = await account(env,'B');
  assert.equal((await api(env, 'status?offer=mafia',user)).status,404);
  assert.equal((await api(env,'local-start',user,{offer:'meenfina-demo',matchId:crypto.randomUUID()})).status,404);
  assert.equal((await routeRequest(req(env,'/__rewarded_lab__/complete',user,{attemptId:crypto.randomUUID()}),env,{})).status,404);
  assert.equal((await routeLocalReward(req(env,'/__rewarded_lab__/complete',user,{attemptId:crypto.randomUUID()},{origin:'https://evil.example'}),env)).status,404);
  assert.equal((await api(env,'ssv')).status,404);
});

test('stable A/B, first server-confirmed trial, actual Plus, and no second trial from another device', async t => {
  const env = setup(t);
  const a = await account(env,'A');
  const secondDevice = {...a, ...await issueSession(env,a.userId,'web',now)};
  assert.equal((await status(env,a)).group,'A');
  assert.equal((await status(env,secondDevice)).adsAvailable,false);
  assert.equal((await status(env,a)).access,'trial');
  const matchId = crypto.randomUUID();
  const starts = await Promise.all([localStart(env,a,matchId),localStart(env,secondDevice)]);
  const ok = starts.find(response => response.ok);
  const result = await ok.json();
  assert.equal(result.source,'trial');
  assert.equal(starts.filter(response => response.ok).length,1);
  assert.deepEqual(await (await localStart(env,a,result.matchId)).json(),result);
  assert.equal((await show(env,a)).status,404);
  assert.equal((await status(env,a)).access,'required');

  await env.DB.prepare(`INSERT INTO subscriptions (source,external_id,user_id,status,until,environment,updated_at)
    VALUES ('apple','sub',?,'active',?,'Sandbox',?)`).bind(a.userId,now + 60_000,now).run();
  assert.equal((await status(env,a)).access,'plus');
  assert.equal((await (await localStart(env,a)).json()).source,'plus');
  assert.equal((await status(env,a,'meenfina-demo')).access,'plus');
  await env.DB.prepare("UPDATE subscriptions SET status='revoked' WHERE external_id='sub'").run();
  assert.equal((await status(env,a,'meenfina-demo')).access,'trial');
});

test('loopback native mode exposes the sample ad only to the app origin and cannot simulate a grant', async t => {
  const env = { ...setup(t), REWARDED_LOCAL_NATIVE:'1', ALLOWED_ORIGINS: localOrigin + ',maydan://app' };
  const user = await account(env,'B','ios');
  assert.equal((await (await api(env,'config')).json()).mode,'native');
  assert.equal((await localStart(env,user)).status,200);
  assert.equal((await show(env,user)).status,404);
  const nativeAttempt = req(env, '/api/rewarded/attempt',user,{offer},{origin:'maydan://app'});
  const response = await routeRequest(nativeAttempt,env,{});
  assert.equal(response.status,201);
  const attempt = await response.json();
  assert.equal(attempt.mode,'native');
  assert.equal(attempt.adUnit,SAMPLE_IOS_REWARDED_UNIT);
  assert.equal((await simulated(env,user,attempt.attemptId)).status,404);
  assert.equal((await status(env,user)).access,'required');
  assert.equal((await status(env,user)).attempt,'pending');
});

test('owned units are opt-in and native-only, with exact deployment origin and no sample publisher in production', async t => {
  const env = hosted(t, true);
  const user = await account(env, 'B', 'ios');
  assert.equal((await api({ ...env, REWARDED_PRODUCTION_ENABLED: undefined }, 'config')).status, 404);
  assert.equal((await api({ ...env, REWARDED_IOS_AD_UNIT: SAMPLE_IOS_REWARDED_UNIT }, 'config')).status, 404);
  assert.equal((await api({ ...env, REWARDED_IOS_AD_UNIT: 'ca-app-pub-3940256099942544/2312485313' }, 'config')).status, 404);
  assert.equal((await api({ ...env, REWARDED_SSV_KEYS: 'test' }, 'config')).status, 404);
  assert.equal((await api({ ...env, AUTH_DEV_FAKE: '1' }, 'config')).status, 404);
  const wrongOrigin = 'https://untrusted.example';
  assert.equal((await api({ ...env, APP_ORIGIN: productionOrigin, REWARDED_ORIGIN: undefined }, 'config')).status, 404);
  assert.equal((await api({ ...env, REWARDED_ORIGIN: wrongOrigin }, 'config')).status, 404);
  assert.equal((await api({ ...env, REWARDED_ORIGIN: productionOrigin + '/' }, 'config')).status, 404);
  assert.equal((await api(env, 'config')).status, 200);
  const otherWorker = new Request(wrongOrigin + '/api/rewarded/config', { headers: { origin: wrongOrigin } });
  assert.equal((await routeRequest(otherWorker, { ...env, ALLOWED_ORIGINS: wrongOrigin }, {})).status, 404);
  assert.equal((await localStart(env, user)).status, 200);
  assert.equal((await show(env, user)).status, 404);
  const request = req(env, '/api/rewarded/attempt', user, { offer }, { origin: 'maydan://app' });
  const response = await routeRequest(request, env, {});
  assert.equal(response.status, 201);
  const attempt = await response.json();
  assert.equal(attempt.adUnit, ownedUnit);
  assert.equal(attempt.mode, 'native');
  assert.equal((await simulated(env, user, attempt.attemptId)).status, 404);
});

test('an existing production reservation can settle after the feature is closed', async t => {
  const env = hosted(t, true);
  const user = await account(env, 'B', 'ios');
  const reservation = match(user.userId);
  assert.equal((await reserveRewardedMatch(env, reservation)).state, 'reserved');
  const disabled = { ...env, REWARDED_PRODUCTION_ENABLED: '0' };
  assert.equal((await api(disabled, 'config')).status, 404);
  await assert.rejects(reserveRewardedMatch(disabled, match(user.userId)), { code: 'REWARDED_UNAVAILABLE' });
  assert.equal((await commitRewardedMatch(disabled, reservation)).state, 'committed');
});

test('cancel, account isolation, duplicate confirmation, and five same-day ticket/match cycles', async t => {
  const env = setup(t);
  const user = await account(env,'B');
  const another = await account(env,'B');
  assert.equal((await localStart(env,user)).status,200);
  const pending = await (await show(env,user)).json();
  assert.equal((await api(env,`attempt/${pending.attemptId}/cancel`,user,{})).status,200);
  assert.equal((await simulated(env,user,pending.attemptId)).status,409);
  for (let index=0; index<5; index++) {
    const attempts = await Promise.all([show(env,user),show(env,user)]);
    assert.deepEqual(attempts.map(response => response.status).sort(),[201,409]);
    const attempt = await attempts.find(response => response.status === 201).json();
    assert.match(attempt.customData,/^[a-f\d]{64}$/);
    assert.equal((await simulated(env,another,attempt.attemptId)).status,404);
    const disabled = {...env, REWARDED_ADS_ENABLED:'0'};
    assert.equal((await simulated(disabled,user,attempt.attemptId)).status,200);
    assert.equal((await simulated(disabled,user,attempt.attemptId)).status,200);
    assert.equal((await status(disabled,user)).access,'ticket');
    assert.equal((await status(disabled,user)).adsAvailable,false);
    assert.equal((await show(env,user)).status,409);
    const matches = await Promise.all([localStart(disabled,user),localStart(disabled,user)]);
    assert.equal(matches.filter(response => response.ok).length,1);
    assert.equal((await matches.find(response => response.ok).json()).source,'ticket');
    assert.equal((await status(env,user)).access,'required');
  }
  const tickets = await env.DB.prepare("SELECT COUNT(*) AS total FROM rewarded_attempts WHERE state='verified'").first();
  assert.equal(tickets.total,5);
});

test('released reservations restore the exact right and fence late writes; committed matches cannot be refunded', async t => {
  const env = setup(t);
  const user = await account(env,'B');
  const first = match(user.userId);
  assert.equal((await reserveRewardedMatch(env,first)).source,'trial');
  assert.equal(await rewardedAccess(env,user.userId,offer),'busy');
  assert.equal((await releaseRewardedMatch(env,first)).state,'released');
  await assert.rejects(reserveRewardedMatch(env,first), {code:'REWARDED_BUSY'});
  const unknown = match(user.userId);
  assert.equal((await releaseRewardedMatch(env,unknown)).source,null);
  await assert.rejects(reserveRewardedMatch(env,unknown), {code:'REWARDED_BUSY'});
  const valid = match(user.userId);
  assert.equal((await reserveRewardedMatch(env,valid)).source,'trial');
  assert.equal((await commitRewardedMatch(env,valid)).state,'committed');
  assert.equal((await releaseRewardedMatch(env,valid)).state,'committed');
  assert.equal(await rewardedAccess(env,user.userId,offer),'required');
  await env.DB.prepare('DELETE FROM users WHERE id=?').bind(user.userId).run();
  assert.equal(await rewardedMatchClaim(env,valid),null);
  assert.equal((await commitRewardedMatch(env,valid)).state,'erased');
});

const sampleKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const setupKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const keyId = '2865693322';
const timestamp = String(now);
const txn = () => crypto.randomUUID().replaceAll('-','');
function signedCallback(customData, changes = {}, origin = previewOrigin, key = sampleKey) {
  const fields = { ad_network:'5450213213289855', ad_unit:'1712485313', custom_data:customData,
    reward_amount:'1', reward_item:'match ticket', timestamp, transaction_id:txn(), ...changes };
  const raw = Object.entries(fields).map(([key,value]) => key + '=' + encodeURIComponent(value)).join('&');
  const der = sign('sha256',Buffer.from(decodeURIComponent(raw)),key.privateKey).toString('base64url');
  return `${origin}/api/rewarded/ssv?${raw}&signature=${der}&key_id=${keyId}`;
}

test('AdMob setup challenge accepts authentic callbacks without minting and cannot use test keys for real tickets', async t => {
  const env = hosted(t, true);
  const user = await account(env, 'B', 'ios');
  assert.equal((await localStart(env, user)).status, 200);
  const attempt = await issueRewardedAttempt(env, user.userId, offer, 'ios', now);
  const challenge = 'd'.repeat(64);
  const setup = { ...env, REWARDED_ADS_ENABLED: '0', REWARDED_SSV_SETUP_TOKEN_SHA256: await sha256(challenge) };
  t.mock.method(globalThis, 'fetch', async url => {
    assert.match(url, /^https:\/\/www\.gstatic\.com\/admob\/reward\/verifier-keys(?:-test)?\.json$/);
    const key = url.endsWith('-test.json') ? setupKey : sampleKey;
    return Response.json({ keys: [{ keyId: Number(keyId), base64: key.publicKey.export({ type: 'spki', format: 'der' }).toString('base64') }] });
  });
  const callback = (token, changes = {}, key = setupKey, worker = setup) =>
    routeRequest(new Request(signedCallback(token, { ad_unit: ownedUnitSuffix, ...changes }, productionOrigin, key)), worker, {});

  assert.equal((await callback(challenge, { ad_unit: '1111111111' })).status, 400);
  const aliasCallback = signedCallback(challenge, { ad_unit: ownedUnitSuffix }, 'https://untrusted.example', setupKey);
  assert.equal((await routeRequest(new Request(aliasCallback), setup, {})).status, 404);
  assert.equal((await callback(challenge, { timestamp: String(now - 600_000) })).status, 409);
  assert.deepEqual(await (await callback(challenge)).json(), { verified: true, mode: 'setup' });
  assert.deepEqual(await (await callback(challenge, {}, sampleKey)).json(), { verified: true, mode: 'setup' });
  assert.equal((await callback(challenge, {}, sampleKey, env)).status, 404);
  assert.equal((await callback(attempt.customData)).status, 400);
  assert.equal((await status(env, user)).access, 'required');
  assert.deepEqual(await (await callback(attempt.customData, {}, sampleKey)).json(), { verified: true });
  assert.equal((await status(env, user)).access, 'ticket');
});

test('sample-only hosted TestFlight can show a demo unit without enabling real settlement', async t => {
  const env = setup(t, true);
  const user = await account(env, 'A', 'ios');
  assert.equal((await api(env, 'config')).status, 404);
  env.REWARDED_PREVIEW_USER_SHA256 = await rewardedPreviewUserHash(user.userId);
  assert.equal((await status(env, user)).group, 'B');
  assert.equal((await localStart(env, user)).status, 200);
  const attempt = await issueRewardedAttempt(env, user.userId, offer, 'ios', now);
  assert.equal(attempt.adUnit, SAMPLE_IOS_REWARDED_UNIT);
  const callback = new Request(signedCallback(attempt.customData));
  assert.equal((await routeRequest(callback, env, {})).status, 404);
  assert.equal((await status(env, user)).access, 'required');
});

test('Google Dashboard placeholders are accepted only in expiring preview setup and never grant a ticket', async t => {
  const env = { ...hosted(t), REWARDED_IOS_AD_UNIT: REWARDED_PREVIEW_QA_UNIT };
  const owner = await account(env, 'A', 'ios');
  env.REWARDED_PREVIEW_USER_SHA256 = await rewardedPreviewUserHash(owner.userId);
  assert.equal((await localStart(env, owner)).status, 200);
  const attempt = await issueRewardedAttempt(env, owner.userId, offer, 'ios', now);
  const token = '1'.repeat(64);
  const setup = { ...env, REWARDED_ADS_ENABLED: '0', REWARDED_SSV_SETUP_TOKEN_SHA256: await sha256(token),
    REWARDED_SSV_SETUP_EXPIRES_AT: String(now + 60_000) };
  t.mock.method(globalThis, 'fetch', async url => {
    const key = url.endsWith('-test.json') ? setupKey : sampleKey;
    return Response.json({ keys: [{ keyId: Number(keyId), base64: key.publicKey.export({ type: 'spki', format: 'der' }).toString('base64') }] });
  });
  const unit = REWARDED_PREVIEW_QA_UNIT.split('/')[1];
  const callback = (worker, customData = token, { changes, key = sampleKey, origin = previewOrigin } = {}) =>
    routeRequest(new Request(signedCallback(customData, { ad_unit: '1234567890', transaction_id: '123456789', ...changes }, origin, key)), worker, {});
  for (const worker of [
    { ...setup, REWARDED_ADS_ENABLED: '1' }, { ...setup, REWARDED_IOS_AD_UNIT: ownedUnit },
    { ...setup, REWARDED_SSV_SETUP_EXPIRES_AT: String(now - 1) }, { ...setup, REWARDED_SSV_SETUP_EXPIRES_AT: String(now + 20 * 60_000) },
    { ...setup, REWARDED_SSV_SETUP_EXPIRES_AT: undefined },
  ]) assert.equal((await callback(worker)).status, 404);
  assert.equal((await callback(setup, 'f'.repeat(64))).status, 400);
  assert.equal((await callback(setup, token, { key: setupKey })).status, 400);
  assert.equal((await callback(setup, token, { changes: { ad_unit: REWARDED_PREVIEW_QA_UNIT } })).status, 400);
  assert.equal((await callback(setup, token, { changes: { reward_item: 'coins' } })).status, 400);
  assert.equal((await callback(setup, token, { changes: { reward_amount: '2' } })).status, 400);
  assert.equal((await callback(setup, token, { changes: { timestamp: String(now - 600_000) } })).status, 409);
  const prod = { ...setup, APP_ORIGIN: '', REWARDED_ORIGIN: productionOrigin, REWARDED_ENV: 'production' };
  assert.equal((await callback(prod, token, { origin: productionOrigin })).status, 400);
  for (let i = 0; i < 2; i++) assert.deepEqual(await (await callback(setup)).json(), { verified: true, mode: 'setup' });
  assert.equal((await callback(env)).status, 400);
  assert.equal((await callback(setup, attempt.customData, { changes: { ad_unit: unit } })).status, 400);
  assert.equal((await status(setup, owner)).access, 'required');
  assert.deepEqual(await env.DB.prepare("SELECT state,transaction_id FROM rewarded_attempts").all().then(result => result.results),
    [{ state: 'pending', transaction_id: null }]);
  const actual = await callback(setup, attempt.customData, { changes: { ad_unit: unit, transaction_id: txn() } });
  assert.deepEqual(await actual.json(), { verified: true });
  assert.equal((await status(env, owner)).access, 'ticket');
});

test('owned hosted previews enforce the chosen account hash and let a natural cohort A owner test', async t => {
  const env = hosted(t);
  const owner = await account(env, 'A', 'ios');
  const other = await account(env, 'B', 'ios');
  env.REWARDED_PREVIEW_USER_SHA256 = await rewardedPreviewUserHash(owner.userId);
  assert.equal((await api(env, 'config')).status, 401);
  assert.equal((await api(env, 'config', other)).status, 403);
  const config = await api(env, 'config', owner);
  assert.equal(config.status, 200);
  assert.equal((await config.json()).mode, 'native');
  const wrongPreview = { ...env, APP_ORIGIN: productionOrigin, ALLOWED_ORIGINS: productionOrigin,
    REWARDED_ORIGIN: previewOrigin };
  assert.equal((await api(wrongPreview, 'config', owner)).status, 404);
  assert.equal((await status(env, owner)).group, 'B');
  assert.equal((await localStart(env, owner)).status, 200);
  assert.equal((await issueRewardedAttempt(env, owner.userId, offer, 'ios', now)).adUnit, ownedUnit);
  assert.equal((await localStart(env, other)).status, 403);
  assert.equal((await status(env, other)).error, 'REWARDED_ACCOUNT');
  await assert.rejects(issueRewardedAttempt(env, other.userId, offer, 'ios', now), { code: 'REWARDED_ACCOUNT' });
  const prod = { ...env, APP_ORIGIN: '', ALLOWED_ORIGINS: productionOrigin,
    REWARDED_ENV: 'production', REWARDED_ORIGIN: productionOrigin };
  assert.equal((await status(prod, owner)).group, 'A');
  assert.equal((await status(prod, other)).group, 'B');
});

test('Google Tink query convention verifies encoded and literal-plus fields without reordering', async () => {
  const key = await crypto.subtle.importKey('spki',sampleKey.publicKey.export({type:'spki',format:'der'}),
    {name:'ECDSA',namedCurve:'P-256'},false,['verify']);
  const getKey = (tier,id) => { assert.equal(tier,'test'); assert.equal(id,keyId); return key; };
  const url = signedCallback('a'.repeat(64), {reward_item:'match ticket + test',timestamp:timestamp+'123'});
  const parsed = await verifyAdMobCallback(url,'test',getKey);
  assert.equal(parsed.rewardItem,'match ticket + test');
  assert.equal(parsed.timestamp,now);
  assert.equal((await verifyAdMobCallback(url.replace('%2B','+'),'test',getKey)).rewardItem,parsed.rewardItem);
  await assert.rejects(verifyAdMobCallback(url.replace('%20ticket','%20Ticket'),'test',getKey),{code:'REWARDED_SIGNATURE'});
  await assert.rejects(verifyAdMobCallback(url.replace(/ad_network=([^&]+)&ad_unit=([^&]+)/,'ad_unit=$2&ad_network=$1'),'test',getKey),{code:'REWARDED_SIGNATURE'});
  await assert.rejects(verifyAdMobCallback(url.replace('reward_amount=1','reward_amount=1&reward_amount=1'),'test',getKey),{code:'REWARDED_SIGNATURE'});
});

test('signed callback refuses wrong units, bad times, cross-attempt replay and grants once even with ads disabled', async t => {
  const env = hosted(t, true);
  const user = await account(env,'B','ios');
  const other = await account(env,'B','ios');
  const late = await account(env,'B','ios');
  const testKey = sampleKey.publicKey.export({type:'spki',format:'der'}).toString('base64');
  let rotated = false;
  t.mock.method(globalThis,'fetch',async (url,options) => {
    assert.equal(url,'https://www.gstatic.com/admob/reward/verifier-keys.json');
    assert.equal(options.redirect,'manual');
    if (!rotated && options.cache !== 'no-store') return Response.json({ keys:[] });
    if (!rotated) rotated = true;
    return Response.json({keys:[{keyId:Number(keyId),base64:testKey}]});
  });
  assert.equal((await localStart(env,user)).status,200);
  assert.equal((await localStart(env,other)).status,200);
  assert.equal((await localStart(env,late)).status,200);
  const attempt = await issueRewardedAttempt(env,user.userId,offer,'ios',now);
  const another = await issueRewardedAttempt(env,other.userId,offer,'ios',now);
  const lateAttempt = await issueRewardedAttempt(env,late.userId,offer,'ios',now - 16 * 60_000);
  assert.equal(attempt.adUnit,ownedUnit);
  const signed = (token, changes) => signedCallback(token, { ad_unit: ownedUnitSuffix, ...changes }, productionOrigin);
  const callback = (url,overrides={}) => routeRequest(new Request(url), {...env,...overrides}, {});
  assert.equal((await callback(signed(attempt.customData,{ad_unit:'1111111111'}))).status,400);
  assert.equal(rotated,true);
  assert.equal((await callback(signed(attempt.customData,{reward_item:'coins'}))).status,400);
  assert.equal((await callback(signed(attempt.customData,{timestamp:String(now-600_000)}))).status,409);
  const transactionId = txn();
  const valid = signed(attempt.customData,{transaction_id:transactionId});
  assert.equal((await callback(valid,{REWARDED_SSV_KEYS:'test'})).status,404);
  assert.deepEqual(await (await callback(valid,{REWARDED_ADS_ENABLED:'0'})).json(),{verified:true});
  assert.deepEqual(await (await callback(valid)).json(),{verified:true});
  assert.equal((await callback(signed(another.customData,{transaction_id:transactionId}))).status,409);
  assert.equal((await callback(signed(attempt.customData))).status,409);
  assert.equal((await callback(signed(lateAttempt.customData))).status,409);
  assert.equal((await callback(signed(lateAttempt.customData,{timestamp:String(now - 15 * 60_000)}))).status,200);
  assert.equal((await status(env,user)).access,'ticket');
  assert.equal((await status(env,other)).access,'required');
  assert.equal((await status(env,late)).access,'ticket');
});
