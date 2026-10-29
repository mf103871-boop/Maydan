import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createLocalD1 } from '../server/local-d1.mjs';
import { MAFIA_PREVIEW_TARGET, mafiaPreviewSHA256 } from '../scripts/mafia-preview-manifest.mjs';
import { assertMafiaPreviewProgressImport, runMafiaPreviewProgressImport, renderMafiaImportSQL,
  createMafiaPreviewImportDB, mafiaPreviewProgressImportCLI, parseMafiaWranglerResponse } from '../scripts/mafia-preview-progress-import.mjs';

const now = Date.now();
const contract = () => ({ schemaVersion: 1, scope: 'mafia-preview-legacy-progress', activationConfirmed: true,
  worker: MAFIA_PREVIEW_TARGET.worker, databaseId: MAFIA_PREVIEW_TARGET.databaseId, progressionPolicyVersion: 1,
  legacyCutoffAt: new Date(now - 60_000).toISOString(), progressionEnabledAt: new Date(now - 30_000).toISOString(), capturedAt: new Date(now).toISOString() });
async function config() { const value = JSON.parse(await readFile(new URL('../wrangler.mafia-preview.jsonc', import.meta.url), 'utf8')); value.vars.MAFIA_PROGRESS_ENABLED = '1'; return value; }

test('manual import is pinned to preview resources and refuses missing activation evidence before DB access', async () => {
  const good = await config(); let reads = 0;
  const db = { prepare() { reads++; throw new Error('must not read'); } };
  assert.deepEqual(assertMafiaPreviewProgressImport(good, contract(), now), { worker: MAFIA_PREVIEW_TARGET.worker, databaseId: MAFIA_PREVIEW_TARGET.databaseId });
  const mutations = [
    (c, e) => { e.activationConfirmed = false; }, (c, e) => { e.databaseId = 'production'; },
    (c, e) => { e.worker = 'maydan-game'; }, c => { c.d1_databases[0].database_id = 'production'; },
    c => { c.vars.MAFIA_PROGRESS_ENABLED = '0'; }, c => { delete c.vars.MAFIA_PROGRESS_ENABLED; },
    c => { c.durable_objects.bindings[0].script_name = 'maydan-game'; }, c => { c.d1_databases.push({ ...c.d1_databases[0] }); },
  ];
  for (const mutate of mutations) {
    const c = structuredClone(good), e = contract(); mutate(c, e);
    await assert.rejects(runMafiaPreviewProgressImport({ config: c, contract: e, db, apply: true, now }));
  }
  assert.equal(reads, 0);
});

test('SQL rendering keeps malicious stored content as data and ignores placeholder-looking literals/comments', async t => {
  const db = createLocalD1(); t.after(() => db.close());
  const text = "A'); DROP TABLE users; -- ?\n'second'";
  const sql = renderMafiaImportSQL("SELECT ? AS value,'?' AS quoted,? AS nullable /* ? */ -- ?\n", [text, null]);
  assert.deepEqual(await db.prepare(sql).first(), { value: text, quoted: '?', nullable: null });
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM users').first()).n, 0);
  assert.equal(renderMafiaImportSQL('SELECT ? AS "?"', [7]), 'SELECT 7 AS "?"');
  assert.throws(() => renderMafiaImportSQL('SELECT ?', []), /binding count/);
  assert.throws(() => renderMafiaImportSQL('SELECT 1', [1]), /binding count/);
  assert.throws(() => renderMafiaImportSQL('SELECT ?', [NaN]), /Unsupported SQL/);
});

test('CLI defaults to refusal without a contract and has no resource override or implied apply', async () => {
  await assert.rejects(mafiaPreviewProgressImportCLI([]), /confirmed cutover contract/);
  await assert.rejects(mafiaPreviewProgressImportCLI(['--database', 'production']), /Unsupported/);
  await assert.rejects(mafiaPreviewProgressImportCLI(['--contract', 'unused', '--apply', '--dry-run']), /confirmed cutover contract/);
  await assert.rejects(mafiaPreviewProgressImportCLI(['--contract', 'unused', '--limit', '101']), /Row limit/);
  assert.throws(() => createMafiaPreviewImportDB({ configHash: 'a'.repeat(64), configPath: 'wrangler.jsonc' }), /Pinned preview/);
});

test('the CLI adapter serializes the actual consumer batch atomically, pins arguments and removes temporary SQL', async t => {
  const local = createLocalD1(); t.after(() => local.close());
  const c = await config(), source = JSON.stringify(c), files = [], calls = [];
  await local.prepare('INSERT INTO users(id,name,created_at,updated_at) VALUES(?,?,?,?)').bind('preview-synthetic', 'Synthetic', now, now).run();
  await local.prepare("INSERT INTO mafia_results VALUES('preview-synthetic','preview:1','citizen','town','town',0,0,0,?)").bind(now - 120_000).run();
  const executeFile = async (command, args, options) => {
    calls.push({ command, args, options });
    assert.equal(args[args.indexOf('execute') + 1], MAFIA_PREVIEW_TARGET.databaseName);
    assert.ok(args.includes('--remote')); assert.ok(args.includes('--json'));
    assert.match(args[args.indexOf('--config') + 1], /wrangler\.mafia-preview\.jsonc$/);
    assert.equal(options.windowsHide, true);
    const at = args.indexOf('--file');
    if (at >= 0) {
      files.push(args[at + 1]); const sql = await readFile(args[at + 1], 'utf8');
      local.database.exec('BEGIN');
      try { local.database.exec(sql); local.database.exec('COMMIT'); }
      catch (error) { local.database.exec('ROLLBACK'); throw error; }
      return { stdout: '├ Checking if file needs uploading\n│\n├ 🌀 Uploading fixture.sql\n│ 🌀 Uploading complete.\n│\n' + JSON.stringify([{ success: true, results: [{ 'Total queries executed': 5 }], finalBookmark: 'fixture-bookmark', meta: { changes: 5 } }]) };
    }
    const rows = local.database.prepare(args[args.indexOf('--command') + 1]).all();
    return { stdout: JSON.stringify([{ success: true, results: rows }]) };
  };
  const db = createMafiaPreviewImportDB({ configHash: mafiaPreviewSHA256(source), readConfig: async () => source, executeFile });
  const report = await runMafiaPreviewProgressImport({ config: c, contract: contract(), db, apply: true, now });
  assert.equal(report.imported, 1); assert.equal(report.productionChanged, false); assert.equal(report.previewChanged, true);
  assert.deepEqual(await local.prepare('SELECT total_xp,legacy_matches FROM mafia_player_progress').first(), { total_xp: 0, legacy_matches: 1 });
  assert.equal(files.length, 1); assert.equal(calls.length, 4);
  await assert.rejects(readFile(files[0]), { code: 'ENOENT' });
  await local.exec('DELETE FROM mafia_progress_events;DELETE FROM mafia_player_progress;DELETE FROM mafia_role_progress;');
  await local.exec("CREATE TRIGGER fail_import BEFORE INSERT ON mafia_role_progress BEGIN SELECT RAISE(ABORT,'secret fixture error'); END;");
  await assert.rejects(runMafiaPreviewProgressImport({ config: c, contract: contract(), db, apply: true, now }), error => /outcome may be unknown/.test(error.message) && !error.message.includes('secret fixture'));
  assert.equal((await local.prepare('SELECT COUNT(*) n FROM mafia_progress_events').first()).n, 0);
  assert.equal((await local.prepare('SELECT COUNT(*) n FROM mafia_player_progress').first()).n, 0);
  await assert.rejects(readFile(files[1]), { code: 'ENOENT' });
});

test('file-mode parser accepts the installed Wrangler spinner preamble and one complete success acknowledgement', () => {
  const response = [{ results: [{ 'Total queries executed': 1, 'Rows read': 0, 'Rows written': 0, 'Database size (MB)': '0.01' }], success: true,
    finalBookmark: 'fixture-bookmark', meta: { duration: 1, rows_read: 0, rows_written: 0 } }];
  const json = JSON.stringify(response, null, 2);
  // Captured from the actual SELECT-only preview file probe; the opaque upload
  // filename/bookmark are replaced, and no row/account data is in this fixture.
  for (const prefix of ['', '├ Checking if file needs uploading\n│\n',
    '├ Checking if file needs uploading\r\n│\r\n├ 🌀 Uploading fixture.sql\r\n│ 🌀 Uploading complete.\r\n│\r\n',
    '\u001b[90m├\u001b[0m Checking if file needs uploading\n\n']) {
    assert.deepEqual(parseMafiaWranglerResponse(prefix + json, { fileMode: true }), response);
  }
  assert.deepEqual(parseMafiaWranglerResponse('[{"success":true,"results":[{"safe_probe":1}]}]'), [{ success: true, results: [{ safe_probe: 1 }] }]);
});

test('parser refuses ambiguous, unsuccessful and unfamiliar output instead of finding a success fragment', () => {
  const valid = JSON.stringify([{ success: true, results: [{ 'Total queries executed': 1 }], finalBookmark: 'fixture', meta: {} }]);
  const prefix = '├ Checking if file needs uploading\n\n';
  for (const output of ['ERROR secret fixture\n' + valid, prefix + 'Unexpected output\n' + valid, prefix + valid + '\n{}', prefix + '[]\n' + valid,
    prefix + valid.slice(0, -2), prefix + '[{"success":false,"results":[]}]', prefix + '[{"success":true,"results":[]}]',
    '[{"success":true,"results":[],"error":"failure"}]', '[{"success":true,"results":[],"errors":["failure"]}]', '{}', '']) {
    assert.throws(() => parseMafiaWranglerResponse(output, { fileMode: true }));
  }
  assert.throws(() => parseMafiaWranglerResponse(prefix + valid), /preamble/);
});

test('a nonzero process exit with success-looking stdout stays ambiguous and is never retried', async () => {
  const source = JSON.stringify(await config()); let calls = 0;
  const db = createMafiaPreviewImportDB({ configHash: mafiaPreviewSHA256(source), readConfig: async () => source,
    executeFile: async () => { calls++; throw Object.assign(new Error('private fixture diagnostic'), { code: 1, stdout: '[{"success":true,"results":[]}]' }); } });
  await assert.rejects(db.batch([db.prepare('SELECT 1 AS safe_probe')]), error => /outcome may be unknown/.test(error.message) && !error.message.includes('private fixture'));
  assert.equal(calls, 1);
});
