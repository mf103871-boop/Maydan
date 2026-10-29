import test from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../server/room.mjs';
import { MemoryStorage } from '../server/local.mjs';
import { MAFIA_RULESET_VERSION } from '../src/online/mafia-shared.js';
import { mafiaAcceptsNewMatches, requireMafiaNewMatches, assertSupportedMafiaRuleset,
  assertMafiaRulesetUpgrade, MAFIA_SUPPORTED_RULESET_VERSIONS } from '../server/mafia-ruleset-policy.mjs';

test('Mafia admission has a separate fail-closed maintenance gate without changing existing environments', () => {
  for (const value of [undefined, '1', 1]) assert.equal(mafiaAcceptsNewMatches({ MAFIA_ACCEPT_NEW_MATCHES: value }), true);
  for (const value of ['0', 0, '', 'true', 'false', ' 1 ', 'invalid']) {
    assert.equal(mafiaAcceptsNewMatches({ MAFIA_ACCEPT_NEW_MATCHES: value }), false);
    assert.throws(() => requireMafiaNewMatches({ MAFIA_ACCEPT_NEW_MATCHES: value }), { code: 'MAFIA_DRAINING', status: 503 });
  }
});

test('only the explicit ruleset registry may interpret a saved Mafia match; legacy v1 is preserved', () => {
  assert.equal(MAFIA_RULESET_VERSION, 1);
  assert.deepEqual(MAFIA_SUPPORTED_RULESET_VERSIONS, [1]);
  for (const rulesetVersion of [undefined, 1]) {
    const room = { game: 'mafia', rulesetVersion }, before = structuredClone(room);
    assert.equal(assertSupportedMafiaRuleset(room), 1); assert.deepEqual(room, before);
  }
  for (const rulesetVersion of [0, -1, 2, null, '1', NaN, {}, []]) {
    assert.throws(() => assertSupportedMafiaRuleset({ game: 'mafia', rulesetVersion }), { code: 'MAFIA_RULESET_UNSUPPORTED', status: 503 });
  }
  assert.doesNotThrow(() => assertSupportedMafiaRuleset({ game: 'ersomha', rulesetVersion: 999 }));
});

test('a restored unsupported ruleset returns only a public error and stays frozen through alarm retries', async t => {
  const storage = new MemoryStorage(); t.after(() => storage.dispose());
  const saved = { game: 'mafia', rulesetVersion: 999, phase: 'night', matchId: 4,
    roleStates: { alice: { role: 'PRIVATE_ROLE' } }, privateEvents: { alice: ['PRIVATE_EVENT'] }, tokenHash: 'PRIVATE_HASH' };
  await storage.put('room', saved);
  const ctx = { storage, blockConcurrencyWhile: fn => fn(), getWebSockets: () => [], setWebSocketAutoResponse() {} };
  const room = new Room(ctx, {}); await room.ready;
  const response = await room.fetch(new Request('https://internal/123456/join', { method: 'POST' }));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'MAFIA_RULESET_UNSUPPORTED' });
  assert.throws(() => room.stateFor('alice'), { code: 'MAFIA_RULESET_UNSUPPORTED' });
  await assert.rejects(room.commit({ ...saved, rulesetVersion: 1 }), { code: 'MAFIA_RULESET_UNSUPPORTED' });
  await room.alarm();
  assert.deepEqual(room.room, saved); assert.deepEqual(await storage.get('room'), saved);
  assert.equal(room.room.technicalAbort, undefined);
});

test('ruleset changes require fresh complete drain evidence; same-version updates do not stop active matches', () => {
  const now = Date.parse('2026-10-30T10:00:00Z');
  const drain = { scope: 'all-mafia-rooms', acceptingNewMatches: false, activeMatches: 0, pendingStarts: 0,
    capturedAt: new Date(now - 1000).toISOString() };
  const evidence = { fromVersion: 1, toVersion: 2, drain };
  assert.deepEqual(assertMafiaRulesetUpgrade(evidence, now), { passed: true, rulesetChanged: true, fromVersion: 1, toVersion: 2, productionChanged: false });
  assert.equal(assertMafiaRulesetUpgrade({ fromVersion: 1, toVersion: 1 }, now).rulesetChanged, false);
  for (const badDrain of [undefined, {}, { ...drain, scope: 'public-directory' }, { ...drain, acceptingNewMatches: true },
    { ...drain, activeMatches: 1 }, { ...drain, activeMatches: '0' }, { ...drain, pendingStarts: 1 },
    { ...drain, capturedAt: new Date(now - 60_001).toISOString() }, { ...drain, capturedAt: new Date(now + 1).toISOString() },
    { ...drain, capturedAt: 'invalid' }]) {
    assert.throws(() => assertMafiaRulesetUpgrade({ ...evidence, drain: badDrain }, now), { code: 'MAFIA_RULESET_DRAIN_REQUIRED' });
  }
  for (const badVersion of [undefined, 0, -1, '1', NaN]) {
    assert.throws(() => assertMafiaRulesetUpgrade({ ...evidence, fromVersion: badVersion }, now), { code: 'MAFIA_RULESET_DRAIN_REQUIRED' });
  }
});
