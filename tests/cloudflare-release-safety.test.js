import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { productionGate } from '../scripts/cloudflare-production-gate.mjs';
import { BUILD_ONLY_DEPLOY_COMMAND, buildTriggerPlan, previewSettingsPlan, previewObservabilityPlan, assertPreviewObservabilityResult, assertPreviewPlanLease, assertPreviewSettingsResult, settingsDigest } from '../scripts/cloudflare-settings-plan.mjs';

const NOW = Date.parse('2026-10-31T00:00:00Z');
const at = new Date(NOW).toISOString(), hex = c => c.repeat(64);
function baseline() {
  return { name: 'maydan-mafia-preview', capturedAt: at, versionId: 'active', latestVersionId: 'active', codeETag: hex('a'), assetsSHA256: hex('b'), schedules: ['* * * * *', '17 3 * * *'],
    settings: { compatibility_date: '2026-09-01', placement: {}, logpush: false, annotations: { 'workers/message': 'Source synthetic-reviewed-commit', 'workers/tag': 'preview', 'workers/triggered_by': 'upload' },
      observability: { enabled: true, head_sampling_rate: 1, redact_query_string: false, logs: { enabled: true, invocation_logs: false, head_sampling_rate: 1, persist: true }, traces: { enabled: false, head_sampling_rate: 1, persist: true } },
      bindings: [{ name: 'DB', type: 'd1', id: 'cf5fb670-9fb5-4eeb-9717-ed76edb152e1' }, { name: 'SOCIAL_AUDIO', type: 'r2_bucket', bucket_name: 'maydan-mafia-preview-audio' },
        { name: 'ASSETS', type: 'assets' }, { name: 'SESSION_SECRET', type: 'secret_text' }, { name: 'LIVEKIT_API_SECRET', type: 'secret_text' },
        { name: 'IOS_UPDATE_POLICY_ENABLED', type: 'plain_text', text: '0' },
        ...Object.entries({ ROOMS: 'ad18c07d25e6488690f83a8e67acacc2', LIMITERS: '76039076fc91426eaaeda6d9fd7daa57', SOCIAL_HUB: '6700844c81ba49e4a0692845aa9cc74a', SOCIAL_JOBS: '810929882f33486288184aa854035518' }).map(([name, namespace_id]) => ({ name, namespace_id, type: 'durable_object_namespace' }))] } };
}
const idle = () => ({ capturedAt: at, databaseId: 'cf5fb670-9fb5-4eeb-9717-ed76edb152e1', activeRooms: 0, activeClaims: 0, activeCalls: 0, activeParticipants: 0 });

test('both production npm commands fail closed, including attempted bypass arguments and environment', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
  for (const command of ['cloudflare:deploy', 'rooms:deploy']) assert.equal(pkg.scripts[command], 'node scripts/cloudflare-production-gate.mjs');
  for (const args of [[], ['--apply'], ['--force'], ['--build-only', '--deploy'], ['--env', 'production']]) {
    assert.throws(() => productionGate(args), { code: 'PRODUCTION_RELEASE_REVIEW_REQUIRED' });
    assert.throws(() => execFileSync(process.execPath, ['scripts/cloudflare-production-gate.mjs', ...args], { cwd: new URL('../', import.meta.url), stdio: 'pipe', env: { ...process.env, CI: 'true', MAYDAN_DEPLOY_APPROVED: '1' } }));
  }
  assert.equal(productionGate(['--build-only']).productionDeployment, false);
});

test('Cloudflare literal succeeds with no repository/gate file and cannot fall back to a deploy', () => {
  const script = JSON.parse(BUILD_ONLY_DEPLOY_COMMAND.slice('node -e '.length));
  const output = execFileSync(process.execPath, ['-e', script], { cwd: new URL('.', import.meta.url), encoding: 'utf8' });
  assert.match(output, /Build only/);
  assert.doesNotMatch(script, /\brequire\s*\(|\bimport\b|\bspawn\b|\bexec\b|\bfetch\b|wrangler|process\.env|readFile|[a-f0-9]{40}/);
  const before = { trigger_uuid: 'f0ea569b-08a6-4f94-aaa3-0c8758e24210', build_command: 'npm run build:cloudflare', branch_includes: ['main'], root_directory: '/', deploy_command: 'legacy-gate', branch_excludes: [], path_includes: ['*'], build_caching_enabled: true };
  const p = buildTriggerPlan(before, { capturedAt: at, now: NOW });
  assert.deepEqual(p.request.body, { deploy_command: BUILD_ONLY_DEPLOY_COMMAND });
  assert.deepEqual({ ...p.after, deploy_command: before.deploy_command }, before);
  assert.equal(p.beforeSHA256, settingsDigest(before)); assert.equal(p.rollback.automatic, false);
  assert.throws(() => buildTriggerPlan(before, { capturedAt: at, now: NOW + 31 * 60_000 }), /Fresh/);
});

test('preview settings proposal inherits every binding without values and preserves logs, schedules and unrelated runtime settings', () => {
  const b = baseline(), original = structuredClone(b), p = previewSettingsPlan(b, idle(), { now: NOW });
  assert.deepEqual(b, original); assert.equal(p.remoteWrites, false); assert.equal(p.sourceUpload, false);
  assert.equal(p.request.multipartField, 'settings');
  assert.deepEqual(p.request.settings.bindings.map(x => x.name).sort(), b.settings.bindings.map(x => x.name).sort());
  assert.ok(p.request.settings.bindings.every(x => x.type === 'inherit' && x.version_id === 'latest' && Object.keys(x).length === 3));
  assert.deepEqual(p.after.observability.logs, b.settings.observability.logs);
  assert.deepEqual(p.request.settings.annotations, { 'workers/message': 'Source synthetic-reviewed-commit', 'workers/tag': 'preview' });
  assert.equal(p.request.settings.migrations, undefined);
  assert.deepEqual(p.after.placement, { mode: 'smart' });
  assert.deepEqual(p.after.observability.traces, { enabled: true, head_sampling_rate: 0.05, persist: true });
  assert.equal(p.after.observability.redact_query_string, true);
  assert.deepEqual(p.rollback.settings.placement, {});
  const rechecked = { ...structuredClone(b), capturedAt: new Date(NOW + 1000).toISOString() };
  assert.equal(assertPreviewPlanLease(p, rechecked, { ...idle(), capturedAt: rechecked.capturedAt }, NOW + 1000), true);
  const tampered = structuredClone(p); tampered.request.settings.bindings.pop();
  assert.throws(() => assertPreviewPlanLease(tampered, b, idle(), NOW), /request changed/);
  const after = { ...structuredClone(b), versionId: 'settings-version', latestVersionId: 'settings-version' };
  Object.assign(after.settings, p.after);
  after.settings.annotations['workers/triggered_by'] = 'settings-update';
  assert.equal(assertPreviewSettingsResult(b, after, p, NOW).verified, true);
  assert.throws(() => assertPreviewPlanLease(p, after, idle(), NOW), /changed since review/);
  for (const mutate of [x => { x.codeETag = hex('f'); }, x => { x.assetsSHA256 = hex('c'); }, x => { x.schedules = []; }, x => { x.settings.bindings.pop(); }, x => { x.settings.logpush = true; }, x => { x.settings.observability.traces.head_sampling_rate = 1; }]) {
    const changed = structuredClone(after); mutate(changed); assert.throws(() => assertPreviewSettingsResult(b, changed, p, NOW));
  }
});

for (const [name, mutate] of [
  ['production worker', b => { b.name = 'maydan-game'; }], ['production database', b => { b.settings.bindings[0].id = '9d863a31-6a5c-45f1-91f5-79ad400c3f6e'; }],
  ['production bucket', b => { b.settings.bindings[1].bucket_name = 'maydan-social-audio'; }], ['foreign namespace', b => { b.settings.bindings.find(x => x.name === 'ROOMS').namespace_id = 'foreign'; }],
  ['secret value', b => { b.settings.bindings.find(x => x.name === 'SESSION_SECRET').text = 'synthetic-never-copy'; }], ['unpromoted version', b => { b.latestVersionId = 'pending'; }],
  ['missing asset proof', b => { delete b.assetsSHA256; }], ['stale source snapshot', b => { b.capturedAt = new Date(NOW - 31 * 60_000).toISOString(); }],
]) test(`settings plan rejects ${name}`, () => { const b = baseline(); mutate(b); assert.throws(() => previewSettingsPlan(b, idle(), { now: NOW })); });

for (const key of ['activeRooms', 'activeClaims', 'activeCalls', 'activeParticipants']) test(`settings plan rejects live ${key}`, () => {
  const c = idle(); c[key] = 1; assert.throws(() => previewSettingsPlan(baseline(), c, { now: NOW }));
});
test('settings plan rejects stale/future/missing idle checkpoints', () => {
  for (const capturedAt of [new Date(NOW - 61_000).toISOString(), new Date(NOW + 1).toISOString(), undefined]) assert.throws(() => previewSettingsPlan(baseline(), { ...idle(), capturedAt }, { now: NOW }));
});

test('first observability stage sends JSON only and cannot alter placement, bindings or version', () => {
  const before = baseline(), plan = previewObservabilityPlan(before, idle(), { now: NOW });
  assert.match(plan.request.path, /\/script-settings$/);
  assert.deepEqual(Object.keys(plan.request.body), ['observability']);
  assert.deepEqual(plan.after.placement, before.settings.placement);
  assert.equal(plan.request.body.observability.redact_query_string, true);
  assert.deepEqual(plan.request.body.observability.logs, before.settings.observability.logs);
  const after = structuredClone(before); after.settings.observability = structuredClone(plan.after.observability);
  assert.equal(assertPreviewObservabilityResult(before, after, plan, NOW).verified, true);
  assert.equal(assertPreviewPlanLease(plan, before, idle(), NOW), true);
  assert.throws(() => assertPreviewPlanLease(plan, after, idle(), NOW), /changed since review/);
  assert.throws(() => assertPreviewObservabilityResult(before, { ...after, versionId: 'unexpected', latestVersionId: 'unexpected' }, plan, NOW), /active version/);
});

test('observability rollback restores only old observability and requires fresh review rather than replay', () => {
  const before = baseline(), plan = previewObservabilityPlan(before, idle(), { now: NOW });
  assert.deepEqual(plan.rollback.body, { observability: before.settings.observability });
  assert.equal(plan.rollback.automatic, false); assert.equal(plan.rollback.requiresFreshIdleAndAfterLease, true);
  assert.equal(plan.request.multipartField, undefined);
});
