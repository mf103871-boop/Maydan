import { json, readJson } from '../protocol.mjs';
import { fail } from '../room-model.mjs';
import { requireSession, withRotation } from '../accounts/session.mjs';
import { liveAccountSql } from '../moderation/access.mjs';
import {
  MAFIA_TUTORIAL_ID,
  MAFIA_TUTORIAL_SCENARIO_VERSION,
  MAFIA_TUTORIAL_RULESET_VERSION,
} from '../../src/games/mafia/tutorial/version.mjs';

const PATH = '/api/me/tutorials/mafia';
const fields = ['scenarioVersion', 'rulesetVersion', 'status'];

function validate(body) {
  if (Object.keys(body).length !== fields.length || Object.keys(body).some(key => !fields.includes(key))
    || !Number.isSafeInteger(body.scenarioVersion) || !Number.isSafeInteger(body.rulesetVersion)
    || !['skipped', 'completed'].includes(body.status)) fail('INVALID', 400);
  if (body.scenarioVersion !== MAFIA_TUTORIAL_SCENARIO_VERSION
    || body.rulesetVersion !== MAFIA_TUTORIAL_RULESET_VERSION) fail('UPDATE_REQUIRED', 409);
}

async function current(env, userId) {
  // Recheck account eligibility inside the query: deletion/suspension may have
  // started after session authentication. Never read another account's status.
  const row = await env.DB.prepare(`SELECT account_user.id AS user_id, p.scenario_version,
    p.ruleset_version, p.status, p.updated_at FROM users account_user
    LEFT JOIN mafia_tutorial_status p ON p.user_id=account_user.id
    WHERE account_user.id=? AND ${liveAccountSql('account_user.id')}`).bind(userId).first();
  if (!row) fail('ACCOUNT_UNAVAILABLE', 409);
  const outdated = row.status != null && (row.scenario_version !== MAFIA_TUTORIAL_SCENARIO_VERSION
    || row.ruleset_version !== MAFIA_TUTORIAL_RULESET_VERSION);
  return {
    tutorialId: MAFIA_TUTORIAL_ID,
    scenarioVersion: MAFIA_TUTORIAL_SCENARIO_VERSION,
    rulesetVersion: MAFIA_TUTORIAL_RULESET_VERSION,
    status: outdated ? 'unseen' : row.status || 'unseen',
    updatedAt: outdated ? null : row.updated_at ?? null,
    outdated,
  };
}

export async function routeTutorials(request, env, url = new URL(request.url), charge) {
  if (url.pathname !== PATH) return null;
  if (!['GET', 'PUT'].includes(request.method)) return json({ error: 'METHOD' }, 405, { allow: 'GET, PUT' });
  if (!env.DB) fail('NOT_FOUND', 404);
  const write = request.method === 'PUT';
  if (charge) await charge(write ? 'socialWriteIP' : 'socialReadIP');
  const auth = await requireSession(env, request);
  if (charge) await charge(write ? 'profileWrite' : 'profileRead', 'RATE_LIMIT', auth.user.id);
  if (write) {
    const body = await readJson(request, 512);
    validate(body);
    // Atomic, idempotent and monotonic within a version. A late skip from another
    // device cannot undo completion. A rolled-back server cannot replace a newer
    // version's status. No client timestamp, owner or game state enters this SQL.
    await env.DB.prepare(`INSERT INTO mafia_tutorial_status
      (user_id,scenario_version,ruleset_version,status,updated_at)
      SELECT ?,?,?,?,? WHERE ${liveAccountSql('?')}
      ON CONFLICT(user_id) DO UPDATE SET
        scenario_version=excluded.scenario_version,
        ruleset_version=excluded.ruleset_version,
        status=excluded.status,
        updated_at=MAX(mafia_tutorial_status.updated_at,excluded.updated_at)
      WHERE excluded.scenario_version>=mafia_tutorial_status.scenario_version
        AND excluded.ruleset_version>=mafia_tutorial_status.ruleset_version
        AND (excluded.scenario_version!=mafia_tutorial_status.scenario_version
          OR excluded.ruleset_version!=mafia_tutorial_status.ruleset_version
          OR (mafia_tutorial_status.status='skipped' AND excluded.status='completed'))`)
      .bind(auth.user.id, body.scenarioVersion, body.rulesetVersion, body.status, Date.now(), auth.user.id, auth.user.id).run();
  }
  const status = await current(env, auth.user.id);
  if (write && status.outdated) fail('UPDATE_REQUIRED', 409);
  return withRotation(json(status), auth.rotated);
}
