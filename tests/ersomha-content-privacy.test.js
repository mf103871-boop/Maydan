import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { assertNoPrivateBrowserContent, assertPrivacyUnitProof, assertMicrophoneFixture, assertMicrophoneReceipt,
  ERSOMHA_PRIVACY_UNIT_PROOFS, normalizePrivacySourceInputs } from '../scripts/ersomha-content-privacy.mjs';

const now = Date.now(), hash = value => createHash('sha256').update(value).digest('hex');
function microphone() {
  return { scope: 'UI against local workerd/D1; external media is simulated',
    engines: ['chromium', 'webkit'].map(engine => ({ engine, groupLaunch: true, cancelledActiveRoomInvitationAllocatesNoSeat: true,
      automaticGuestJoin: true, bothDrawingsDelivered: true, drawerMutedBeforeWord: true, microphoneUnmuteBlockedDuringDrawing: true,
      microphoneNeverAutoReopened: true, bothCallStatesPreserved: true, completedDrawingTurns: 2, browserErrors: [],
      mediaConnectCount: [1, 1], mediaDisconnectCount: [0, 0] })), providerRequests: [{ provider: 'fixture.livekit.cloud', path: '/twirp/livekit.RoomService/CreateRoom' }] };
}
function tap() {
  const names = Object.values(ERSOMHA_PRIVACY_UNIT_PROOFS).flat();
  return `${names.map((name, i) => `ok ${i + 1} - ${name}`).join('\n')}\n# tests ${names.length}\n# pass ${names.length}\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n`;
}
test('browser proof rejects a missing real entry, private bank dependency, embedded concept ID or authored clue', () => {
  const metafile = { inputs: { 'src/main.jsx': {}, 'src/online/Ersomha.jsx': {} } }, bytes = Buffer.from('Safe compiled application text; '.repeat(6));
  const bank = [{ id: 'ers-private-001', visualNote: 'A distinctive author-only clue for the private bank' }];
  const proof = assertNoPrivateBrowserContent(metafile, bytes, bank);
  assert.equal(proof.bundleSHA256, hash(bytes)); assert.equal(proof.privateBankDependencyCount, 0);
  for (const filename of ['server/data/ersomha/animals.mjs', 'C:\\repo\\server\\data\\ersomha-runtime\\animals.mjs', 'server/ersomha-content.mjs', 'scripts/ersomha-content.mjs']) {
    assert.throws(() => assertNoPrivateBrowserContent({ inputs: { ...metafile.inputs, [filename]: {} } }, bytes, bank));
  }
  assert.throws(() => assertNoPrivateBrowserContent({ inputs: { 'other-entry.jsx': {} } }, bytes, bank));
  assert.throws(() => assertNoPrivateBrowserContent(metafile, Buffer.concat([bytes, Buffer.from(bank[0].id)]), bank));
  assert.throws(() => assertNoPrivateBrowserContent(metafile, Buffer.concat([bytes, Buffer.from(bank[0].visualNote)]), bank));
});
test('unit evidence requires executed named assertions and every test passing without skip, cancellation or TODO', () => {
  const output = tap(); assert.ok(assertPrivacyUnitProof(output).tests > 5);
  assert.throws(() => assertPrivacyUnitProof(output, { exitCode: 1 }));
  for (const changed of [output.replace('only the drawer receives choices/word', 'different assertion'), output.replace('# fail 0', '# fail 1'),
    output.replace('# cancelled 0', '# cancelled 1'), output.replace('# skipped 0', '# skipped 1'), output.replace('# todo 0', '# todo 1'), '']) assert.throws(() => assertPrivacyUnitProof(changed));
});
test('microphone proof requires both real browser UI engines, pre-choice mute, denied manual unmute and no automatic reopening', () => {
  const result = assertMicrophoneFixture(microphone()); assert.equal(result.actualLiveKitMedia, false); assert.equal(result.physicalDeviceTrialCompleted, false);
  for (const change of [
    summary => { summary.engines.pop(); }, summary => { summary.engines[0].drawerMutedBeforeWord = false; },
    summary => { summary.engines[0].microphoneUnmuteBlockedDuringDrawing = false; }, summary => { summary.engines[1].microphoneNeverAutoReopened = false; },
    summary => { summary.engines[0].mediaDisconnectCount = [1, 0]; }, summary => { summary.engines[0].browserErrors.push('failure'); },
    summary => { summary.providerRequests[0].provider = 'production.livekit.cloud'; }, summary => { summary.scope = 'Actual real LiveKit media trial'; },
  ]) { const summary = microphone(); change(summary); assert.throws(() => assertMicrophoneFixture(summary)); }
});
test('a reused fixture summary needs its current exact source-bound execution receipt and cannot be accepted by booleans alone', () => {
  const summaryBytes = Buffer.from(JSON.stringify(microphone()));
  const provenance = { sourceCommit: 'a'.repeat(40), sourceServerTree: 'b'.repeat(40), backendTreeSha256: 'c'.repeat(64) }, sourceInputs = { 'tests/e2e/ersomha-online.mjs': 'd'.repeat(64) };
  const receipt = { schemaVersion: 1, kind: 'ersomha-microphone-fixture-receipt', passed: true, ...provenance, sourceInputs,
    fixturePath: 'tests/e2e/ersomha-online.mjs', command: 'node tests/e2e/ersomha-online.mjs', exitCode: 0,
    summarySHA256: hash(summaryBytes), finishedAt: new Date(now).toISOString() };
  assert.doesNotThrow(() => assertMicrophoneReceipt(receipt, summaryBytes, provenance, sourceInputs, now));
  for (const change of [
    value => { value.sourceCommit = '0'.repeat(40); }, value => { value.sourceInputs = {}; },
    value => { value.summarySHA256 = '0'.repeat(64); }, value => { value.exitCode = 1; },
    value => { value.command = 'node unreviewed-fixture.mjs'; }, value => { value.finishedAt = new Date(now - 24 * 60 * 60_000).toISOString(); },
    value => { value.finishedAt = new Date(now + 1).toISOString(); },
  ]) { const value = structuredClone(receipt); change(value); assert.throws(() => assertMicrophoneReceipt(value, summaryBytes, provenance, sourceInputs, now)); }
  assert.throws(() => assertMicrophoneReceipt({ passed: true }, summaryBytes, provenance, sourceInputs, now));
});
test('real esbuild define identifiers and JSON import attributes bind actual inputs without trying to read synthetic filenames', () => {
  const input = normalizePrivacySourceInputs(['src/main.jsx', '<define:__MAYDAN_MEDIA_VERSIONS__>',
    "src/data/games/fabraka/pictures.json with { type: 'json' }", 'src/data/games/fabraka/pictures.json'], { __MAYDAN_MEDIA_VERSIONS__: '{}' });
  assert.deepEqual(input.filenames, ['src/data/games/fabraka/pictures.json', 'src/main.jsx']);
  assert.deepEqual(input.virtualInputs, { '<define:__MAYDAN_MEDIA_VERSIONS__>': { define: '__MAYDAN_MEDIA_VERSIONS__', sha256: hash('{}'), bytes: 2 } });
  assert.throws(() => normalizePrivacySourceInputs(['<stdin>']));
  assert.throws(() => normalizePrivacySourceInputs(['<define:UNKNOWN>'], { __MAYDAN_MEDIA_VERSIONS__: '{}' }));
  assert.throws(() => normalizePrivacySourceInputs(["src/main.jsx with { type: 'json' }"]));
});
