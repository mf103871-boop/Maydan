// Offline assertions only. This module has no network, credential, process or
// filesystem APIs and cannot deploy, migrate or change live configuration.
// A release operator must supply independently captured/frozen evidence; passing
// a fixture does not establish that production or physical devices were checked.
import assert from 'node:assert/strict';
import { MAFIA_ROOMS_CEILING, MAFIA_VOICE_CEILING } from '../server/mafia-limits.mjs';

const WORKERS = ['maydan-game', 'maydan-rooms'];
const SHA256 = /^[a-f0-9]{64}$/;
const MAFIA_VARS = new Set(['MAFIA_ENABLED', 'MAFIA_MAX_ACTIVE_ROOMS', 'MAFIA_MAX_VOICE_PARTICIPANTS']);
const stableBindings = worker => worker.settings.bindings.filter(binding => !MAFIA_VARS.has(binding.name)).sort((a, b) => a.name.localeCompare(b.name));
const variable = (worker, name) => worker.settings.bindings.find(binding => binding.name === name)?.text;
const digest = (value, name) => assert.match(value || '', SHA256, `A frozen ${name} SHA-256 is required.`);

const MIGRATION_NAME = /^\d{4}_[a-z0-9_]+\.sql$/;
// The reviewed set is the frozen source's whole ordered server/migrations list
// with each file's SHA-256 (production-release-review.mjs reads it). The live
// ledger may lag behind that source, but never contain an unknown migration or
// skip an older reviewed one. Every reviewed migration it lacks is pending.
export function reviewedMigrationPlan(ledger, reviewed) {
  assert.ok(Array.isArray(ledger), 'Read the live migration ledger.');
  assert.equal(new Set(ledger).size, ledger.length, 'Duplicate migration ledger entries.');
  assert.ok(Array.isArray(reviewed) && reviewed.length > 0, 'Pin the reviewed migration set of the source commit.');
  const names = reviewed.map(migration => migration?.name);
  for (const migration of reviewed) { assert.match(migration?.name || '', MIGRATION_NAME, 'Invalid reviewed migration name.'); digest(migration.sha256, `reviewed migration ${migration.name}`); }
  assert.equal(new Set(names).size, names.length, 'Duplicate reviewed migrations.');
  assert.deepEqual([...names].sort(), names, 'Reviewed migrations must be listed in order.');
  for (const name of ledger) assert.ok(names.includes(name), `The live ledger has an unreviewed migration: ${name}.`);
  const pending = reviewed.filter(migration => !ledger.includes(migration.name));
  const newestApplied = [...ledger].sort().at(-1);
  if (pending.length && newestApplied) assert.ok(pending[0].name > newestApplied, `An older reviewed migration is missing from the live ledger: ${pending[0].name}.`);
  return { names, pending };
}

export function assertMafiaReleasePreservation(before, after, evidence, now = Date.now()) {
  assert.equal(before?.schemaVersion, 1); assert.equal(after?.schemaVersion, 1);
  const captured = Date.parse(before.capturedAt);
  assert.ok(Number.isFinite(captured) && captured <= now && now - captured <= 30 * 60_000, 'A fresh live baseline is required.');
  assert.match(evidence?.sourceCommit || '', /^[a-f0-9]{40}$/, 'Pin the reviewed source commit.');
  assert.equal(evidence.scope, 'mafia-production-backend-only');
  assert.deepEqual(Object.keys(before.workers).sort(), WORKERS);
  assert.deepEqual(Object.keys(after.workers).sort(), WORKERS);
  for (const name of WORKERS) {
    const oldWorker = before.workers[name], newWorker = after.workers[name];
    assert.ok(oldWorker.versionId && newWorker.versionId, 'Read exact worker versions.');
    assert.equal(evidence.baselineVersions?.[name], oldWorker.versionId, 'The reviewed plan references a stale worker version.');
    assert.equal(newWorker.uploadMode, 'inherit-strict-keep-assets', 'Generic Wrangler deployment is not an approved preservation path.');
    digest(newWorker.moduleSHA256, 'candidate module');
    assert.equal(newWorker.moduleSHA256, evidence.reviewedModuleSHA256?.[name], 'Unreviewed worker bytes.');
    assert.equal(newWorker.moduleSHA256, evidence.testedModuleSHA256?.[name], 'Tested and candidate worker bytes differ.');
    assert.deepEqual(stableBindings(newWorker), stableBindings(oldWorker), 'Existing variables, secret bindings, resources or Studio authorization changed.');
    const settings = worker => Object.fromEntries(Object.entries(worker.settings).filter(([key]) => key !== 'bindings'));
    assert.deepEqual(settings(newWorker), settings(oldWorker), 'Existing runtime settings changed.');
    assert.deepEqual(newWorker.schedules, oldWorker.schedules, 'Scheduler changed.');
    assert.deepEqual(newWorker.durableObjectHistory, oldWorker.durableObjectHistory, 'Durable Object history changed.');
    assert.deepEqual(newWorker.assets, oldWorker.assets, 'Public asset configuration or manifest changed.');
    const enabled = variable(newWorker, 'MAFIA_ENABLED');
    assert.ok(enabled === '0' || enabled === '1', 'Explicit Mafia feature gate required.');
    if (enabled === '1') {
      assert.equal(evidence.physicalDeviceAcceptance?.passed, true, 'Two iPhones and a third browser must pass before public activation.');
      assert.equal(evidence.physicalDeviceAcceptance?.physicalIPhones, 2);
      assert.ok(evidence.physicalDeviceAcceptance?.independentBrowsers >= 1);
      assert.equal(evidence.humanPlaytestAcceptance?.passed, true, 'Human playtest acceptance is required.');
      assert.deepEqual([...new Set(evidence.humanPlaytestAcceptance?.playerCounts || [])].sort((a, b) => a - b), [6, 7, 8, 9, 10, 11, 12]);
    }
  }
  assert.equal(variable(after.workers['maydan-game'], 'MAFIA_ENABLED'), variable(after.workers['maydan-rooms'], 'MAFIA_ENABLED'), 'The two public workers must agree on the feature gate.');
  digest(before.privateBank?.semanticSHA256, 'live private bank');
  assert.deepEqual(after.privateBank, before.privateBank, 'Private Ersomha concepts/identifiers changed in a Mafia-only release.');
  digest(before.publicSupport?.sha256, 'live support page');
  assert.equal(before.publicSupport?.getStatus, 200); assert.equal(before.publicSupport?.headStatus, 200);
  assert.deepEqual(after.publicSupport, before.publicSupport, 'The support route, content or headers changed.');
  digest(before.publicAssets?.manifestSHA256, 'public asset manifest');
  assert.deepEqual(after.publicAssets, before.publicAssets, 'Public game or Studio assets changed.');
  assert.deepEqual(after.updatePolicyChecks, before.updatePolicyChecks, 'Existing update policy behavior changed.');
  assert.deepEqual(Object.keys(before.updatePolicyChecks).sort(), ['ARE', 'JOR', 'SAU', 'USA']);
  assert.ok(before.database?.id); assert.equal(after.database?.id, before.database.id);
  digest(evidence.databaseBackup?.sha256, 'encrypted database backup');
  assert.equal(evidence.databaseBackup?.databaseId, before.database.id);
  const backupAt = Date.parse(evidence.databaseBackup?.completedAt);
  assert.ok(Number.isFinite(backupAt) && backupAt <= now && now - backupAt <= 30 * 60_000, 'Fresh encrypted backup required.');
  // The new code reads tables from every migration since the live ledger (0014
  // Mafia through 0026 directory today), so all of them, and nothing else, must
  // be applied once, in order, with the reviewed bytes.
  const ledger = before.database.migrations;
  const plan = reviewedMigrationPlan(ledger, evidence.reviewedMigrations), pending = plan.pending.map(migration => migration.name);
  assert.deepEqual(after.database.migrations, [...ledger, ...pending], 'Every pending reviewed migration, and nothing else, must be added once and in order.');
  for (const migration of plan.pending) assert.equal(after.database.migrationSHA256?.[migration.name], migration.sha256, `Migration bytes changed: ${migration.name}.`);
  assert.equal(evidence.liveProviderAcceptance?.passed, true, 'A live isolated provider test is required.');
  assert.equal(evidence.liveProviderAcceptance?.revokeBeforeCommit, true);
  digest(evidence.liveProviderAcceptance?.reportSHA256, 'provider report');
  const capacity = evidence.providerCapacity;
  assert.ok(Number.isInteger(capacity?.confirmedLimit) && capacity.confirmedLimit > 0, 'Read the actual provider limit.');
  assert.ok(Number.isInteger(capacity.socialReserve) && capacity.socialReserve >= 0);
  for (const worker of Object.values(after.workers)) {
    const rooms = Number(variable(worker, 'MAFIA_MAX_ACTIVE_ROOMS'));
    const participants = Number(variable(worker, 'MAFIA_MAX_VOICE_PARTICIPANTS'));
    assert.ok(Number.isInteger(rooms) && rooms >= 1 && rooms <= MAFIA_ROOMS_CEILING);
    assert.ok(Number.isInteger(participants) && participants >= 12 && participants <= MAFIA_VOICE_CEILING);
    assert.ok(rooms * 12 <= participants && participants + capacity.socialReserve <= capacity.confirmedLimit, 'Configured Mafia capacity exceeds the verified reserved quota.');
  }
  return { passed: true, scope: evidence.scope, sourceCommit: evidence.sourceCommit, pendingMigrations: pending,
    publicActivation: variable(after.workers['maydan-game'], 'MAFIA_ENABLED') === '1', productionChanged: false };
}
