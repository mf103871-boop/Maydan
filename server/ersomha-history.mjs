import { fail } from './room-model.mjs';
import { sha256 } from './protocol.mjs';
import { liveAccountSql } from './moderation/access.mjs';

export const ERSOMHA_LEASE_MS = 90_000;
export const ERSOMHA_RENEW_MS = 30_000;
const stmt = (env, sql, ...args) => env.DB.prepare(sql).bind(...args);
const rows = async (env, sql, ...args) => (await stmt(env, sql, ...args).all()).results || [];
export const ersomhaAccountHash = id => sha256(`maydan:ersomha:account:${id}`);
const placeholders = values => values.map(() => '?').join(',');
function database(env) { if (!env.DB) fail('ERSOMHA_UNAVAILABLE', 503); }
export async function ersomhaAccounts(room) {
  const members = room.members.filter(m => !m.left && room.participants.includes(m.id));
  if (!members.length || members.some(m => typeof m.accountUserId !== 'string' || !m.accountUserId)) fail('LOGIN_REQUIRED', 401);
  const accounts = await Promise.all(members.map(async m => ({ userId: m.accountUserId, hash: await ersomhaAccountHash(m.accountUserId) })));
  if (new Set(accounts.map(a => a.hash)).size !== accounts.length) fail('ACCOUNT_IN_ROOM', 409);
  return accounts;
}
async function liveAccounts(env, accounts) {
  const ids = accounts.map(a => a.userId);
  const live = await rows(env, `SELECT id FROM users WHERE id IN (${placeholders(ids)}) AND ${liveAccountSql('users.id')}`, ...ids);
  if (live.length !== ids.length) fail('AUTH', 401);
}
function liveAccountGuard(accounts) {
  return { sql: `(SELECT COUNT(*) FROM users WHERE id IN (${placeholders(accounts)}) AND ${liveAccountSql('users.id')})=?`,
    args: [...accounts.map(a => a.userId), accounts.length] };
}
function leaseGuard(lease, now) {
  // The entire set, including each generation, must still belong to this room.
  const alternatives = lease.accounts.map(() => '(account_hash=? AND fence=?)').join(' OR ');
  const live = liveAccountGuard(lease.accounts);
  return { sql: `(SELECT COUNT(*) FROM ersomha_leases WHERE room_key=? AND lease_token=? AND expires_at>? AND (${alternatives}))=? AND ${live.sql}`,
    args: [lease.roomKey, lease.token, now, ...lease.accounts.flatMap(a => [a.hash, a.fence]), lease.accounts.length, ...live.args] };
}
export async function acquireErsomhaLease(env, room, now = Date.now()) {
  database(env);
  const accounts = await ersomhaAccounts(room); await liveAccounts(env, accounts);
  const roomKey = room.ersomhaKey, token = room.ersomhaLeaseToken;
  const hashes = accounts.map(a => a.hash), list = placeholders(hashes);
  const live = liveAccountGuard(accounts);
  const conflict = `NOT EXISTS(SELECT 1 FROM ersomha_leases WHERE account_hash IN (${list}) AND expires_at>? AND (room_key!=? OR lease_token!=?))`;
  const queries = accounts.map(a => stmt(env, `INSERT INTO ersomha_leases(account_hash,room_key,lease_token,fence,expires_at,updated_at)
    SELECT ?,?,?,1,?,? WHERE ${live.sql} AND ${conflict}
    ON CONFLICT(account_hash) DO UPDATE SET room_key=excluded.room_key,lease_token=excluded.lease_token,
    fence=CASE WHEN ersomha_leases.room_key=excluded.room_key AND ersomha_leases.lease_token=excluded.lease_token THEN ersomha_leases.fence ELSE ersomha_leases.fence+1 END,
    expires_at=excluded.expires_at,updated_at=excluded.updated_at
    WHERE ersomha_leases.expires_at<=? OR (ersomha_leases.room_key=excluded.room_key AND ersomha_leases.lease_token=excluded.lease_token)`,
  a.hash, roomKey, token, now + ERSOMHA_LEASE_MS, now, ...live.args, ...hashes, now, roomKey, token, now));
  await env.DB.batch(queries);
  await liveAccounts(env, accounts);
  const held = await rows(env, `SELECT account_hash,fence FROM ersomha_leases WHERE account_hash IN (${list}) AND room_key=? AND lease_token=? AND expires_at>?`, ...hashes, roomKey, token, now);
  if (held.length !== accounts.length) fail('ERSOMHA_ACTIVE_ELSEWHERE', 409);
  return { roomKey, token, accounts: accounts.map(a => ({ ...a, fence: held.find(h => h.account_hash === a.hash).fence })), expiresAt: now + ERSOMHA_LEASE_MS, renewAt: now + ERSOMHA_RENEW_MS };
}
export async function assertErsomhaLease(env, lease, now = Date.now()) {
  database(env); if (!lease?.accounts?.length) fail('ERSOMHA_ACTIVE_ELSEWHERE', 409);
  await liveAccounts(env, lease.accounts);
  const guard = leaseGuard(lease, now);
  if (!(await stmt(env, `SELECT 1 AS ok WHERE ${guard.sql}`, ...guard.args).first())?.ok) fail('ERSOMHA_ACTIVE_ELSEWHERE', 409);
}
export async function renewErsomhaLease(env, lease, now = Date.now()) {
  await assertErsomhaLease(env, lease, now);
  const guard = leaseGuard(lease, now);
  await stmt(env, `UPDATE ersomha_leases SET expires_at=?,updated_at=? WHERE room_key=? AND lease_token=? AND account_hash IN (${placeholders(lease.accounts)}) AND ${guard.sql}`,
    now + ERSOMHA_LEASE_MS, now, lease.roomKey, lease.token, ...lease.accounts.map(a => a.hash), ...guard.args).run();
  await assertErsomhaLease(env, lease, now);
  return { ...lease, expiresAt: now + ERSOMHA_LEASE_MS, renewAt: now + ERSOMHA_RENEW_MS };
}
export async function releaseErsomhaLease(env, lease, now = Date.now()) {
  if (!env.DB || !lease) return;
  await stmt(env, 'UPDATE ersomha_leases SET expires_at=0,updated_at=? WHERE room_key=? AND lease_token=?', now, lease.roomKey, lease.token).run();
}
export async function releaseErsomhaAccounts(env, lease, hashes, now = Date.now()) {
  if (!env.DB || !lease || !hashes.length) return;
  await stmt(env, `UPDATE ersomha_leases SET expires_at=0,updated_at=? WHERE room_key=? AND lease_token=? AND account_hash IN (${placeholders(hashes)})`,
    now, lease.roomKey, lease.token, ...hashes).run();
}
export async function ersomhaSeen(env, lease, { exposureId = null } = {}) {
  database(env); const hashes = lease.accounts.map(a => a.hash);
  return rows(env, `SELECT account_hash,family_id,concept_id,exposure_id,seen_at,seen_count FROM ersomha_seen WHERE account_hash IN (${placeholders(hashes)})${exposureId ? ' AND exposure_id=?' : ''}`,
    ...hashes, ...(exposureId ? [exposureId] : []));
}
export async function exposeErsomhaCards(env, lease, cards, accountIds, exposureId, { now = Date.now(), allowReplay = false, acceptedExposureIds = [] } = {}) {
  await assertErsomhaLease(env, lease, now);
  const targets = lease.accounts.filter(a => accountIds.includes(a.userId));
  if (!targets.length || !cards.length || !/^[A-Za-z0-9:_-]{1,220}$/.test(exposureId)) fail('INVALID');
  const guard = leaseGuard(lease, now);
  const allowed = [exposureId, ...acceptedExposureIds];
  const queries = targets.flatMap(a => cards.map(card => {
    const excluded = allowReplay ? '1' : `NOT EXISTS(SELECT 1 FROM ersomha_seen WHERE account_hash=? AND (family_id=? OR concept_id=?) AND exposure_id NOT IN (${placeholders(allowed)}))`;
    return stmt(env, `INSERT INTO ersomha_seen(account_hash,family_id,concept_id,exposure_id,seen_at)
      SELECT ?,?,?,?,? WHERE ${guard.sql} AND ${excluded}
      ON CONFLICT(account_hash,family_id) DO UPDATE SET concept_id=excluded.concept_id,exposure_id=excluded.exposure_id,seen_at=excluded.seen_at,
      seen_count=ersomha_seen.seen_count+CASE WHEN ersomha_seen.exposure_id=excluded.exposure_id THEN 0 ELSE 1 END
      WHERE ersomha_seen.exposure_id IN (${placeholders(allowed)})${allowReplay ? ' OR 1' : ''}`,
    a.hash, card.familyId, card.conceptId, exposureId, now, ...guard.args,
    ...(!allowReplay ? [a.hash, card.familyId, card.conceptId, ...allowed] : []), ...allowed);
  }));
  await env.DB.batch(queries);
  await assertErsomhaLease(env, lease, now);
  const verified = await rows(env, `SELECT account_hash,family_id,concept_id FROM ersomha_seen WHERE account_hash IN (${placeholders(targets)}) AND exposure_id=?`, ...targets.map(a => a.hash), exposureId);
  if (!targets.every(a => cards.every(card => verified.some(r => r.account_hash === a.hash && r.family_id === card.familyId && r.concept_id === card.conceptId)))) fail('ERSOMHA_HISTORY_CONFLICT', 409);
}
// The account deleter appends these statements to its existing D1 batch. Hashes
// are deliberately derived here, rather than returning or logging private IDs.
export async function ersomhaDeleteStatements(env, userId) {
  const hash = await ersomhaAccountHash(userId);
  return [stmt(env, 'DELETE FROM ersomha_seen WHERE account_hash=?', hash), stmt(env, 'DELETE FROM ersomha_leases WHERE account_hash=?', hash)];
}
export async function cleanupErsomha(env, now = Date.now()) {
  if (env.DB) await stmt(env, 'DELETE FROM ersomha_leases WHERE expires_at<?', now - 86_400_000).run();
}

// Allocate a complete private match before charging its trial. A small max-flow
// gives every family one use and every category at most one slot per turn, even
// near exhaustion where random greedy selection can produce a false failure.
export function buildErsomhaTurnPlan(pool, turns, { seen = [], allowReplay = false } = {}) {
  if (!Number.isInteger(turns) || turns < 2 || turns > 16) return [];
  const seenFamilies = new Set(seen.map(s => s.family_id)), seenConcepts = new Set(seen.map(s => s.concept_id));
  const fresh = pool.filter(c => !seenFamilies.has(c.familyId) && !seenConcepts.has(c.conceptId));
  const strict = allocate(fresh, turns, []);
  if (strict.length === turns || !allowReplay) return strict;
  return allocate(pool, turns, seen);
}
function allocate(pool, turns, seen) {
  const ranked = pool.map(card => {
    const history = seen.filter(s => s.family_id === card.familyId || s.concept_id === card.conceptId);
    return { card, count: Math.max(0, ...history.map(s => s.seen_count || 1)), at: Math.max(0, ...history.map(s => s.seen_at || 0)),
      random: crypto.getRandomValues(new Uint32Array(1))[0] };
  }).sort((a, b) => a.count - b.count || a.at - b.at || a.random - b.random);
  const families = new Map();
  for (const { card } of ranked) {
    if (!families.has(card.familyId)) families.set(card.familyId, new Map());
    if (!families.get(card.familyId).has(card.category)) families.get(card.familyId).set(card.category, card);
  }
  const categories = [...new Set(pool.map(c => c.category))];
  if (families.size < turns * 3 || categories.length < 3) return [];
  const source = 0, familyStart = 1, categoryStart = familyStart + families.size, sink = categoryStart + categories.length;
  const graph = Array.from({ length: sink + 1 }, () => []);
  const edge = (from, to, capacity, card) => {
    const forward = { to, capacity, reverse: graph[to].length, card }, back = { to: from, capacity: 0, reverse: graph[from].length };
    graph[from].push(forward); graph[to].push(back);
  };
  let familyIndex = 0;
  for (const cards of families.values()) {
    const node = familyStart + familyIndex++; edge(source, node, 1);
    for (const [category, card] of cards) edge(node, categoryStart + categories.indexOf(category), 1, card);
  }
  categories.forEach((_, index) => edge(categoryStart + index, sink, turns));
  for (let sent = 0; sent < turns * 3; sent++) {
    const path = Array(graph.length).fill(null), queue = [source]; path[source] = [-1, -1];
    for (let n = 0; n < queue.length && !path[sink]; n++) {
      const from = queue[n];
      for (let index = 0; index < graph[from].length; index++) {
        const candidate = graph[from][index];
        if (candidate.capacity > 0 && !path[candidate.to]) { path[candidate.to] = [from, index]; queue.push(candidate.to); }
      }
    }
    if (!path[sink]) return [];
    for (let at = sink; at !== source;) {
      const [from, index] = path[at], candidate = graph[from][index]; candidate.capacity--; graph[at][candidate.reverse].capacity++; at = from;
    }
  }
  const grouped = new Map(categories.map(category => [category, []]));
  for (let node = familyStart; node < categoryStart; node++) for (const candidate of graph[node]) {
    if (candidate.card && candidate.capacity === 0) grouped.get(candidate.card.category).push(candidate.card);
  }
  const plan = Array.from({ length: turns }, () => []);
  for (const cards of [...grouped.values()].sort((a, b) => b.length - a.length)) {
    const slots = plan.map((cards, index) => ({ index, length: cards.length })).sort((a, b) => a.length - b.length || a.index - b.index);
    cards.forEach((card, index) => plan[slots[index].index].push(structuredClone(card)));
  }
  return plan.every(cards => cards.length === 3) ? plan : [];
}
