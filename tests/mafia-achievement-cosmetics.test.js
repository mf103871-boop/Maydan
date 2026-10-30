import test from 'node:test';
import assert from 'node:assert/strict';
import { localEnvironment } from '../server/local.mjs';
import { routeRequest } from '../server/worker.mjs';
import { createUser, upsertSubscription, deleteUser } from '../server/accounts/db.mjs';
import { issueSession } from '../server/accounts/session.mjs';
import { persistMafiaProgress } from '../server/mafia-progression.mjs';
import { cosmeticsFor, effectiveCosmetics, effectiveCosmeticsMany } from '../server/plus/access.mjs';
import { GRACE_MS } from '../src/shared/account/config.js';

const origin = 'http://localhost:3000';
async function setup(t) {
  const runtime = localEnvironment({ vars: { MAFIA_ENABLED: '1', MAFIA_PROGRESS_ENABLED: '1' } }); t.after(() => runtime.dispose());
  const env = runtime.env, user = await createUser(env, { name: 'Synthetic cosmetic account' }), session = await issueSession(env, user.id);
  const now = Date.now(), value = { eventSchemaVersion: 1, eventKind: 'match_completed', source: 'live', rewardPolicyVersion: 1,
    key: `license:${crypto.randomUUID()}`, eventId: `online:${crypto.randomUUID()}`, rulesetVersion: 1, startedAt: now - 200_000, finishedAt: now - 31_000, notBefore: now - 1000,
    mode: 'classic', visibility: 'public', capacity: 6, participantCount: 6, draw: false,
    results: [{ userId: user.id, roleId: 'citizen', initialFaction: 'town', faction: 'town', won: false, forfeited: false, eliminatedAt: null }] };
  await persistMafiaProgress(env, value);
  async function api(body) {
    const request = new Request(origin + '/api/me/cosmetics', { method: body ? 'PATCH' : 'GET', headers: { origin, authorization: `Bearer ${session.token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const response = await routeRequest(request, env); return { status: response.status, body: await response.json() };
  }
  const subscription = async (status, until = Date.now() + 86_400_000) => upsertSubscription(env, { user_id: user.id, source: 'promo', external_id: `cosmetic-${user.id}`, status, until, environment: 'promo', will_renew: false, occurred_at: Date.now() });
  return { env, user, api, subscription };
}

test('earned cosmetic equips without Plus and survives expiry/refund while paid cosmetics and badge fall back', async t => {
  const h = await setup(t);
  let saved = await h.api({ selection: { frameId: 'noir.frame' }, revision: 0 });
  assert.equal(saved.status, 200); assert.equal(saved.body.plusActive, false); assert.equal(saved.body.effective.frameId, 'noir.frame');
  assert.equal(saved.body.grants[0].source, 'mafia_achievement');
  assert.equal((await h.api({ selection: { frameId: 'unknown.frame' }, revision: 1 })).status, 400);
  assert.equal((await h.api({ selection: { avatarId: 'artist.avatar' }, revision: 1 })).status, 402);
  assert.equal((await h.api({ selection: { badge: true }, revision: 1 })).status, 402);
  await h.subscription('active');
  saved = await h.api({ selection: { avatarId: 'artist.avatar', badge: true }, revision: 1 }); assert.equal(saved.status, 200);
  await h.subscription('expired', Date.now() - GRACE_MS - 1000);
  for (const status of ['expired', 'refunded', 'revoked']) {
    if (status !== 'expired') await h.subscription(status);
    const own = await effectiveCosmetics(h.env, h.user.id), many = (await effectiveCosmeticsMany(h.env, [h.user.id])).get(h.user.id);
    assert.equal(own.frameId, 'noir.frame'); assert.equal(own.avatarId, null); assert.equal(own.badge, false); assert.deepEqual(many, own);
  }
});

test('a license cannot authorize an unknown/mismatched item or bypass the active Mafia cosmetic lock', async t => {
  const h = await setup(t), now = Date.now();
  await h.env.DB.prepare("INSERT INTO mafia_cosmetic_grants VALUES(?,'artist.avatar','mafia_achievement','mafia_first_qualified',?,NULL)").bind(h.user.id, now).run();
  assert.equal((await h.api()).body.grants.length, 1);
  assert.equal((await h.api({ selection: { avatarId: 'artist.avatar' }, revision: 0 })).status, 402);
  await h.env.DB.prepare('INSERT INTO mafia_match_leases VALUES(?,?,?,?,?)').bind(h.user.id, 'synthetic-room', '1', now + 120_000, now).run();
  const locked = await h.api({ selection: { frameId: 'noir.frame' }, revision: 0 });
  assert.equal(locked.body.error, 'MAFIA_SOCIAL_LOCKED');
  assert.equal((await h.api()).body.revision, 0);
});

test('revoking a grant between validation and cosmetic SQL write prevents equip and batched projection stays consistent', async t => {
  const h = await setup(t), original = h.env.DB.batch.bind(h.env.DB); let revoked = false;
  t.mock.method(h.env.DB, 'batch', async statements => {
    if (!revoked && statements.some(statement => statement.sql.includes('INSERT INTO plus_cosmetics'))) {
      revoked = true; await h.env.DB.prepare('UPDATE mafia_cosmetic_grants SET revoked_at=? WHERE user_id=?').bind(Date.now(), h.user.id).run();
    }
    return original(statements);
  });
  assert.equal((await h.api({ selection: { frameId: 'noir.frame' }, revision: 0 })).status, 409);
  assert.equal((await h.api()).body.effective.frameId, null);
  assert.equal((await effectiveCosmeticsMany(h.env, [h.user.id])).get(h.user.id).frameId, null);
});

function afterFirstGrantRead(t, env, mutate) {
  const prepare=env.DB.prepare.bind(env.DB);let changed=false;
  t.mock.method(env.DB,'prepare',sql=>{
    const statement=prepare(sql),bind=statement.bind.bind(statement);
    statement.bind=(...args)=>{
      const bound=bind(...args);
      if(sql.startsWith('SELECT')&&sql.includes('FROM mafia_cosmetic_grants')){
        const all=bound.all.bind(bound);
        bound.all=async()=>{const rows=await all();if(!changed){changed=true;await mutate();}return rows;};
      }
      return bound;
    };
    return statement;
  });
  return ()=>changed;
}

test('account deletion inside grant lookup cannot return cached grants, preferences or an effective frame, individually or in a batch', async t => {
  for(const batch of [false,true]){
    const h=await setup(t);assert.equal((await h.api({selection:{frameId:'noir.frame'},revision:0})).status,200);
    const changed=afterFirstGrantRead(t,h.env,()=>deleteUser(h.env,h.user.id));
    if(batch){
      const result=(await effectiveCosmeticsMany(h.env,[h.user.id])).get(h.user.id);
      assert.equal(result.frameId,null);assert.equal(result.badge,false);
    }else{
      const result=await cosmeticsFor(h.env,h.user.id);
      assert.deepEqual(result.grants,[]);assert.equal(result.effective.frameId,null);assert.equal(result.preferred.frameId,null);assert.equal(result.revision,0);assert.equal(result.eligible,false);
    }
    assert.equal(changed(),true);assert.equal((await h.env.DB.prepare('SELECT COUNT(*) n FROM users').first()).n,0);
  }
});

test('the final cosmetic read rechecks a revoked license, changed selection and revoked Plus from current SQL state', async t => {
  for(const mutation of ['license','selection','plus']){
    const h=await setup(t);await h.subscription('active');
    assert.equal((await h.api({selection:{frameId:'noir.frame',avatarId:'artist.avatar'},revision:0})).status,200);
    const changed=afterFirstGrantRead(t,h.env,async()=>{
      if(mutation==='license'){
        await h.subscription('revoked');await h.env.DB.prepare('UPDATE mafia_cosmetic_grants SET revoked_at=? WHERE user_id=?').bind(Date.now(),h.user.id).run();
      }else if(mutation==='selection')await h.env.DB.prepare("UPDATE plus_cosmetics SET selection_json='{}',revision=revision+1 WHERE user_id=?").bind(h.user.id).run();
      else await h.subscription('revoked');
    });
    const result=await cosmeticsFor(h.env,h.user.id);assert.equal(changed(),true);
    if(mutation==='selection'){assert.equal(result.preferred.frameId,null);assert.equal(result.revision,2);}
    else {assert.equal(result.plusActive,false);assert.equal(result.effective.avatarId,null);assert.equal(result.effective.frameId,mutation==='license'?null:'noir.frame');}
  }
});
