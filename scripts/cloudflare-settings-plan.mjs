// Pure review documents only. This module cannot read credentials or call an API.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const ACCOUNT = '3fa113e56f10150f13618f641b9fe98e';
export const BUILD_TRIGGER = 'f0ea569b-08a6-4f94-aaa3-0c8758e24210';
export const PREVIEW = 'maydan-mafia-preview';
// Literal works even on older main revisions: no repository file, subprocess,
// credentials, version allowlist or conditional deployment fallback is executed.
export const BUILD_ONLY_DEPLOY_COMMAND = 'node -e "console.log(\'Build only: production deployment requires the reviewed paired game+rooms release procedure.\')"';
export const canonicalSettings = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
export const settingsDigest = value => createHash('sha256').update(canonicalSettings(value)).digest('hex');
export const previewSnapshotDigest = snapshot => settingsDigest(Object.fromEntries(Object.entries(snapshot).filter(([key]) => key !== 'capturedAt')));
const same = (a, b, message) => assert.equal(settingsDigest(a), settingsDigest(b), message);
const SHA = /^[a-f0-9]{64}$/;
const fresh = (at, now, maxAge) => {
  const age = now - Date.parse(at);
  assert.ok(Number.isFinite(age) && age >= 0 && age <= maxAge, 'Fresh, non-future evidence is required.');
};

export function buildTriggerPlan(before, { capturedAt, now = Date.now() } = {}) {
  fresh(capturedAt, now, 30 * 60_000);
  assert.equal(before.trigger_uuid, BUILD_TRIGGER);
  assert.equal(before.build_command, 'npm run build:cloudflare');
  assert.deepEqual(before.branch_includes, ['main']);
  assert.equal(before.root_directory, '/');
  assert.equal(typeof before.deploy_command, 'string');
  const after = { ...structuredClone(before), deploy_command: BUILD_ONLY_DEPLOY_COMMAND };
  const request = { method: 'PATCH', path: `/accounts/${ACCOUNT}/builds/triggers/${BUILD_TRIGGER}`, body: { deploy_command: after.deploy_command } };
  return { schemaVersion: 1, kind: 'cloudflare-build-only-gate', capturedAt,
    beforeSHA256: settingsDigest(before), afterSHA256: settingsDigest(after), requestSHA256: settingsDigest(request),
    before, after, request, changedFields: ['deploy_command'], remoteWrites: false,
    rollback: { method: 'PATCH', path: request.path, body: { deploy_command: before.deploy_command },
      automatic: false, warning: 'Restores the former unsafe fallback. Prefer retaining the build-only command; any rollback requires a fresh trigger lease and separate review.' } };
}

const NAMESPACES = Object.freeze({ ROOMS: 'ad18c07d25e6488690f83a8e67acacc2', LIMITERS: '76039076fc91426eaaeda6d9fd7daa57',
  SOCIAL_HUB: '6700844c81ba49e4a0692845aa9cc74a', SOCIAL_JOBS: '810929882f33486288184aa854035518' });
export function assertPreviewBaseline(snapshot, now = Date.now()) {
  assert.equal(snapshot.name, PREVIEW, 'Production settings are forbidden.');
  fresh(snapshot.capturedAt, now, 30 * 60_000);
  assert.ok(snapshot.versionId && snapshot.versionId === snapshot.latestVersionId, 'Active/latest must agree; reconcile unpromoted versions first.');
  assert.match(snapshot.codeETag || '', SHA, 'Pin the currently served code ETag.');
  assert.match(snapshot.assetsSHA256 || '', SHA, 'Pin the existing asset routing and content evidence.');
  assert.ok(Array.isArray(snapshot.schedules), 'Read the existing schedules.');
  const bindings = snapshot.settings?.bindings;
  assert.ok(Array.isArray(bindings)); assert.equal(new Set(bindings.map(b => b.name)).size, bindings.length);
  for (const binding of bindings) if (['secret_text', 'secret_key'].includes(binding.type)) {
    assert.ok(!['text', 'value', 'json'].some(key => Object.hasOwn(binding, key)), 'Secret values must never enter a settings plan.');
  }
  const by = name => bindings.find(b => b.name === name);
  assert.equal(by('DB')?.id || by('DB')?.database_id, 'cf5fb670-9fb5-4eeb-9717-ed76edb152e1');
  assert.equal(bindings.filter(b => b.type === 'd1').length, 1);
  assert.equal(by('SOCIAL_AUDIO')?.bucket_name, 'maydan-mafia-preview-audio');
  assert.equal(bindings.filter(b => b.type === 'r2_bucket').length, 1);
  assert.equal(by('ASSETS')?.type, 'assets');
  for (const [name, id] of Object.entries(NAMESPACES)) {
    assert.equal(by(name)?.namespace_id, id); assert.ok(!by(name).script_name || by(name).script_name === PREVIEW);
  }
  assert.equal(bindings.filter(b => b.type === 'durable_object_namespace').length, 4);
  assert.ok(by('SESSION_SECRET') && by('LIVEKIT_API_SECRET'), 'Keep existing authentication and voice bindings.');
  return true;
}

export function assertPreviewIdle(counts, now = Date.now()) {
  fresh(counts?.capturedAt, now, 60_000);
  assert.equal(counts.databaseId, 'cf5fb670-9fb5-4eeb-9717-ed76edb152e1');
  for (const key of ['activeRooms', 'activeClaims', 'activeCalls', 'activeParticipants']) assert.equal(counts[key], 0, `${key} must be zero before changing preview settings.`);
}

const inherit = bindings => [...bindings].sort((a, b) => a.name.localeCompare(b.name)).map(b => ({ name: b.name, type: 'inherit', version_id: 'latest' }));
const runtimeMetadata = settings => {
  const result = {};
  // Annotations are explicitly NOT inherited by settings PATCH. Keep the
  // editable source/message tags; triggered_by is a server-owned field.
  for (const key of ['compatibility_date', 'compatibility_flags', 'cache_options', 'limits', 'logpush', 'tags', 'tail_consumers', 'usage_model']) {
    if (settings[key] !== undefined) result[key] = structuredClone(settings[key]);
  }
  if (settings.annotations !== undefined) result.annotations = Object.fromEntries(Object.entries(settings.annotations).filter(([key]) => key !== 'workers/triggered_by'));
  return result;
};
const comparisonSettings = settings => {
  const copy = structuredClone(settings);
  if (copy.annotations) delete copy.annotations['workers/triggered_by'];
  return copy;
};
export function previewSettingsPlan(snapshot, counts, { now = Date.now() } = {}) {
  assertPreviewBaseline(snapshot, now); assertPreviewIdle(counts, now);
  const before = { placement: structuredClone(snapshot.settings.placement || {}), observability: structuredClone(snapshot.settings.observability) };
  assert.equal(before.observability?.enabled, true);
  const after = structuredClone(before);
  after.placement = { mode: 'smart' };
  after.observability.redact_query_string = true;
  after.observability.traces = { ...after.observability.traces, enabled: true, head_sampling_rate: 0.05 };
  const path = `/accounts/${ACCOUNT}/workers/scripts/${PREVIEW}/settings`;
  const retained = runtimeMetadata(snapshot.settings);
  const settings = { ...retained, bindings: inherit(snapshot.settings.bindings), ...after };
  const request = { method: 'PATCH', path, multipartField: 'settings', settings };
  return { schemaVersion: 1, kind: 'mafia-preview-performance-settings', capturedAt: snapshot.capturedAt,
    baselineSHA256: previewSnapshotDigest(snapshot), idleSHA256: settingsDigest(counts), baselineVersion: snapshot.versionId,
    before, after, request, requestSHA256: settingsDigest(request), remoteWrites: false, sourceUpload: false,
    changedFields: ['placement', 'observability.redact_query_string', 'observability.traces.enabled', 'observability.traces.head_sampling_rate'],
    rollback: { method: 'PATCH', path, multipartField: 'settings', settings: { ...retained, bindings: inherit(snapshot.settings.bindings), ...before },
      automatic: false, requiresFreshIdleAndAfterLease: true },
    notes: ['inherit uses latest on this API; re-read active/latest immediately before mutation.',
      'Do not reuse any previous release/apply/promote lock. A new settings-only journal must record intent once.',
      'Unknown PATCH result means GET-only reconciliation, never automatic replay.',
      'The API may create a settings version: verify active/latest, unchanged code ETag, assets, bindings and schedules after it.',
      'Placement does not move Durable Objects or D1; measure actual route latency before keeping it.'] };
}

export function assertPreviewPlanLease(plan, current, counts, now = Date.now()) {
  const freshPlan = plan.kind === 'mafia-preview-observability-settings'
    ? previewObservabilityPlan(current, counts, { now }) : previewSettingsPlan(current, counts, { now });
  assert.equal(plan.kind, freshPlan.kind);
  assert.equal(plan.baselineSHA256, freshPlan.baselineSHA256, 'Preview changed since review; reconcile instead of retrying.');
  same(plan.request, freshPlan.request, 'The reviewed settings request changed.');
  assert.equal(plan.requestSHA256, freshPlan.requestSHA256);
  return true;
}

export function previewObservabilityPlan(snapshot, counts, { now = Date.now() } = {}) {
  const combined = previewSettingsPlan(snapshot, counts, { now });
  const request = { method: 'PATCH', path: `/accounts/${ACCOUNT}/workers/scripts/${PREVIEW}/script-settings`,
    body: { observability: combined.after.observability } };
  return { ...combined, kind: 'mafia-preview-observability-settings',
    after: { placement: structuredClone(combined.before.placement), observability: combined.after.observability },
    changedFields: combined.changedFields.filter(key => key !== 'placement'), request, requestSHA256: settingsDigest(request),
    rollback: { method: 'PATCH', path: request.path, body: { observability: combined.before.observability }, automatic: false, requiresFreshIdleAndAfterLease: true },
    notes: ['Non-versioned script-settings only; no bindings, placement or code are submitted.',
      'Recheck idle and baseline lease immediately before a single journaled PATCH; unknown result means GET-only reconciliation.',
      'SmartPlacement is deferred to a separately reviewed fresh plan or the new preview code upload.'] };
}

export function assertPreviewObservabilityResult(before, after, plan, now = Date.now()) {
  assert.equal(plan.kind, 'mafia-preview-observability-settings');
  assert.equal(after.versionId, before.versionId, 'Script-level observability must not change the active version.');
  assert.equal(after.latestVersionId, before.latestVersionId, 'Unexpected version created; reconcile only.');
  return assertPreviewSettingsResult(before, after, { ...plan, kind: 'mafia-preview-performance-settings' }, now);
}

export function assertPreviewSettingsResult(before, after, plan, now = Date.now()) {
  assertPreviewBaseline(after, now);
  assert.equal(plan.kind, 'mafia-preview-performance-settings');
  assert.equal(plan.baselineSHA256, previewSnapshotDigest(before));
  assert.equal(after.codeETag, before.codeETag, 'Settings-only changes must preserve code.');
  assert.equal(after.assetsSHA256, before.assetsSHA256, 'Assets and routing changed.');
  same(after.schedules, before.schedules, 'Schedules changed.');
  same(after.settings.bindings, before.settings.bindings, 'Variables, secrets or resource bindings changed.');
  same(after.settings.placement, plan.after.placement, 'Placement did not match the plan.');
  same(after.settings.observability, plan.after.observability, 'Observability did not match the plan.');
  same(Object.fromEntries(Object.entries(comparisonSettings(after.settings)).filter(([k]) => !['placement', 'observability'].includes(k))),
    Object.fromEntries(Object.entries(comparisonSettings(before.settings)).filter(([k]) => !['placement', 'observability'].includes(k))), 'Other runtime settings changed.');
  return { verified: true, productionChanged: false, settingsOnly: true };
}
