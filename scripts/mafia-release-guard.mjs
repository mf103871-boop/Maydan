// Offline assertions only. This module has no network, credential, process or
// filesystem APIs and cannot deploy, migrate or change live configuration.
// A release operator must supply independently captured/frozen evidence; passing
// a fixture does not establish that production or physical devices were checked.
import assert from 'node:assert/strict';

const WORKERS = ['maydan-game', 'maydan-rooms'];
const SHA256 = /^[a-f0-9]{64}$/;
const MAFIA_VARS = new Set(['MAFIA_ENABLED', 'MAFIA_MAX_ACTIVE_ROOMS', 'MAFIA_MAX_VOICE_PARTICIPANTS']);
const stableBindings = worker => worker.settings.bindings.filter(binding => !MAFIA_VARS.has(binding.name)).sort((a, b) => a.name.localeCompare(b.name));
const variable = (worker, name) => worker.settings.bindings.find(binding => binding.name === name)?.text;
const digest = (value, name) => assert.match(value || '', SHA256, `A frozen ${name} SHA-256 is required.`);

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
  const ledger = before.database.migrations;
  assert.equal(new Set(ledger).size, ledger.length, 'Duplicate migration ledger entries.');
  const pending = ledger.includes('0014_mafia.sql') ? [] : ['0014_mafia.sql'];
  assert.deepEqual(after.database.migrations, [...ledger, ...pending], 'Only the reviewed additive Mafia migration may be added once.');
  digest(evidence.mafiaMigrationSHA256, 'reviewed Mafia migration');
  assert.equal(after.database.mafiaMigrationSHA256, evidence.mafiaMigrationSHA256, 'Migration bytes changed.');
  assert.equal(evidence.liveProviderAcceptance?.passed, true, 'A live isolated provider test is required.');
  assert.equal(evidence.liveProviderAcceptance?.revokeBeforeCommit, true);
  digest(evidence.liveProviderAcceptance?.reportSHA256, 'provider report');
  const capacity = evidence.providerCapacity;
  assert.ok(Number.isInteger(capacity?.confirmedLimit) && capacity.confirmedLimit > 0, 'Read the actual provider limit.');
  assert.ok(Number.isInteger(capacity.socialReserve) && capacity.socialReserve >= 0);
  for (const worker of Object.values(after.workers)) {
    const rooms = Number(variable(worker, 'MAFIA_MAX_ACTIVE_ROOMS'));
    const participants = Number(variable(worker, 'MAFIA_MAX_VOICE_PARTICIPANTS'));
    assert.ok(Number.isInteger(rooms) && rooms >= 1 && rooms <= 6);
    assert.ok(Number.isInteger(participants) && participants >= 12 && participants <= 80);
    assert.ok(rooms * 12 <= participants && participants + capacity.socialReserve <= capacity.confirmedLimit, 'Configured Mafia capacity exceeds the verified reserved quota.');
  }
  return { passed: true, scope: evidence.scope, sourceCommit: evidence.sourceCommit, pendingMigrations: pending,
    publicActivation: variable(after.workers['maydan-game'], 'MAFIA_ENABLED') === '1', productionChanged: false };
}
