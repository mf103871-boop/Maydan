import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewProductionPair } from '../scripts/production-release-review.mjs';
import { preservedMafiaUploadMetadata } from '../scripts/mafia-preserved-bundle.mjs';

const NOW = Date.parse('2026-10-31T00:00:00Z'), sha = c => c.repeat(64);
function fixture() {
  const names = ['maydan-game', 'maydan-rooms'];
  const worker = name => ({ versionId: `${name}-old`, latestVersionId: `${name}-old`, schedules: name === 'maydan-game' ? ['17 3 * * *', '* * * * *'] : [],
    settings: { compatibility_date: '2026-09-01', bindings: [
      { name: 'DB', type: 'd1', id: 'existing-production-db' }, { name: 'SESSION_SECRET', type: 'secret_text' }, { name: 'LIVEKIT_API_SECRET', type: 'secret_text' },
      { name: 'ROOMS', type: 'durable_object_namespace', namespace_id: `${name}-room` }, { name: 'SOCIAL_AUDIO', type: 'r2_bucket', bucket_name: 'maydan-social-audio' },
      { name: 'SOCIAL_JOBS', type: 'durable_object_namespace', namespace_id: 'existing-jobs' }, { name: 'IOS_UPDATE_POLICY_ENABLED', type: 'plain_text', text: '1' },
      { name: 'DESIGN_EDITOR_USER_IDS', type: 'plain_text', text: 'synthetic-owner-id' }, ...(name === 'maydan-game' ? [{ name: 'ASSETS', type: 'assets' }] : [])] },
    version: { resources: { script_runtime: { migration_tag: name === 'maydan-game' ? 'v3-lamma' : 'v1', assets: { not_found_handling: 'single-page-application', raw_run_worker_first: ['/api/*'] } } } },
    durableObjectHistory: name === 'maydan-game' ? 'v3-lamma' : 'v1', assets: { id: `${name}-assets` } });
  const snapshots = Object.fromEntries(names.map(n => [n, worker(n)]));
  const before = { schemaVersion: 1, capturedAt: new Date(NOW).toISOString(), workers: structuredClone(snapshots), privateBank: { semanticSHA256: sha('1'), count: 1560 },
    publicSupport: { sha256: sha('2'), getStatus: 200, headStatus: 200 }, publicAssets: { manifestSHA256: sha('3') },
    updatePolicyChecks: Object.fromEntries(['JOR', 'SAU', 'ARE', 'USA'].map(country => [country, { enabled: true, minimumVersion: '1.8', minimumBuild: 22 }])),
    database: { id: 'existing-production-db', migrations: ['0013_social_group_creation.sql'] } };
  const after = structuredClone(before);
  for (const w of Object.values(after.workers)) {
    w.versionId += '-new'; w.uploadMode = 'inherit-strict-keep-assets'; w.moduleSHA256 = sha('4');
    w.settings.bindings.push(...Object.entries({ MAFIA_ENABLED: '0', MAFIA_MAX_ACTIVE_ROOMS: '1', MAFIA_MAX_VOICE_PARTICIPANTS: '12' }).map(([name, text]) => ({ name, type: 'plain_text', text })));
  }
  after.database.migrations.push('0014_mafia.sql'); after.database.mafiaMigrationSHA256 = sha('5');
  const provenance = { clean: true, sourceCommit: 'a'.repeat(40), backendTreeSha256: sha('8') };
  const evidence = { ...provenance, scope: 'mafia-production-backend-only', baselineVersions: Object.fromEntries(names.map(n => [n, snapshots[n].versionId])),
    reviewedModuleSHA256: Object.fromEntries(names.map(n => [n, sha('4')])), testedModuleSHA256: Object.fromEntries(names.map(n => [n, sha('4')])),
    databaseBackup: { sha256: sha('6'), databaseId: before.database.id, completedAt: new Date(NOW).toISOString() }, mafiaMigrationSHA256: sha('5'),
    liveProviderAcceptance: { passed: true, revokeBeforeCommit: true, reportSHA256: sha('7') }, providerCapacity: { confirmedLimit: 100, socialReserve: 20 } };
  const draft = { kind: 'mafia-paired-preservation-draft', sourceCommit: provenance.sourceCommit, readyToApply: false, remoteWrites: false,
    workers: Object.fromEntries(names.map(n => [n, { beforeVersion: snapshots[n].versionId, reviewedModuleSHA256: sha('4'), upload: preservedMafiaUploadMetadata(n, snapshots[n]) }])) };
  return { provenance, envelope: { schemaVersion: 1, kind: 'production-paired-review', recheckedAt: new Date(NOW).toISOString(), snapshots, currentSnapshots: structuredClone(snapshots), before, after, evidence, draft } };
}

test('paired review composes actual preservation/lease guards and remains unable to apply', () => {
  const { envelope, provenance } = fixture(), result = reviewProductionPair(envelope, provenance, NOW);
  assert.equal(result.reviewPassed, true); assert.equal(result.readyToApply, false); assert.equal(result.applyAvailable, false); assert.equal(result.remoteWrites, false);
});
for (const [name, mutate] of [
  ['dirty source', f => { f.provenance.clean = false; }], ['source drift', f => { f.provenance.sourceCommit = 'b'.repeat(40); }],
  ['one worker only', f => { delete f.envelope.draft.workers['maydan-rooms']; }], ['stale immediate recheck', f => { f.envelope.recheckedAt = new Date(NOW - 61_000).toISOString(); }],
  ['unpromoted version', f => { f.envelope.currentSnapshots['maydan-game'].latestVersionId = 'unpromoted'; }],
  ['live settings drift', f => { f.envelope.currentSnapshots['maydan-game'].settings.bindings[0].id = 'other-db'; }],
  ['generic upload', f => { f.envelope.draft.workers['maydan-game'].upload.metadata = {}; }],
  ['unreviewed module', f => { f.envelope.draft.workers['maydan-rooms'].reviewedModuleSHA256 = sha('f'); }],
  ['bank replacement', f => { f.envelope.after.privateBank.semanticSHA256 = sha('f'); }], ['support loss', f => { f.envelope.after.publicSupport.getStatus = 404; }],
  ['Studio binding loss', f => { f.envelope.after.workers['maydan-game'].settings.bindings = f.envelope.after.workers['maydan-game'].settings.bindings.filter(x => x.name !== 'DESIGN_EDITOR_USER_IDS'); }],
  ['update policy change', f => { f.envelope.after.updatePolicyChecks.JOR.enabled = false; }],
  ['public activation without devices', f => { f.envelope.after.workers['maydan-game'].settings.bindings.find(x => x.name === 'MAFIA_ENABLED').text = '1'; }],
]) test(`paired review refuses ${name}`, () => { const f = fixture(); mutate(f); assert.throws(() => reviewProductionPair(f.envelope, f.provenance, NOW)); });
