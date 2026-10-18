import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { socialUpdatePlan, assertOnlineTrialMigration, assertSocialUpdateLedger, assertSocialUpdateMetadata, assertFreshBackup, publicSmoke } from '../scripts/lamma-social-update.mjs';

function snapshot(name = 'maydan-game') {
  return { versionId: 'active-version', latestVersionId: 'active-version', settings: {
    compatibility_date: '2026-09-01', compatibility_flags: [], tags: ['existing'], observability: { enabled: true },
    bindings: [
      { name: 'DB', type: 'd1', id: '9d863a31-6a5c-45f1-91f5-79ad400c3f6e' },
      { name: 'SESSION_SECRET', type: 'secret_text' }, { name: 'LIVEKIT_API_SECRET', type: 'secret_text' },
      { name: 'IOS_UPDATE_POLICY_ENABLED', type: 'plain_text', text: '0' },
      { name: 'PADDLE_ENV', type: 'plain_text', text: 'sandbox' },
      { name: 'ROOMS', type: 'durable_object_namespace', class_name: 'Room', namespace_id: 'existing' },
      { name: 'SOCIAL_AUDIO', type: 'r2_bucket', bucket_name: 'maydan-social-audio' },
      { name: 'SOCIAL_JOBS', type: 'durable_object_namespace', class_name: 'LammaJobs', ...(name === 'maydan-rooms' ? { script_name: 'maydan-game' } : {}) },
      ...(name === 'maydan-game' ? [{ name: 'ASSETS', type: 'assets' }] : []),
    ],
  }, schedules: { schedules: name === 'maydan-game' ? [{ cron: '17 3 * * *' }, { cron: '* * * * *' }] : [] },
  version: { resources: { script_runtime: { migration_tag: name === 'maydan-game' ? 'v3-lamma' : 'v1',
    ...(name === 'maydan-game' ? { assets: { not_found_handling: 'single-page-application', base_path: '/', raw_run_worker_first: ['/api', '/api/*', '/health'], raw_headers: '/*\n X-Frame-Options: DENY' } } : {}),
  } } } };
}

test('social update inherits all resources without a new DO migration, cron or frontend upload', () => {
  for (const name of ['maydan-game', 'maydan-rooms']) {
    const before = snapshot(name), plan = socialUpdatePlan(name, before);
    assert.deepEqual(plan.schedules, before.schedules.schedules);
    assert.equal(plan.metadata.migrations, undefined);
    assert.ok(plan.metadata.bindings.every(binding => binding.type === 'inherit'));
    assert.deepEqual(plan.metadata.keep_bindings, ['secret_text', 'secret_key']);
    assert.equal(plan.metadata.keep_assets, name === 'maydan-game' ? true : undefined);
    assert.equal(plan.metadata.bindings.some(binding => 'text' in binding || 'bucket_name' in binding || 'namespace_id' in binding), false);
  }
});

test('social update refuses resource provisioning, migration guessing, schedule changes and mandatory-update activation', () => {
  for (const change of [
    state => { state.version.resources.script_runtime.migration_tag = 'v2-social'; },
    state => { state.settings.bindings = state.settings.bindings.filter(binding => binding.name !== 'SOCIAL_AUDIO'); },
    state => { state.settings.bindings = state.settings.bindings.filter(binding => binding.name !== 'SOCIAL_JOBS'); },
    state => { state.schedules.schedules = [{ cron: '17 3 * * *' }]; },
    state => { state.settings.bindings.find(binding => binding.name === 'IOS_UPDATE_POLICY_ENABLED').text = '1'; },
    state => { state.settings.bindings.find(binding => binding.name === 'DB').id = 'preview'; },
  ]) {
    const before = snapshot(); change(before); assert.throws(() => socialUpdatePlan('maydan-game', before));
  }
});

test('post-update verification detects every resource/setting/asset/cron drift while allowing a new code version', () => {
  const before = snapshot(), updated = structuredClone(before);
  updated.versionId = 'reviewed-new-version'; updated.latestVersionId = updated.versionId;
  assert.doesNotThrow(() => assertSocialUpdateMetadata('maydan-game', before, updated));
  for (const change of [
    state => { state.settings.bindings.push({ name: 'UNREVIEWED', type: 'secret_text' }); },
    state => { state.settings.bindings.find(binding => binding.name === 'PADDLE_ENV').text = 'production'; },
    state => { state.settings.observability.enabled = false; },
    state => { state.settings.compatibility_date = '2026-10-18'; },
    state => { state.schedules.schedules.push({ cron: '0 * * * *' }); },
    state => { state.version.resources.script_runtime.migration_tag = 'v4'; },
    state => { state.version.resources.script_runtime.assets.raw_headers = '/*\n X-Frame-Options: SAMEORIGIN'; },
  ]) {
    const current = structuredClone(updated); change(current);
    assert.throws(() => assertSocialUpdateMetadata('maydan-game', before, current));
  }
});

test('only the exact additive room-trial table/index and one ledger addition are permitted', () => {
  const migration = readFileSync(new URL('../server/migrations/0009_online_room_trials.sql', import.meta.url), 'utf8');
  assert.doesNotThrow(() => assertOnlineTrialMigration(migration));
  for (const sql of [migration + '\nDELETE FROM users;', migration.replace('online_room_trial_claims_created', 'other_index'), 'DROP TABLE users;']) {
    assert.throws(() => assertOnlineTrialMigration(sql));
  }
  const before = ['0001_accounts.sql', '0008_lamma.sql'];
  assert.doesNotThrow(() => assertSocialUpdateLedger(before, [...before, '0009_online_room_trials.sql']));
  assert.throws(() => assertSocialUpdateLedger(before, before));
  assert.throws(() => assertSocialUpdateLedger(before, [...before, '0009_online_room_trials.sql', '0010_unreviewed.sql']));
  assert.throws(() => assertSocialUpdateLedger([...before, '0009_online_room_trials.sql'], [...before, '0009_online_room_trials.sql']));
});

test('apply requires a recent complete backup with exact bytes and digest', () => {
  const bytes = Buffer.from('CREATE TABLE users(id TEXT);\n' + 'INSERT INTO users VALUES(\'synthetic\');\n'.repeat(5));
  const now = Date.now(), receipt = { completedAt: new Date(now).toISOString(), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  assert.doesNotThrow(() => assertFreshBackup(receipt, bytes, now));
  assert.throws(() => assertFreshBackup(receipt, bytes, now + 30 * 60000));
  assert.throws(() => assertFreshBackup(receipt, bytes, now - 1));
  assert.throws(() => assertFreshBackup({ ...receipt, sha256: '0'.repeat(64) }, bytes, now));
  assert.throws(() => assertFreshBackup({ ...receipt, bytes: bytes.length + 1 }, bytes, now));
  assert.throws(() => assertFreshBackup(receipt, Buffer.from('not a full export'), now));
});

test('preflight verifies both health endpoints and main policy while allowing a legacy rooms worker without that public route', async () => {
  const requested = [];
  const fetchImpl = async raw => {
    const url = new URL(raw); requested.push(url);
    if (url.pathname === '/health') return Response.json({ ok: true, accounts: true, protocol: 1, games: ['meenfina', 'fabraka'] });
    if (url.hostname.startsWith('maydan-rooms.')) return Response.json({ error: 'ORIGIN' }, { status: 403 });
    return Response.json({ enabled: false, minimumBuild: 0 });
  };
  const result = await publicSmoke({ preflight: true, fetchImpl });
  assert.equal(result['maydan-game'].mandatoryUpdateDisabled, true);
  assert.equal(result['maydan-rooms'].healthPassed, true);
  assert.equal(result['maydan-rooms'].mandatoryUpdatePolicyChecked, false);
  assert.equal(requested.filter(url => url.pathname === '/health').length, 2);
  assert.equal(requested.some(url => url.hostname.startsWith('maydan-rooms.') && url.pathname === '/api/app-policy/ios'), false);
  await assert.rejects(publicSmoke({ fetchImpl }), /public smoke failed/);
});

test('post-deployment smoke requires both public policies to be available and disabled', async () => {
  const fetchImpl = async raw => new URL(raw).pathname === '/health'
    ? Response.json({ ok: true, accounts: true, protocol: 1, games: ['meenfina', 'fabraka'] }) : Response.json({ enabled: false, minimumBuild: 0 });
  const result = await publicSmoke({ fetchImpl });
  assert.equal(result['maydan-game'].mandatoryUpdatePolicyChecked, true);
  assert.equal(result['maydan-rooms'].mandatoryUpdateDisabled, true);
  const enabled = async raw => new URL(raw).pathname === '/health'
    ? fetchImpl(raw) : Response.json({ enabled: true, minimumBuild: 17 });
  await assert.rejects(publicSmoke({ fetchImpl: enabled }), /Mandatory update must remain disabled/);
});
