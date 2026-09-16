// غلاف D1 فوق node:sqlite للتطوير المحلي والاختبارات: الواجهة نفسها التي تستعملها
// server/accounts/db.mjs (prepare().bind().first()/all()/run()/raw() وbatch()/exec()).
// الإنتاج يبقى Cloudflare D1؛ هذا الملف لا يُنشر ضمن العامل.
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

// SQLite لا يقبل undefined ولا القيم المنطقية؛ نحوّلها كما يفعل D1.
const bindable = (value) => {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number' && !Number.isInteger(value)) return value;
  return value;
};
const plain = (row) => (row ? { ...row } : row);

class LocalStatement {
  constructor(database, sql, args = null) { this.database = database; this.sql = sql; this.args = args; }
  bind(...args) { return new LocalStatement(this.database, this.sql, args.map(bindable)); }
  statement() { return this.database.prepare(this.sql); }
  async first(column) {
    const row = this.statement().get(...(this.args || []));
    if (row === undefined) return null;
    return column === undefined ? plain(row) : (row[column] ?? null);
  }
  async all() {
    const results = this.statement().all(...(this.args || [])).map(plain);
    return { success: true, results, meta: { changes: 0, duration: 0, rows_read: results.length, rows_written: 0 } };
  }
  async raw() { return this.statement().all(...(this.args || [])).map((row) => Object.values(row)); }
  async run() {
    const result = this.statement().run(...(this.args || []));
    const changes = Number(result.changes || 0);
    return { success: true, results: [], meta: { changes, duration: 0, last_row_id: Number(result.lastInsertRowid || 0), rows_read: 0, rows_written: changes } };
  }
}

export class LocalD1 {
  constructor(location = ':memory:') { this.database = new DatabaseSync(location); this.database.exec('PRAGMA foreign_keys = ON'); }
  prepare(sql) { return new LocalStatement(this.database, sql); }
  // D1 ينفّذ الدفعة داخل معاملة واحدة؛ نقلّدها كي يتطابق السلوك عند الفشل.
  async batch(statements) {
    this.database.exec('BEGIN');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec('COMMIT');
      return results;
    } catch (error) { this.database.exec('ROLLBACK'); throw error; }
  }
  async exec(sql) {
    this.database.exec(sql);
    return { count: sql.split(';').filter((part) => part.trim()).length, duration: 0 };
  }
  async dump() { throw new Error('dump is not supported locally'); }
  close() { this.database.close(); }
}

// جمل الترحيل مقروءة من server/migrations بالترتيب، بلا تعليقات ولا أسطر فارغة.
// D1 `exec` يقسم مدخله على الأسطر، لذلك نُعيد كل جملة في سطر واحد.
export function migrationStatements(directory = MIGRATIONS_DIR) {
  const files = readdirSync(directory).filter((name) => name.endsWith('.sql')).sort();
  const statements = [];
  for (const name of files) {
    const text = readFileSync(path.join(directory, name), 'utf8')
      .split('\n').map((line) => line.replace(/--.*$/, '')).join('\n');
    for (const part of text.split(';')) {
      const statement = part.replace(/\s+/g, ' ').trim();
      if (statement) statements.push(`${statement};`);
    }
  }
  return statements;
}
export const migrationSql = (directory) => migrationStatements(directory).join('\n');

export function createLocalD1({ location = ':memory:', directory = MIGRATIONS_DIR } = {}) {
  const database = new LocalD1(location);
  for (const statement of migrationStatements(directory)) database.database.exec(statement);
  return database;
}
