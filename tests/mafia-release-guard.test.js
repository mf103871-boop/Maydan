import test from 'node:test';
import assert from 'node:assert/strict';
import { assertMafiaReleasePreservation } from '../scripts/mafia-release-guard.mjs';

const NOW = Date.parse('2026-10-26T12:00:00Z'), hash = digit => digit.repeat(64);
function fixture() {
  const worker = name => ({ versionId: `${name}-before`, settings: { compatibility_date: '2026-09-01',
    bindings: [{ name: 'DB', type: 'd1', id: 'private-live-db' }, { name: 'LIVEKIT_API_SECRET', type: 'secret_text' },
      { name: 'PADDLE_ENV', type: 'plain_text', text: 'production' }, { name: 'IOS_UPDATE_POLICY_ENABLED', type: 'plain_text', text: '1' },
      { name: 'DESIGN_EDITOR_USER_IDS', type: 'plain_text', text: 'owner' }] }, schedules: name === 'maydan-game' ? ['17 3 * * *', '* * * * *'] : [],
    durableObjectHistory: name === 'maydan-game' ? 'v3-lamma' : 'v1', assets: { id: `${name}-assets`, config: { run_worker_first: ['/api/*'] } } });
  const before = { schemaVersion: 1, capturedAt: new Date(NOW - 1000).toISOString(), workers: { 'maydan-game': worker('maydan-game'), 'maydan-rooms': worker('maydan-rooms') },
    privateBank: { semanticSHA256: hash('1'), count: 1560, version: 3 }, publicSupport: { sha256: hash('2'), getStatus: 200, headStatus: 200, headers: { 'content-type': 'text/html' } },
    publicAssets: { manifestSHA256: hash('3'), count: 117 }, updatePolicyChecks: Object.fromEntries(['JOR', 'SAU', 'ARE', 'USA'].map(country => [country, { enabled: true, minimumVersion: '1.8', minimumBuild: 22 }])),
    database: { id: 'private-live-db', migrations: ['0008_lamma.sql', '0009_online_room_trials.sql', '0010_ersomha.sql', '0011_ersomha_reports.sql', '0012_design_studio.sql', '0013_moderation.sql'] } };
  const after = structuredClone(before);
  for (const [name, item] of Object.entries(after.workers)) {
    item.versionId = `${name}-after`; item.uploadMode = 'inherit-strict-keep-assets'; item.moduleSHA256 = hash('4');
    item.settings.bindings.push(...Object.entries({ MAFIA_ENABLED: '0', MAFIA_MAX_ACTIVE_ROOMS: '1', MAFIA_MAX_VOICE_PARTICIPANTS: '12' }).map(([name, text]) => ({ name, type: 'plain_text', text })));
  }
  after.database.migrations.push('0014_mafia.sql'); after.database.mafiaMigrationSHA256 = hash('5');
  const evidence = { sourceCommit: 'a'.repeat(40), scope: 'mafia-production-backend-only', baselineVersions: Object.fromEntries(Object.entries(before.workers).map(([name, item]) => [name, item.versionId])),
    reviewedModuleSHA256: { 'maydan-game': hash('4'), 'maydan-rooms': hash('4') }, testedModuleSHA256: { 'maydan-game': hash('4'), 'maydan-rooms': hash('4') },
    databaseBackup: { sha256: hash('6'), databaseId: before.database.id, completedAt: new Date(NOW - 1000).toISOString() }, mafiaMigrationSHA256: hash('5'),
    liveProviderAcceptance: { passed: true, revokeBeforeCommit: true, reportSHA256: hash('7') }, providerCapacity: { confirmedLimit: 100, socialReserve: 20 } };
  return { before, after, evidence };
}
const run = f => assertMafiaReleasePreservation(f.before, f.after, f.evidence, NOW);

test('Mafia offline guard accepts a disabled backend update without assuming fixed bank/asset counts or disabling the live update gate', () => {
  const result = run(fixture()); assert.equal(result.passed, true); assert.equal(result.productionChanged, false); assert.equal(result.publicActivation, false);
});

test('Mafia release guard refuses generic deploy, binding drift, private-bank rollback and missing support endpoint', () => {
  const mutations = [
    f => { f.after.workers['maydan-game'].uploadMode = 'wrangler'; },
    f => { f.after.workers['maydan-game'].settings.bindings[2].text = 'sandbox'; },
    f => { f.after.workers['maydan-game'].settings.bindings = f.after.workers['maydan-game'].settings.bindings.filter(b => b.name !== 'DESIGN_EDITOR_USER_IDS'); },
    f => { f.after.privateBank = { semanticSHA256: hash('0'), count: 1200, version: 1 }; },
    f => { f.after.publicSupport.getStatus = 404; },
    f => { f.after.publicAssets.manifestSHA256 = hash('0'); },
    f => { f.after.updatePolicyChecks.JOR.enabled = false; },
    f => { f.after.workers['maydan-rooms'].durableObjectHistory = 'v2-replaced'; },
    f => { f.after.workers['maydan-game'].schedules = []; },
    f => { f.after.database.migrations.push('0015_unreviewed.sql'); },
  ];
  for (const mutate of mutations) { const f = fixture(); mutate(f); assert.throws(() => run(f)); }
});

test('Mafia release guard rejects stale/mismatched evidence, missing provider proof and excess reserved capacity', () => {
  const mutations = [
    f => { f.before.capturedAt = new Date(NOW - 31 * 60_000).toISOString(); },
    f => { f.evidence.baselineVersions['maydan-game'] = 'stale'; },
    f => { f.evidence.testedModuleSHA256['maydan-rooms'] = hash('9'); },
    f => { f.evidence.databaseBackup.completedAt = new Date(NOW - 31 * 60_000).toISOString(); },
    f => { f.evidence.liveProviderAcceptance.revokeBeforeCommit = false; },
    f => { f.evidence.providerCapacity.confirmedLimit = 30; },
  ];
  for (const mutate of mutations) { const f = fixture(); mutate(f); assert.throws(() => run(f)); }
});

test('Mafia capacity follows the verified provider quota, not a fixed six rooms', () => {
  const configure = (f, rooms, participants) => { for (const worker of Object.values(f.after.workers)) for (const [name, text] of [['MAFIA_MAX_ACTIVE_ROOMS', rooms], ['MAFIA_MAX_VOICE_PARTICIPANTS', participants]]) worker.settings.bindings.find(b => b.name === name).text = String(text); };
  const big = fixture(); big.evidence.providerCapacity = { confirmedLimit: 1000, socialReserve: 100 }; configure(big, 20, 240);
  assert.equal(run(big).passed, true, 'twenty twelve-seat rooms inside a 1,000-participant plan');
  for (const [rooms, participants] of [[20, 200], [80, 960], [1001, 12_012]]) {
    const f = fixture(); f.evidence.providerCapacity = { confirmedLimit: 1000, socialReserve: 100 }; configure(f, rooms, participants);
    assert.throws(() => run(f), undefined, `${rooms} rooms / ${participants} participants`);
  }
});

test('public activation requires separately recorded physical and human acceptance for all seven player counts', () => {
  const f = fixture(); for (const worker of Object.values(f.after.workers)) worker.settings.bindings.find(b => b.name === 'MAFIA_ENABLED').text = '1';
  assert.throws(() => run(f), /iPhones/);
  f.evidence.physicalDeviceAcceptance = { passed: true, physicalIPhones: 2, independentBrowsers: 1 };
  assert.throws(() => run(f), /Human/);
  f.evidence.humanPlaytestAcceptance = { passed: true, playerCounts: [6, 8, 9, 10, 11, 12] };
  assert.throws(() => run(f));
  f.evidence.humanPlaytestAcceptance.playerCounts.push(7); assert.equal(run(f).publicActivation, true);
});
