// Optional, manually invoked preview backfill. No route, cron or profile read
// imports history. The same permanent receipt owns live and legacy accounting.
import { MAFIA_ROLES } from '../src/online/mafia-shared.js';
import { fail } from '../src/shared/room-primitives.mjs';
import { liveAccountSql } from './moderation/access.mjs';
import { mafiaProgressEnabled, mafiaProgressStatements } from './mafia-progression.mjs';

export const MAFIA_LEGACY_IMPORT_SCOPE = 'mafia-preview-legacy-progress';
export const MAFIA_LEGACY_IMPORT_MAX_ROWS = 100;
const DAY = 86_400_000;
const roleCatalog = JSON.stringify(Object.values(MAFIA_ROLES).map(({ id, faction }) => ({ id, faction })));
const timeOf = value => typeof value === 'string' ? Date.parse(value) : NaN;

// This validates SUPPLIED evidence, never authenticates an activation or reads
// live configuration. The manual CLI separately pins the exact preview resource.
// Refusing an absent/unconfirmed boundary is safer than guessing from timestamps
// of arbitrary player_events, current settings or an operator's invocation time.
export function assertLegacyMafiaProgressCutover(contract, now = Date.now()) {
  const cutoff = timeOf(contract?.legacyCutoffAt), enabled = timeOf(contract?.progressionEnabledAt), captured = timeOf(contract?.capturedAt);
  if (contract?.schemaVersion !== 1 || contract.scope !== MAFIA_LEGACY_IMPORT_SCOPE || contract.activationConfirmed !== true
    || contract.progressionPolicyVersion !== 1 || typeof contract.worker !== 'string' || typeof contract.databaseId !== 'string'
    || !Number.isSafeInteger(now) || !Number.isFinite(cutoff) || !Number.isFinite(enabled) || !Number.isFinite(captured)
    || cutoff <= 0 || cutoff > enabled || enabled > captured || captured > now || now - captured > 30 * 60_000) {
    fail('MAFIA_LEGACY_CUTOVER_REQUIRED', 409);
  }
  // A delayed cleanup or a very late outbox must not turn logically expired
  // source rows into an unlimited historical backfill.
  return { cutoff, earliest: now - 30 * DAY };
}

const historicalArchive = `CASE WHEN h.summary IS NULL THEN 1 WHEN json_valid(h.summary) THEN
  CASE WHEN json_type(h.summary,'$.rewardPolicyVersion') IS NULL OR json_type(h.summary,'$.rewardPolicyVersion')='null' THEN 1
    WHEN json_type(h.summary,'$.rewardPolicyVersion')='integer' AND json_extract(h.summary,'$.rewardPolicyVersion')=0 THEN 1 ELSE 0 END
  ELSE 0 END=1`;
const source = `FROM mafia_results r LEFT JOIN mafia_history h ON h.match_key=r.match_key`;
const window = `r.finished_at>=? AND r.finished_at<? AND r.finished_at<=?`;
const eligible = `${window}
  AND r.user_id IN (SELECT id FROM users) AND length(r.user_id) BETWEEN 1 AND 80 AND r.user_id NOT GLOB '*[^A-Za-z0-9_-]*'
  AND length(r.match_key) BETWEEN 1 AND 180 AND r.match_key NOT GLOB '*[^A-Za-z0-9:_-]*'
  AND EXISTS(SELECT 1 FROM json_each(?) role WHERE json_extract(role.value,'$.id')=r.role_id AND json_extract(role.value,'$.faction')=r.initial_faction)
  AND r.faction IN ('town','mafia','shadow') AND r.won IN (0,1) AND r.draw IN (0,1) AND r.forfeited IN (0,1)
  AND NOT(r.won=1 AND r.draw=1) AND ${historicalArchive} AND ${liveAccountSql('r.user_id')}`;
const unclaimed = `NOT EXISTS(SELECT 1 FROM mafia_progress_events e WHERE e.user_id=r.user_id AND e.match_key=r.match_key AND e.event_kind='match_completed')`;
const query = (env, sql, args) => env.DB.prepare(sql).bind(...args);
const hash = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(b => b.toString(16).padStart(2, '0')).join('');

export async function importLegacyMafiaProgress(env, contract, { apply = false, limit = 50, now = Date.now() } = {}) {
  const { cutoff, earliest } = assertLegacyMafiaProgressCutover(contract, now);
  if (typeof apply !== 'boolean' || !Number.isSafeInteger(limit) || limit < 1 || limit > MAFIA_LEGACY_IMPORT_MAX_ROWS) fail('INVALID', 400);
  if (!mafiaProgressEnabled(env)) fail('MAFIA_PROGRESS_DISABLED', 503);
  if (!env.DB) fail('MAFIA_PROGRESS_UNAVAILABLE', 503);
  const args = [earliest, cutoff, now - 30_000, roleCatalog];
  const stats = await query(env, `SELECT COUNT(*) AS candidates,SUM(NOT(${unclaimed})) AS already_receipted ${source} WHERE ${eligible}`, args).first();
  const { results: rows = [] } = await query(env, `SELECT r.user_id,r.match_key,r.role_id,r.initial_faction,r.faction,r.won,r.draw,r.forfeited,r.finished_at
    ${source} WHERE ${eligible} AND ${unclaimed} ORDER BY r.finished_at,r.user_id,r.match_key LIMIT ?`, [...args, limit + 1]).all();
  const selected = rows.slice(0, limit), statements = [], tokens = [];
  // Building statements in dry-run validates the exact consumer contract, too.
  // No event payloads or participant identifiers are returned in the report.
  for (const row of selected) {
    const event = { eventSchemaVersion: 1, eventKind: 'match_completed', source: 'legacy', rewardPolicyVersion: null,
      key: row.match_key, eventId: `legacy:${await hash(row.match_key)}`, rulesetVersion: 1,
      startedAt: null, finishedAt: row.finished_at, notBefore: row.finished_at + 30_000,
      visibility: null, mode: null, capacity: null, participantCount: null, draw: row.draw === 1,
      results: [{ userId: row.user_id, roleId: row.role_id, initialFaction: row.initial_faction, faction: row.faction,
        won: row.won === 1, forfeited: row.forfeited === 1, eliminatedAt: null }] };
    const token = `legacy:${crypto.randomUUID()}`;
    statements.push(...await mafiaProgressStatements(env, event, { claimToken: token, legacy: true, now }));
    tokens.push(token);
  }
  let imported = 0;
  if (apply && statements.length) {
    // Receipt, XP0 legacy counters and terminal receipt state are one transaction.
    // Live/deletion races are checked again in the consumer's SQL, not just here.
    await env.DB.batch(statements);
    const count = await query(env, `SELECT COUNT(*) AS n FROM mafia_progress_events WHERE source='legacy' AND status='processed'
      AND claim_token IN (${tokens.map(() => '?').join(',')})`, tokens).first();
    imported = Number(count?.n) || 0;
  }
  return { schemaVersion: 1, scope: MAFIA_LEGACY_IMPORT_SCOPE, dryRun: !apply,
    legacyCutoffAt: new Date(cutoff).toISOString(), earliestIncludedAt: new Date(earliest).toISOString(),
    candidates: Number(stats?.candidates) || 0, alreadyReceipted: Number(stats?.already_receipted) || 0,
    selected: selected.length, imported, hasMore: rows.length > limit,
    xpAwarded: 0, masteryAwarded: 0, activationEvidence: 'supplied-unverified' };
}
