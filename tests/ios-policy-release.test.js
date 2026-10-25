import test from 'node:test';
import assert from 'node:assert/strict';
import { policyUploadPlan, assertPolicyDeployment } from '../scripts/ios/publish-policy-backend.mjs';

function snapshot() {
  return { versionId: 'old', latestVersionId: 'old', settings: { compatibility_date: '2026-09-01', compatibility_flags: [],
    observability: { enabled: true }, tags: ['existing'], bindings: [
      { name: 'DB', type: 'd1', id: '9d863a31-6a5c-45f1-91f5-79ad400c3f6e' },
      { name: 'SESSION_SECRET', type: 'secret_text' }, { name: 'PROVIDER_SECRET', type: 'secret_key' },
      { name: 'ASSETS', type: 'assets' }, { name: 'PADDLE_ENV', type: 'plain_text', text: 'production' },
      { name: 'ROOMS', type: 'durable_object_namespace', class_name: 'Room', namespace_id: 'existing-room-namespace' },
      { name: 'SOCIAL_AUDIO', type: 'r2_bucket', bucket_name: 'maydan-social-audio' },
      { name: 'SOCIAL_JOBS', type: 'durable_object_namespace', class_name: 'LammaJobs', namespace_id: 'existing-jobs-namespace' },
    ] }, schedules: { schedules: [{ cron: '17 3 * * *' }, { cron: '* * * * *' }] },
    version: { resources: { script_runtime: { migration_tag: 'v3-lamma', assets: { base_path: '/', not_found_handling: 'single-page-application',
      raw_run_worker_first: ['/api', '/api/*', '/health'], raw_headers: '/*\n X-Frame-Options: DENY', raw_redirects: '/old /new 301' } } } } };
}

function after(snapshot, plan) {
  const current = structuredClone(snapshot);
  current.versionId = current.latestVersionId = 'new';
  current.version.resources.script_runtime.assets.raw_run_worker_first = [...plan.metadata.assets.config.run_worker_first];
  return current;
}

test('narrow policy upload preserves resources, secrets and the complete asset routing without additions', () => {
  const before = snapshot(), original = structuredClone(before), plan = policyUploadPlan(before);
  assert.deepEqual(before, original);
  assert.equal(plan.metadata.keep_assets, true);
  assert.equal(plan.metadata.migrations, undefined);
  assert.equal(plan.schedules, undefined);
  assert.deepEqual(plan.metadata.keep_bindings, ['secret_text', 'secret_key']);
  assert.ok(plan.metadata.bindings.every(binding => binding.type === 'inherit' && Object.keys(binding).length === 2));
  assert.equal(plan.metadata.bindings.some(binding => binding.name.includes('SECRET')), false);
  assert.deepEqual(plan.metadata.assets.config, { base_path: '/', not_found_handling: 'single-page-application',
    run_worker_first: ['/api', '/api/*', '/health'], _headers: '/*\n X-Frame-Options: DENY', _redirects: '/old /new 301' });
  assertPolicyDeployment(before, after(before, plan), plan);
  const repeated = policyUploadPlan(after(before, plan));
  assert.deepEqual(repeated.metadata.assets.config, plan.metadata.assets.config);
});

test('planning refuses resources needing migration/provisioning, missing cron, or an active update gate', () => {
  for (const change of [
    value => { value.version.resources.script_runtime.migration_tag = 'v2-social'; },
    value => { value.settings.bindings = value.settings.bindings.filter(binding => binding.name !== 'SOCIAL_JOBS'); },
    value => { value.settings.bindings.find(binding => binding.name === 'SOCIAL_AUDIO').bucket_name = 'preview'; },
    value => { value.settings.bindings.find(binding => binding.name === 'DB').id = 'other'; },
    value => { value.schedules.schedules = [{ cron: '17 3 * * *' }]; },
    value => { value.settings.bindings.push({ name: 'IOS_UPDATE_POLICY_ENABLED', type: 'plain_text', text: '1' }); },
    value => { value.settings.bindings.push({ name: 'IOS_UPDATE_POLICY_ENABLED', type: 'secret_text' }); },
  ]) {
    const value = snapshot(); change(value);
    assert.throws(() => policyUploadPlan(value));
  }
  const value = snapshot(); value.settings.bindings.push({ name: 'IOS_UPDATE_POLICY_ENABLED', type: 'plain_text', text: '0' });
  assert.doesNotThrow(() => policyUploadPlan(value));
});

test('post-upload verification rejects drift in every preserved surface', () => {
  const before = snapshot(), plan = policyUploadPlan(before);
  for (const change of [
    value => { value.settings.bindings.find(binding => binding.name === 'PADDLE_ENV').text = 'sandbox'; },
    value => { value.settings.bindings.find(binding => binding.name === 'SOCIAL_JOBS').namespace_id = 'new-namespace'; },
    value => { value.settings.bindings.push({ name: 'UNEXPECTED', type: 'plain_text', text: 'x' }); },
    value => { value.settings.compatibility_flags.push('new_flag'); },
    value => { value.schedules.schedules.pop(); },
    value => { value.version.resources.script_runtime.migration_tag = 'v4'; },
    value => { value.version.resources.script_runtime.assets.raw_headers = '/*\n Access-Control-Allow-Origin: *'; },
    value => { value.version.resources.script_runtime.assets.raw_redirects = '/old /another 301'; },
    value => { value.version.resources.script_runtime.assets.raw_run_worker_first.push('/*'); },
    value => { value.version.resources.script_runtime.assets.raw_run_worker_first.push('/privacy'); },
    value => { value.version.resources.script_runtime.assets.static_routing = { user_worker: ['/api/*', '/privacy'] }; },
    value => { value.version.resources.script_runtime.assets.not_found_handling = '404-page'; },
  ]) {
    const current = after(before, plan); change(current);
    assert.throws(() => assertPolicyDeployment(before, current, plan));
  }
});
