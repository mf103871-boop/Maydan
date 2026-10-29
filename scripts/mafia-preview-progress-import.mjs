// Optional manual preview operation. Default: read-only dry-run. No RPC, cron,
// migration application, deployment or production/resource override is provided.
// node scripts/mafia-preview-progress-import.mjs --contract cutover.json [--limit 50] [--apply]
//
// Supplied cutover evidence, NOT fetched/authenticated by this tool:
// {schemaVersion:1,scope:'mafia-preview-legacy-progress',activationConfirmed:true,
//  worker:'maydan-mafia-preview',databaseId:'<exact preview D1>',progressionPolicyVersion:1,
//  legacyCutoffAt:'ISO',progressionEnabledAt:'ISO',capturedAt:'ISO'}
// No contract, missing flag, future/stale/unconfirmed evidence: refuse before I/O
// to D1. Cutoff must not include results from the new reward policy.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertMafiaPreviewConfig, MAFIA_PREVIEW_TARGET, mafiaPreviewSHA256 } from './mafia-preview-manifest.mjs';
import { assertLegacyMafiaProgressCutover, importLegacyMafiaProgress, MAFIA_LEGACY_IMPORT_MAX_ROWS } from '../server/mafia-progress-legacy.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const CONFIG = path.join(ROOT, 'wrangler.mafia-preview.jsonc');
const execute = promisify(execFile);
const check = (condition, message) => { if (!condition) throw new Error(message); };

export function assertMafiaPreviewProgressImport(config, contract, now = Date.now()) {
  // Reuse A5's exact-resource checks; manual imports additionally require the
  // progression gate to be explicitly enabled before accepting cutover evidence.
  check(config?.vars?.MAFIA_PROGRESS_ENABLED === '1', 'Explicit preview MAFIA_PROGRESS_ENABLED=1 required.');
  assertMafiaPreviewConfig(config);
  check(contract?.worker === MAFIA_PREVIEW_TARGET.worker && contract?.databaseId === MAFIA_PREVIEW_TARGET.databaseId,
    'Exact preview cutover resource required.');
  assertLegacyMafiaProgressCutover(contract, now);
  return { worker: MAFIA_PREVIEW_TARGET.worker, databaseId: MAFIA_PREVIEW_TARGET.databaseId };
}

export async function runMafiaPreviewProgressImport({ config, contract, db, apply = false, limit = 50, now = Date.now() }) {
  const target = assertMafiaPreviewProgressImport(config, contract, now);
  const report = await importLegacyMafiaProgress({ DB: db, MAFIA_PROGRESS_ENABLED: '1' }, contract, { apply, limit, now });
  return { ...report, ...target, previewChanged: apply && report.imported > 0, productionChanged: false };
}

// Wrangler's SQL-file import executes as one transaction (the installed
// Wrangler's D1 executor rolls a failed file back). Render bound data as SQLite
// literals, never shell text. The lexer preserves ? inside SQL strings/comments.
export function renderMafiaImportSQL(sql, args = []) {
  let out = '', mode = '', at = 0;
  const literal = value => {
    if (value === null) return 'NULL';
    if (Number.isSafeInteger(value)) return String(value);
    check(typeof value === 'string' && !value.includes('\0'), 'Unsupported SQL binding.');
    return `'${value.replaceAll("'", "''")}'`;
  };
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i], next = sql[i + 1];
    if (mode === 'line') { out += c; if (c === '\n') mode = ''; continue; }
    if (mode === 'block') { out += c; if (c === '*' && next === '/') { out += next; i++; mode = ''; } continue; }
    if (mode) {
      out += c;
      if (c === mode) { if (next === mode) { out += next; i++; } else mode = ''; }
      continue;
    }
    if (c === '-' && next === '-') { out += c + next; i++; mode = 'line'; }
    else if (c === '/' && next === '*') { out += c + next; i++; mode = 'block'; }
    else if (c === "'" || c === '"') { mode = c; out += c; }
    else if (c === '?') { check(at < args.length, 'SQL binding count mismatch.'); out += literal(args[at++]); }
    else out += c;
  }
  check(at === args.length && (mode === '' || mode === 'line'), 'SQL binding count mismatch.');
  return out;
}

export function createMafiaPreviewImportDB({ configHash, configPath = CONFIG, executeFile = execute, readConfig = () => readFile(CONFIG, 'utf8') } = {}) {
  // Public API is deliberately locked even when called by another local script.
  check(configPath === CONFIG && /^[a-f0-9]{64}$/.test(configHash || ''), 'Pinned preview configuration required.');
  async function call(sql, batch = false) {
    const source = await readConfig();
    check(mafiaPreviewSHA256(source) === configHash, 'Preview configuration changed during import.');
    const config = JSON.parse(source);
    check(config.vars?.MAFIA_PROGRESS_ENABLED === '1', 'Explicit preview progression gate required.');
    assertMafiaPreviewConfig(config);
    let temporary;
    try {
      const args = [path.join(ROOT, 'node_modules/wrangler/bin/wrangler.js'), 'd1', 'execute', MAFIA_PREVIEW_TARGET.databaseName,
        '--remote', '--config', CONFIG, '--json'];
      if (batch) {
        const cache = path.join(ROOT, '.cache'); await mkdir(cache, { recursive: true });
        temporary = await mkdtemp(path.join(cache, 'mafia-progress-import-'));
        const filename = path.join(temporary, 'batch.sql');
        await writeFile(filename, sql, { encoding: 'utf8', mode: 0o600 }); args.push('--file', filename, '--yes');
      } else args.push('--command', sql);
      let response;
      try {
        const { stdout } = await executeFile(process.execPath, args, { cwd: ROOT, windowsHide: true, maxBuffer: 8 * 1024 * 1024, timeout: 60_000 });
        response = JSON.parse(stdout.trim());
      } catch { throw new Error('Preview D1 operation failed; outcome may be unknown. Run a dry-run before another apply.'); }
      check(Array.isArray(response) && response.length > 0 && response.every(item => item.success === true), 'Preview D1 did not confirm success.');
      return response;
    } finally {
      if (temporary) {
        check(path.resolve(temporary).startsWith(path.join(ROOT, '.cache') + path.sep), 'Invalid temporary SQL directory.');
        await rm(temporary, { recursive: true, force: true });
      }
    }
  }
  class Statement {
    constructor(sql, args = []) { this.sql = sql; this.args = args; }
    bind(...args) { return new Statement(this.sql, args); }
    async all() { return { results: (await call(renderMafiaImportSQL(this.sql, this.args))).flatMap(item => item.results || []) }; }
    async first() { return (await this.all()).results[0] || null; }
  }
  return { prepare: sql => new Statement(sql), batch: statements => call(statements.map(statement => renderMafiaImportSQL(statement.sql, statement.args).trim().replace(/;?$/, ';')).join('\n'), true) };
}

export async function mafiaPreviewProgressImportCLI(argv = process.argv.slice(2)) {
  let contractPath, apply = false, dryRun = false, limit = 50;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--contract') { check(!contractPath && argv[i + 1] && !argv[i + 1].startsWith('--'), 'One cutover contract file required.'); contractPath = argv[++i]; }
    else if (arg === '--limit') { check(/^[1-9]\d*$/.test(argv[i + 1] || ''), 'Invalid row limit.'); limit = Number(argv[++i]); }
    else if (arg === '--apply') apply = true;
    else if (arg === '--dry-run') dryRun = true;
    else throw new Error('Unsupported import argument.');
  }
  check(contractPath && !(apply && dryRun), 'A confirmed cutover contract is required; dry-run is the default.');
  check(Number.isSafeInteger(limit) && limit >= 1 && limit <= MAFIA_LEGACY_IMPORT_MAX_ROWS, `Row limit must be 1..${MAFIA_LEGACY_IMPORT_MAX_ROWS}.`);
  const [configSource, contractSource] = await Promise.all([readFile(CONFIG, 'utf8'), readFile(path.resolve(contractPath), 'utf8')]);
  check(Buffer.byteLength(contractSource) <= 16_384, 'Cutover contract is too large.');
  let config, contract;
  try { config = JSON.parse(configSource); contract = JSON.parse(contractSource); }
  catch { throw new Error('Valid preview configuration and cutover JSON required.'); }
  assertMafiaPreviewProgressImport(config, contract);
  const db = createMafiaPreviewImportDB({ configHash: mafiaPreviewSHA256(configSource) });
  return runMafiaPreviewProgressImport({ config, contract, db, apply, limit });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.stdout.write(JSON.stringify(await mafiaPreviewProgressImportCLI(), null, 2) + '\n'); }
  catch (error) { process.stderr.write((error?.code || error?.message || 'Preview progress import failed.') + '\n'); process.exitCode = 1; }
}
