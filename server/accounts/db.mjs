// طبقة D1 رقيقة: كل استعلامات الحسابات في مكان واحد، بلا SQL مبعثر في المسارات.
// تستعمل فقط prepare().bind().first()/all()/run() كي يعمل غلاف node:sqlite المحلي بالواجهة نفسها.
import { TRIAL_GAMES } from '../../src/shared/account/config.js';

function statement(env, sql, args) {
  const prepared = env.DB.prepare(sql);
  return args.length ? prepared.bind(...args.map((value) => (value === undefined ? null : value))) : prepared;
}
export const first = (env, sql, ...args) => statement(env, sql, args).first();
export const run = (env, sql, ...args) => statement(env, sql, args).run();
export const all = async (env, sql, ...args) => (await statement(env, sql, args).all()).results || [];

export const uuid = () => crypto.randomUUID();

// ── المستخدمون والهويات ──────────────────────────────────────────────────────
export async function userById(env, id) {
  return first(env, 'SELECT id, name, email, created_at FROM users WHERE id = ?', id);
}
export async function createUser(env, { name = null, email = null, now = Date.now() } = {}) {
  const id = uuid();
  await run(env, 'INSERT INTO users (id, name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', id, name, email, now, now);
  return { id, name, email, created_at: now };
}
// تُنشئ الحساب عند أول دخول، وتُكمل الاسم/البريد لاحقًا دون مسح ما لدينا.
export async function linkIdentity(env, { provider, subject, name = null, email = null, refreshToken = null, now = Date.now() }) {
  if (!provider || !subject) throw new Error('identity requires provider and subject');
  const existing = await first(env, 'SELECT user_id FROM identities WHERE provider = ? AND subject = ?', provider, subject);
  if (existing) {
    if (email || refreshToken) {
      await run(env, 'UPDATE identities SET email = COALESCE(?, email), refresh_token = COALESCE(?, refresh_token) WHERE provider = ? AND subject = ?',
        email, refreshToken, provider, subject);
    }
    if (name || email) {
      await run(env, 'UPDATE users SET name = COALESCE(name, ?), email = COALESCE(?, email), updated_at = ? WHERE id = ?',
        name, email, now, existing.user_id);
    }
    return userById(env, existing.user_id);
  }
  const user = await createUser(env, { name, email, now });
  await run(env, 'INSERT INTO identities (provider, subject, user_id, email, refresh_token, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    provider, subject, user.id, email, refreshToken, now);
  return user;
}
export const identitiesOf = (env, userId) => all(env, 'SELECT provider, subject, refresh_token FROM identities WHERE user_id = ?', userId);

// ── الجلسات ─────────────────────────────────────────────────────────────────
export const sessionById = (env, id) => first(env, 'SELECT * FROM sessions WHERE id = ?', id);
export async function insertSession(env, row) {
  await run(env, 'INSERT INTO sessions (id, user_id, secret_hash, client, created_at, last_seen, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    row.id, row.user_id, row.secret_hash, row.client || null, row.created_at, row.last_seen, row.expires_at);
  return row;
}
export const touchSession = (env, id, now) => run(env, 'UPDATE sessions SET last_seen = ? WHERE id = ?', now, id);
export const retireSession = (env, id, revokedAt, replacedBy) =>
  run(env, 'UPDATE sessions SET revoked_at = ?, replaced_by = ? WHERE id = ?', revokedAt, replacedBy || null, id);
export const revokeSession = (env, id, now) => run(env, 'UPDATE sessions SET revoked_at = ? WHERE id = ?', now, id);
export const revokeAllSessions = (env, userId, now) => run(env, 'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', now, userId);

// ── رموز الدخول لمرة واحدة ──────────────────────────────────────────────────
export const insertAuthCode = (env, { codeHash, userId, client, expiresAt }) =>
  run(env, 'INSERT INTO auth_codes (code_hash, user_id, client, expires_at) VALUES (?, ?, ?, ?)', codeHash, userId, client, expiresAt);
export const authCode = (env, codeHash) => first(env, 'SELECT * FROM auth_codes WHERE code_hash = ?', codeHash);
// الاستهلاك مشروط بـused_at IS NULL: محاولتان متزامنتان لا تنجحان معًا.
export async function useAuthCode(env, codeHash, now) {
  const result = await run(env, 'UPDATE auth_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?', now, codeHash, now);
  return (result?.meta?.changes ?? result?.meta?.rows_written ?? 0) > 0;
}
export const pruneAuthCodes = (env, now) => run(env, 'DELETE FROM auth_codes WHERE expires_at < ?', now - 3_600_000);

// ── التجارب المجانية ────────────────────────────────────────────────────────
export async function trialsOf(env, userId) {
  const rows = await all(env, 'SELECT game FROM trials WHERE user_id = ?', userId);
  const trials = {};
  for (const row of rows) if (TRIAL_GAMES.includes(row.game)) trials[row.game] = true;
  return trials;
}
export const addTrial = (env, userId, game, now = Date.now()) =>
  run(env, 'INSERT OR IGNORE INTO trials (user_id, game, created_at) VALUES (?, ?, ?)', userId, game, now);

// ── الاشتراكات ──────────────────────────────────────────────────────────────
export const subscriptionsOf = (env, userId) =>
  all(env, 'SELECT source, external_id, product, status, until, will_renew, environment, occurred_at FROM subscriptions WHERE user_id = ?', userId);
export const subscriptionByExternal = (env, source, externalId) =>
  first(env, 'SELECT * FROM subscriptions WHERE source = ? AND external_id = ?', source, externalId);
// التحديث رتيب: إشعار قديم يصل متأخرًا لا يُرجع الحالة إلى الوراء (occurred_at).
export async function upsertSubscription(env, row) {
  const now = Date.now();
  await run(env, `INSERT INTO subscriptions (source, external_id, user_id, product, status, until, will_renew, environment, occurred_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (source, external_id) DO UPDATE SET
      user_id = excluded.user_id, product = excluded.product, status = excluded.status, until = excluded.until,
      will_renew = excluded.will_renew, environment = excluded.environment, occurred_at = excluded.occurred_at, updated_at = excluded.updated_at
    WHERE excluded.occurred_at >= subscriptions.occurred_at`.replace(/\s+/g, ' '),
  row.source, row.external_id, row.user_id, row.product || null, row.status || null,
  Number(row.until) || 0, row.will_renew ? 1 : 0, row.environment || null, Number(row.occurred_at) || now, now);
  return subscriptionByExternal(env, row.source, row.external_id);
}

// ── أحداث الـwebhook (منع التكرار) ──────────────────────────────────────────
export async function markWebhookEvent(env, id, now = Date.now()) {
  const result = await run(env, 'INSERT OR IGNORE INTO webhook_events (id, received_at) VALUES (?, ?)', id, now);
  return (result?.meta?.changes ?? result?.meta?.rows_written ?? 0) > 0; // true = حدث جديد
}

// ── عملاء Paddle ────────────────────────────────────────────────────────────
export const paddleCustomerOf = (env, userId) => first(env, 'SELECT customer_id FROM paddle_customers WHERE user_id = ?', userId);
export const paddleUserOf = (env, customerId) => first(env, 'SELECT user_id FROM paddle_customers WHERE customer_id = ?', customerId);
export const setPaddleCustomer = (env, userId, customerId, now = Date.now()) =>
  run(env, 'INSERT OR REPLACE INTO paddle_customers (user_id, customer_id, created_at) VALUES (?, ?, ?)', userId, customerId, now);

// ── الحذف المتسلسل ──────────────────────────────────────────────────────────
export async function deleteUser(env, userId) {
  for (const table of ['sessions', 'auth_codes', 'trials', 'subscriptions', 'paddle_customers', 'identities']) {
    await run(env, `DELETE FROM ${table} WHERE user_id = ?`, userId);
  }
  await run(env, 'DELETE FROM users WHERE id = ?', userId);
}
