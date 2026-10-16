import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalD1 } from '../server/local-d1.mjs';
import { createUser } from '../server/accounts/db.mjs';
import { issueSession } from '../server/accounts/session.mjs';
import { routeSocial } from '../server/social/router.mjs';
import { first } from '../server/lamma/common.mjs';
import { liveKitWebhook } from '../server/lamma/webhook.mjs';
import { drainJobs } from '../server/lamma/jobs.mjs';
import { base64url, base64urlFromBytes, hmacSha256, decodeJws } from '../server/accounts/jwt.mjs';

test('delayed signed departure for an old provider SID cannot end a rejoined call', async t => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  let providerRequests = 0, alarms = 0;
  t.mock.method(globalThis, 'fetch', async () => { providerRequests++; return Response.json({}); });
  const env = { DB: createLocalD1(), LIVEKIT_URL: 'wss://test.livekit.cloud', LIVEKIT_API_KEY: 'fixture', LIVEKIT_API_SECRET: 'fixture-secret',
    SOCIAL_JOBS: { idFromName: id => id, get: () => ({ fetch: async () => { alarms++; return Response.json({}); } }) } };
  t.after(() => env.DB.close());
  const user = async () => {
    const u = await createUser(env, { name: 'اختبار الاتصال', email: `${crypto.randomUUID()}@example.test` });
    return { ...u, token: (await issueSession(env, u.id)).token };
  };
  const api = async (u, suffix, body) => {
    const r = await routeSocial(new Request(`https://test.local/api/social${suffix}`, {
      method: 'POST', headers: { authorization: `Bearer ${u.token}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
    }), env);
    assert.equal(r.status, 200); return r.json();
  };
  const a = await user(), b = await user();
  const friendship = await api(a, '/requests', { userId: b.id });
  await api(b, `/requests/${friendship.request.id}/accept`, {});
  const group = (await api(a, '/groups', { name: 'اختبار الأصدقاء' })).group.id;
  const invite = await api(a, `/groups/${group}/invites`, { userId: b.id });
  await api(b, `/groups/${group}/invites/${invite.invitation.id}/accept`, {});
  const call = (await api(a, '/calls', { scope: 'group', conversationId: group, clientId: crypto.randomUUID(), deviceId: 'owner-device' })).call.id;
  const participant = () => first(env, 'SELECT state,provider_sid,joined_at FROM social_call_participants WHERE call_id=? AND user_id=?', call, b.id);
  const webhook = async (event, sid, metadata) => {
    const body = JSON.stringify({ event, room: { name: `lamma-${call}` }, participant: { identity: b.id, sid, metadata } });
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body)));
    const sha256 = btoa(String.fromCharCode(...digest));
    const data = `${base64url(JSON.stringify({ alg: 'HS256' }))}.${base64url(JSON.stringify({ iss: 'fixture', exp: Math.floor(now / 1000) + 60, sha256 }))}`;
    const token = `${data}.${base64urlFromBytes(await hmacSha256('fixture-secret', data))}`;
    assert.equal((await liveKitWebhook(new Request('https://test.local/webhook', { method: 'POST', headers: { authorization: token }, body }), env)).status, 200);
  };

  const initial = decodeJws((await api(b, `/calls/${call}/join`, { deviceId: 'friend-device' })).connection.token).payload;
  assert.equal(initial.video.canUpdateOwnMetadata, false);
  await webhook('participant_joined', 'original-sid', initial.metadata);
  await api(b, `/calls/${call}/leave`, { deviceId: 'friend-device' });
  now += 2000; // The explicit provider revocation cutoff has passed.
  const rejoined = decodeJws((await api(b, `/calls/${call}/join`, { deviceId: 'friend-device' })).connection.token).payload;
  const currentGeneration = JSON.parse(rejoined.metadata).lammaJoinedAt;
  assert.ok(currentGeneration > JSON.parse(initial.metadata).lammaJoinedAt);
  assert.deepEqual(await participant(), { state: 'active', provider_sid: null, joined_at: currentGeneration });
  await webhook('participant_joined', 'original-sid', initial.metadata);
  assert.equal((await participant()).provider_sid, null, 'late joined event cannot bind an old generation');
  await webhook('participant_left', 'original-sid');
  assert.equal((await participant()).state, 'active');

  await webhook('participant_joined', 'replacement-sid', rejoined.metadata);
  await api(b, `/calls/${call}/join`, { deviceId: 'friend-device' });
  assert.deepEqual(await participant(), { state: 'active', provider_sid: 'replacement-sid', joined_at: currentGeneration }, 'idempotent join preserves the current connection binding');
  await webhook('participant_joined', 'original-sid', initial.metadata);
  assert.equal((await participant()).provider_sid, 'replacement-sid');
  await webhook('participant_left', 'original-sid');
  assert.equal((await participant()).state, 'active');
  const before = { providerRequests, alarms };
  await webhook('participant_left', 'replacement-sid');
  assert.equal((await participant()).state, 'left', 'the current signed provider departure still takes effect');
  assert.equal(providerRequests, before.providerRequests, 'webhook does not hold its HTTP response open while calling the provider');
  assert.ok(alarms > before.alarms, 'durable processing is armed before acknowledging the webhook');
  assert.ok(await first(env, "SELECT 1 FROM social_jobs WHERE kind='lk_remove' AND json_extract(payload,'$.identity')=?", b.id));
  await drainJobs(env);
  assert.ok(providerRequests > before.providerRequests);
});
