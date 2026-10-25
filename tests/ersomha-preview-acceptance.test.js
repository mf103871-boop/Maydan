import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assertErsomhaPreviewURL, assertErsomhaPreviewConfig, parsePreviewD1Result, assertErsomhaStaleLeaseOutcome,
  runErsomhaPreviewAcceptance } from '../scripts/ersomha-preview-acceptance.mjs';

test('remote drawing acceptance URLs cannot escape preview or carry credentials', () => {
  assert.equal(assertErsomhaPreviewURL('/api/rooms').hostname, 'maydan-lamma-preview.mf103871.workers.dev');
  for (const url of ['https://maydan-game.mf103871.workers.dev/api/rooms',
    '//maydan-rooms.mf103871.workers.dev/api/rooms', 'http://maydan-lamma-preview.mf103871.workers.dev/health',
    'https://secret@maydan-lamma-preview.mf103871.workers.dev/health',
    '/health?token=do-not-send', '/health#credentials']) assert.throws(() => assertErsomhaPreviewURL(url));
});

test('fixture storage guards reject production D1, foreign DOs, buckets and assets', async () => {
  const source = await readFile(new URL('../wrangler.lamma-preview.jsonc', import.meta.url), 'utf8');
  assert.equal(assertErsomhaPreviewConfig(source), true);
  for (const changed of [
    source.replace('"name": "maydan-lamma-preview"', '"name": "maydan-game"'),
    source.replace('346a7165-9989-4fe2-a5a3-aec017a2d21b', '9d863a31-6a5c-45f1-91f5-79ad400c3f6e'),
    source.replace('"class_name": "Room"', '"class_name": "Room", "script_name": "maydan-game"'),
    source.replace('"bucket_name": "maydan-lamma-preview-audio"', '"bucket_name": "maydan-social-audio"'),
    source.replace('"workers_dev": true', '"workers_dev": true, "assets": { "directory": "public" }'),
  ]) assert.throws(() => assertErsomhaPreviewConfig(changed));
});

test('D1 acceptance reads require successful structured results despite CLI progress text', () => {
  assert.deepEqual(parsePreviewD1Result('Executing query...\n[{"success":true,"results":[{"n":0}]}]'), [{ n: 0 }]);
  assert.throws(() => parsePreviewD1Result('[{"success":false,"results":[]}]'));
  assert.throws(() => parsePreviewD1Result('No JSON response'));
});

function fencedOutcome() {
  const before = { phase: 'draw', matchId: 1, round: 1, drawerId: 'fixture-drawer' };
  const stopped = { ...before, phase: 'over', reason: 'account_active_elsewhere',
    myChoices: [], myWord: null, revealedWord: 'fixture-selected-word', deadlineAt: null };
  const expectedLeases = ['fixture-account-a', 'fixture-account-b'].map(account_hash => ({
    account_hash, room_key: 'fixture-replacement-room', fence: 2, expires_at: 100_000 }));
  return { errorCode: 'PHASE', before, states: [structuredClone(stopped), structuredClone(stopped)],
    selectedWord: stopped.revealedWord, exposuresBefore: 4, exposuresAfter: 4,
    expectedLeases, observedLeases: structuredClone(expectedLeases), now: 20_000 };
}

test('stale-room PHASE or STALE is accepted only with fail-closed terminal and storage evidence', () => {
  for (const errorCode of ['ERSOMHA_ACTIVE_ELSEWHERE', 'PHASE', 'STALE']) {
    const outcome = fencedOutcome(); outcome.errorCode = errorCode;
    assert.equal(assertErsomhaStaleLeaseOutcome(outcome), true);
  }
  const renewed = fencedOutcome(); renewed.observedLeases.forEach(row => { row.expires_at += 30_000; });
  assert.equal(assertErsomhaStaleLeaseOutcome(renewed), true, 'Normal replacement lease renewal keeps its owner and fence.');
});

test('a generic phase error cannot hide arbitrary state, a new exposure or damage to replacement leases', () => {
  const mutations = [
    outcome => { outcome.states[0].phase = 'draw'; },
    outcome => { outcome.states[1].reason = 'all_left'; },
    outcome => { outcome.states[0].round++; },
    outcome => { outcome.states[1].matchId++; },
    outcome => { outcome.states[0].drawerId = 'new-drawer'; },
    outcome => { outcome.states[1].myChoices = [{ id: 'new-choice' }]; },
    outcome => { outcome.states[0].myWord = 'new-private-word'; },
    outcome => { outcome.states[1].revealedWord = 'new-private-word'; },
    outcome => { outcome.states[0].deadlineAt = 21_000; },
    outcome => { outcome.states.pop(); },
    outcome => { outcome.exposuresAfter++; },
    outcome => { outcome.observedLeases.pop(); },
    outcome => { outcome.observedLeases[1] = structuredClone(outcome.observedLeases[0]); },
    outcome => { outcome.observedLeases[0].room_key = 'fixture-old-room'; },
    outcome => { outcome.observedLeases[0].fence++; },
    outcome => { outcome.observedLeases[1].expires_at = 0; },
    outcome => { outcome.observedLeases[1].expires_at--; },
    outcome => { outcome.errorCode = 'TIMEOUT'; },
  ];
  for (const mutate of mutations) {
    const outcome = fencedOutcome(); mutate(outcome);
    assert.throws(() => assertErsomhaStaleLeaseOutcome(outcome));
  }
});

test('explicit preview-only invocation is required before any network, database or fixture work', async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw Error('Unexpected network'); };
  try {
    await assert.rejects(runErsomhaPreviewAcceptance([]), /Explicit --run-preview/);
    await assert.rejects(runErsomhaPreviewAcceptance(['--run-preview', '--origin', 'https://maydan-game.mf103871.workers.dev']), /Explicit --run-preview/);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});
