// طبقة D1 رقيقة: كل استعلامات الحسابات في مكان واحد، بلا SQL مبعثر في المسارات.
// تستعمل فقط prepare().bind().first()/all()/run() كي يعمل غلاف node:sqlite المحلي بالواجهة نفسها.
import { TRIAL_GAMES } from '../../src/shared/account/config.js';
import { mafiaDeleteStatements } from '../mafia-results.mjs';
import { failure } from './errors.mjs';
import { paddleEnvironmentOf } from './billing-environment.mjs';
import { socialDeleteStatements } from '../social/db.mjs';
import { profileDeleteStatements } from '../profiles/db.mjs';
import { moderationDeleteStatements } from '../moderation/db.mjs';
import { ersomhaDeleteStatements } from '../ersomha-history.mjs';
import { drawingReportDeleteStatements } from '../ersomha-reports.mjs';
import { designDeleteStatements } from '../design/cleanup.mjs';

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
// One primary D1 snapshot, private to the caller: never put this principal in a
// cross-request cache or expose its joined moderation columns as session data.
export async function sessionPrincipalById(env, id) {
  const row = await first(env, `SELECT s.*,u.id AS principal_id,u.name AS principal_name,
    u.email AS principal_email,u.created_at AS principal_created_at,
    ms.user_id AS principal_suspended,ms.reason AS principal_reason,ms.created_at AS principal_since
    FROM sessions s JOIN users u ON u.id=s.user_id
    LEFT JOIN moderation_suspensions ms ON ms.user_id=u.id WHERE s.id=?`, id);
  if (!row) return null;
  const { principal_id,principal_name,principal_email,principal_created_at,
    principal_suspended,principal_reason,principal_since,...session } = row;
  return { session,user:{id:principal_id,name:principal_name,email:principal_email,created_at:principal_created_at},
    suspension:principal_suspended ? {reason:principal_reason,since:principal_since} : null };
}
export async function insertSession(env, row) {
  await run(env, 'INSERT INTO sessions (id, user_id, secret_hash, client, created_at, last_seen, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    row.id, row.user_id, row.secret_hash, row.client || null, row.created_at, row.last_seen, row.expires_at);
  return row;
}
// Insert the replacement and retire its exact predecessor in one D1 batch.
// A sign-out or competing rotation that won first must not be overwritten.
export async function rotateSession(env, previous, next, now, revokedAt) {
  const clock = "MAX(?,CAST(ROUND((julianday('now')-2440587.5)*86400000) AS INTEGER))";
  const guard = `s.id=? AND s.user_id=? AND s.secret_hash=? AND s.expires_at>${clock} AND s.revoked_at IS NULL AND s.replaced_by IS NULL
    AND EXISTS(SELECT 1 FROM users WHERE id=?) AND NOT EXISTS(SELECT 1 FROM account_deletions WHERE user_id=?)`;
  const args = [previous.id, previous.user_id, previous.secret_hash, now, previous.user_id, previous.user_id];
  const result = await env.DB.batch([
    statement(env, `INSERT INTO sessions (id,user_id,secret_hash,client,created_at,last_seen,expires_at)
      SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM sessions s WHERE ${guard})`,
    [next.id,next.user_id,next.secret_hash,next.client,next.created_at,next.last_seen,next.expires_at,...args]),
    // The inserted random ID/hash is the authorization receipt inside this
    // atomic batch. Do not re-evaluate a deadline between its two statements.
    statement(env, `UPDATE sessions AS s SET revoked_at=?,replaced_by=? WHERE s.id=? AND s.user_id=? AND s.secret_hash=? AND s.revoked_at IS NULL AND s.replaced_by IS NULL
      AND EXISTS(SELECT 1 FROM sessions n WHERE n.id=? AND n.user_id=? AND n.secret_hash=?)`,
    [revokedAt,next.id,previous.id,previous.user_id,previous.secret_hash,next.id,next.user_id,next.secret_hash]),
  ]);
  return changed(result[0]) && changed(result[1]);
}
export const touchSession = (env, id, now) => run(env, `UPDATE sessions SET last_seen=?
  WHERE id=? AND expires_at>? AND revoked_at IS NULL AND replaced_by IS NULL`, now, id, now);
export const retireSession = (env, id, revokedAt, replacedBy) =>
  run(env, 'UPDATE sessions SET revoked_at = ?, replaced_by = ? WHERE id = ?', revokedAt, replacedBy || null, id);
// Exact revocation stays compatible with callers retiring an already-adopted bearer.
export const revokeSession = (env, id, now) => run(env, `UPDATE sessions
  SET revoked_at=CASE WHEN revoked_at IS NULL OR revoked_at>? THEN ? ELSE revoked_at END
  WHERE id=?`, now, now, id);
// Explicit current-device logout may also revoke this bearer's rotation successors.
export const revokeSessionChain = (env, id, now) => run(env, `WITH RECURSIVE session_chain(id,user_id) AS (
  SELECT id,user_id FROM sessions WHERE id=?
  UNION
  SELECT next.id,next.user_id FROM session_chain chain JOIN sessions previous ON previous.id=chain.id
    JOIN sessions next ON next.id=previous.replaced_by AND next.user_id=chain.user_id
) UPDATE sessions SET revoked_at=CASE WHEN revoked_at IS NULL OR revoked_at>? THEN ? ELSE revoked_at END
  WHERE id IN (SELECT id FROM session_chain)`, id, now, now);
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
export async function pruneAuthCodes(env, now) {
  await run(env, 'DELETE FROM auth_codes WHERE expires_at < ?', now - 3_600_000);
  await run(env, 'DELETE FROM auth_code_attempts WHERE expires_at < ?', now - 3_600_000);
}
// The browser that starts a sign-in holds a random attempt secret; the code minted for
// it is stored with the secret's hash and redeemable only together with the secret.
export const insertAuthCodeAttempt = (env, { codeHash, attemptHash, expiresAt }) =>
  run(env, 'INSERT OR REPLACE INTO auth_code_attempts (code_hash, attempt_hash, expires_at) VALUES (?, ?, ?)', codeHash, attemptHash, expiresAt);
export const authCodeAttempt = (env, codeHash) => first(env, 'SELECT attempt_hash FROM auth_code_attempts WHERE code_hash = ?', codeHash);

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
export async function upsertSubscription(env, row, { requireLiveOwner = false, requireExistingOwner = false } = {}) {
  const now = Date.now();
  const environment = row.source === 'paddle' ? row.environment || paddleEnvironmentOf(env) : row.environment || null;
  if (row.source === 'paddle') {
    const existing = await subscriptionByExternal(env, row.source, row.external_id);
    if (existing?.environment && existing.environment !== environment) failure('NOT_ELIGIBLE');
  }
  const needsOwner = requireLiveOwner || requireExistingOwner;
  const insertion = needsOwner
    ? `SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS(SELECT 1 FROM users WHERE id=?)${requireLiveOwner ? ' AND NOT EXISTS(SELECT 1 FROM account_deletions WHERE user_id=?)' : ''}`
    : 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
  await run(env, `INSERT INTO subscriptions (source, external_id, user_id, product, status, until, will_renew, environment, occurred_at, updated_at)
    ${insertion}
    ON CONFLICT (source, external_id) DO UPDATE SET
      user_id = excluded.user_id, product = excluded.product, status = excluded.status, until = excluded.until,
      will_renew = excluded.will_renew, environment = excluded.environment, occurred_at = excluded.occurred_at, updated_at = excluded.updated_at
    WHERE excluded.occurred_at >= subscriptions.occurred_at AND excluded.user_id = subscriptions.user_id
      AND (subscriptions.source != 'paddle' OR subscriptions.environment IS NULL OR subscriptions.environment = excluded.environment)`.replace(/\s+/g, ' '),
  row.source, row.external_id, row.user_id, row.product || null, row.status || null,
  Number(row.until) || 0, row.will_renew ? 1 : 0, environment, Number(row.occurred_at) || now, now,
  ...(needsOwner ? [row.user_id] : []), ...(requireLiveOwner ? [row.user_id] : []));
  if (needsOwner) return first(env, `SELECT s.* FROM subscriptions s JOIN users u ON u.id=s.user_id
    WHERE s.source=? AND s.external_id=?${requireLiveOwner ? ' AND NOT EXISTS(SELECT 1 FROM account_deletions WHERE user_id=s.user_id)' : ''}`, row.source, row.external_id);
  return subscriptionByExternal(env, row.source, row.external_id);
}

// ── أحداث الـwebhook (منع التكرار) ──────────────────────────────────────────
export const webhookEvent = (env, id) => first(env, 'SELECT id FROM webhook_events WHERE id = ?', id);
export async function markWebhookEvent(env, id, now = Date.now()) {
  const result = await run(env, 'INSERT OR IGNORE INTO webhook_events (id, received_at) VALUES (?, ?)', id, now);
  return (result?.meta?.changes ?? result?.meta?.rows_written ?? 0) > 0; // true = حدث جديد
}

// ── عملاء Paddle ────────────────────────────────────────────────────────────
export const legacyPaddleCustomerOf = (env, userId) => first(env, 'SELECT customer_id FROM paddle_customers WHERE user_id = ?', userId);
export const paddleCustomerOf = (env, userId) => first(env, 'SELECT customer_id FROM paddle_customers_scoped WHERE environment = ? AND user_id = ?', paddleEnvironmentOf(env), userId);
export const paddleUserOf = (env, customerId) => first(env, 'SELECT user_id FROM paddle_customers_scoped WHERE environment = ? AND customer_id = ?', paddleEnvironmentOf(env), customerId);
export async function setPaddleCustomer(env, userId, customerId, now = Date.now()) {
  const owner = await paddleUserOf(env, customerId);
  if (owner && owner.user_id !== userId) failure('ALREADY_LINKED');
  const legacyOwner = await first(env, 'SELECT user_id FROM paddle_customers WHERE customer_id = ?', customerId);
  if (legacyOwner && legacyOwner.user_id !== userId) failure('ALREADY_LINKED');
  return run(env, 'INSERT INTO paddle_customers_scoped (environment, user_id, customer_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(environment, user_id) DO UPDATE SET customer_id = excluded.customer_id', paddleEnvironmentOf(env), userId, customerId, now);
}

// A cross-worker reservation, not an expiring in-memory lock.
export const paddleCheckoutOf = (env, userId) => first(env, 'SELECT * FROM paddle_checkouts WHERE environment = ? AND user_id = ?', paddleEnvironmentOf(env), userId);
const changed = (result) => (result?.meta?.changes ?? result?.meta?.rows_written ?? 0) > 0;
export async function reservePaddleCheckout(env, userId, plan, priceId, attemptId, now = Date.now()) {
  return changed(await run(env, 'INSERT OR IGNORE INTO paddle_checkouts (environment, user_id, attempt_id, plan, price_id, state, created_at, updated_at) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM users WHERE id = ?) AND NOT EXISTS (SELECT 1 FROM account_deletions WHERE user_id = ?)', paddleEnvironmentOf(env), userId, attemptId, plan, priceId, 'creating', now, now, userId, userId));
}
export async function recordPaddleTransaction(env, userId, attemptId, transactionId, now = Date.now()) {
  return changed(await run(env, "UPDATE paddle_checkouts SET transaction_id = ?, state = 'ready', updated_at = ? WHERE environment = ? AND user_id = ? AND attempt_id = ? AND (transaction_id IS NULL OR transaction_id = ?)", transactionId, now, paddleEnvironmentOf(env), userId, attemptId, transactionId));
}
export const markPaddleCheckoutUnknown = (env, userId, attemptId) => run(env, "UPDATE paddle_checkouts SET state = 'unknown', updated_at = ? WHERE environment = ? AND user_id = ? AND attempt_id = ? AND transaction_id IS NULL", Date.now(), paddleEnvironmentOf(env), userId, attemptId);
export async function releasePaddleCheckout(env, userId, attemptId) {
  return changed(await run(env, 'DELETE FROM paddle_checkouts WHERE environment = ? AND user_id = ? AND attempt_id = ?', paddleEnvironmentOf(env), userId, attemptId));
}
// A deletion guard left behind by a request that died mid-flight (isolate eviction, CPU
// limit) used to lock the account out of checkout, deletion and social features for
// ever. Ten minutes is far longer than any deletion takes.
export const DELETION_STALE_MS = 10 * 60 * 1000;
export const releaseStaleDeletions = (env, now = Date.now()) => run(env, 'DELETE FROM account_deletions WHERE created_at < ?', now - DELETION_STALE_MS);
export async function reserveAccountDeletion(env, userId, attemptId, now = Date.now()) {
  await run(env, 'DELETE FROM account_deletions WHERE user_id = ? AND created_at < ?', userId, now - DELETION_STALE_MS);
  return changed(await run(env, 'INSERT OR IGNORE INTO account_deletions (user_id, attempt_id, created_at) SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM users WHERE id = ?)', userId, attemptId, now, userId));
}
export const releaseAccountDeletion = (env, userId, attemptId) => run(env, 'DELETE FROM account_deletions WHERE user_id = ? AND attempt_id = ?', userId, attemptId);

// ── الحذف المتسلسل ──────────────────────────────────────────────────────────
export async function deleteUser(env, userId) {
  const statements = ['sessions', 'auth_codes', 'trials', 'online_room_trial_claims', 'subscriptions', 'paddle_customers', 'paddle_customers_scoped', 'paddle_checkouts', 'account_deletions', 'identities', 'plus_cosmetics', 'plus_setup_presets', 'mafia_tutorial_status']
    .map((table) => statement(env, `DELETE FROM ${table} WHERE user_id = ?`, [userId]));
  // This additive directory is off until its migration is applied. Remove the
  // derived membership locator explicitly, including on D1 without FK cascades.
  if(String(env.ONLINE_PUBLIC_DIRECTORY_ENABLED)==='1')statements.push(statement(env,
    'DELETE FROM online_public_rooms WHERE host_user_id=? OR EXISTS(SELECT 1 FROM json_each(online_public_rooms.member_user_ids) member WHERE member.value=?)', [userId,userId]));
  statements.push(...await ersomhaDeleteStatements(env, userId), ...drawingReportDeleteStatements(env, userId));
  statements.push(...mafiaDeleteStatements(env,userId));
  statements.push(...moderationDeleteStatements(env, userId));
  statements.push(...socialDeleteStatements(env, userId));
  statements.push(...profileDeleteStatements(env, userId));
  statements.push(...designDeleteStatements(env, userId));
  statements.push(statement(env, 'DELETE FROM users WHERE id = ?', [userId]));
  // D1 batch is transactional: a failed delete cannot strand a partial account.
  await env.DB.batch(statements);
}
