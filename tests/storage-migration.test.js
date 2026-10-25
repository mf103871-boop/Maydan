import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { migrateHtml } from '../scripts/ios/native.mjs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const swift = read('ios/Maydan/StorageMigration.swift');
const game = read('ios/Maydan/GameViewController.swift');
const seedTemplate = swift.match(/let source = """\n([\s\S]*?)\n\s*"""/)[1];
const reader = migrateHtml().match(/<script>([\s\S]*?)<\/script>/)[1];
function execute(script, localStorage) {
  const messages = [];
  vm.runInNewContext(script, { localStorage, window: { webkit: { messageHandlers: { maydan: {
    postMessage: value => messages.push(JSON.parse(JSON.stringify(value)))
  } } } } });
  return messages;
}
function seed(entries, storage, token = 'current-seed') {
  return execute(seedTemplate.replace('\\(json)', JSON.stringify(Object.entries(entries))).replace('\\(token)', token), storage)[0];
}
function store(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { data, get length() { return data.size; }, key: i => [...data.keys()][i] ?? null,
    getItem: key => data.has(key) ? data.get(key) : null, setItem: (key, value) => data.set(key, value) };
}

test('legacy reader distinguishes genuinely empty storage from failed or partial reads', () => {
  assert.deepEqual(execute(reader, store())[0], { type: 'migrate', entries: {}, succeeded: true });
  const readable = store({ progress: 'round-3', settings: 'quiet' });
  assert.deepEqual(execute(reader, readable)[0], { type: 'migrate', entries: { progress: 'round-3', settings: 'quiet' }, succeeded: true });
  let calls = 0;
  const partial = store({ progress: 'round-3', settings: 'quiet' });
  const get = partial.getItem;
  partial.getItem = key => { if (++calls === 2) throw new Error('SecurityError'); return get(key); };
  assert.deepEqual(execute(reader, partial)[0], { type: 'migrate', entries: {}, succeeded: false });
  assert.deepEqual(execute(reader, { get length() { throw new Error('Storage unavailable'); } })[0],
    { type: 'migrate', entries: {}, succeeded: false });
});

test('seed verifies actual writes and preserves newer keys, including special property names', () => {
  const storage = store({ settings: 'new-settings' });
  const entries = JSON.parse('{"progress":"round-3","settings":"old-settings","__proto__":"saved-value"}');
  assert.deepEqual(seed(entries, storage), { type: 'migrationSeedResult', token: 'current-seed', succeeded: true, verifiedCount: 3 });
  assert.equal(storage.getItem('progress'), 'round-3');
  assert.equal(storage.getItem('settings'), 'new-settings');
  assert.equal(storage.getItem('__proto__'), 'saved-value');
});

test('quota and silent write failures report failure; partial copies resume idempotently after recovery', () => {
  const entries = { first: 'one', second: 'two', third: 'three' };
  const storage = store();
  const originalSet = storage.setItem;
  storage.setItem = (key, value) => { if (key === 'second') throw new Error('QuotaExceededError'); originalSet(key, value); };
  assert.deepEqual(seed(entries, storage), { type: 'migrationSeedResult', token: 'current-seed', succeeded: false, verifiedCount: 1 });
  assert.equal(storage.data.size, 1);
  storage.setItem = originalSet;
  assert.deepEqual(seed(entries, storage, 'retry-seed'), { type: 'migrationSeedResult', token: 'retry-seed', succeeded: true, verifiedCount: 3 });
  assert.deepEqual(Object.fromEntries(storage.data), entries);
  const silent = store(); silent.setItem = () => {};
  assert.equal(seed(entries, silent).succeeded, false);
  assert.equal(seed(entries, silent).verifiedCount, 0);
});

test('native commits only the current complete acknowledgement and stages before game defaults run', () => {
  const accept = swift.slice(swift.indexOf('func acceptSeedResult'), swift.indexOf('func abandonSeed'));
  assert.match(accept, /payload\["token"\] as\? String == token/);
  assert.match(accept, /payload\["succeeded"\] as\? Bool == true && payload\["verifiedCount"\] as\? Int == expectedSeedCount/);
  assert.match(accept, /if succeeded \{ markDone\(\) \}/);
  const didFinish = game.slice(game.indexOf('didFinish navigation:'), game.indexOf('#if targetEnvironment(simulator)', game.indexOf('didFinish navigation:')));
  assert.doesNotMatch(didFinish, /markDone\(\)/);
  assert.match(game, /webView\.load\(URLRequest\(url: AppSchemeHandler\.migrationURL\)\)/);
  assert.match(game, /pageURL == AppSchemeHandler\.migrationURL,[\s\S]*migration\?\.acceptSeedResult\(payload\)/);
  assert.match(game, /retained\.forEach \{ controller\.addUserScript\(\$0\) \}/);
  assert.doesNotMatch(swift, /maximumAttempts|attempts <|entries: \[:\], succeeded: true/);
  assert.match(swift, /body\["succeeded"\] as\? Bool == true/);
  assert.match(game, /إعادة المحاولة/);
  assert.match(game, /المتابعة الآن/);
});

test('staging process and navigation failures retain recovery rather than initialize game defaults', () => {
  const process = game.slice(game.indexOf('func webViewWebContentProcessDidTerminate'), game.indexOf('didFail navigation:'));
  const beforeReload = process.slice(0, process.indexOf('DispatchQueue.main.async'));
  assert.match(beforeReload, /if isCommittingMigration \{\s*finishMigrationSeed\(succeeded: false\)\s*return/);
  assert.match(beforeReload, /if webView\.url == AppSchemeHandler\.migrationURL \{\s*showMigrationRecovery\(\)\s*return/);
  for (const name of ['didFail navigation:', 'didFailProvisionalNavigation navigation:']) {
    const handler = game.slice(game.indexOf(name), game.indexOf('\n    }', game.indexOf(name)));
    assert.match(handler, /let current = migrationSeedNavigation, navigation === current/);
    assert.match(handler, /finishMigrationSeed\(succeeded: false\)/);
    assert.doesNotMatch(handler, /entryURL|markDone/);
  }
  const finish = game.slice(game.indexOf('private func finishMigrationSeed'), game.indexOf('private func showMigrationRecovery'));
  assert.match(finish, /migrationSeedNavigation = nil/);
  assert.match(finish, /migrationSeedTimeout\?\.invalidate\(\)/);
  assert.match(finish, /migration\?\.abandonSeed\(\)/);
});
