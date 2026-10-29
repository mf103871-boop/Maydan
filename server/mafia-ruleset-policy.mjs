import { fail } from './room-model.mjs';

// This registry is deliberately explicit. Bumping the shared constant alone must
// never make this server interpret a saved match using a different ruleset.
export const MAFIA_SUPPORTED_RULESET_VERSIONS = Object.freeze([1]);
const LEGACY_RULESET_VERSION = 1;
export const MAFIA_DRAIN_EVIDENCE_MAX_AGE_MS = 60_000;

// Existing environments keep their current behavior. Once configured, only an
// explicit 1 accepts new matches; a mistyped maintenance value fails closed.
export const mafiaAcceptsNewMatches = env => env.MAFIA_ACCEPT_NEW_MATCHES == null || String(env.MAFIA_ACCEPT_NEW_MATCHES) === '1';
export function requireMafiaNewMatches(env) {
  if (!mafiaAcceptsNewMatches(env)) fail('MAFIA_DRAINING', 503);
}

export function assertSupportedMafiaRuleset(room) {
  if (room?.game !== 'mafia') return;
  // Rooms saved before versioning belong to v1. Do not rewrite their state or
  // coerce malformed/string/future versions into the rules currently running.
  const version = room.rulesetVersion === undefined ? LEGACY_RULESET_VERSION : room.rulesetVersion;
  if (!MAFIA_SUPPORTED_RULESET_VERSIONS.includes(version)) fail('MAFIA_RULESET_UNSUPPORTED', 503);
  return version;
}

// Offline policy only: the caller must independently obtain complete, fresh
// room evidence after admission has stopped on every serving worker. A public
// room directory or an expired lease count cannot establish this evidence.
// This function has no network/config/deploy side effects and does not claim a
// fixture is proof that any running environment was drained.
export function assertMafiaRulesetUpgrade({ fromVersion, toVersion, drain } = {}, now = Date.now()) {
  const validVersion = value => Number.isSafeInteger(value) && value > 0;
  if (!validVersion(fromVersion) || !validVersion(toVersion)) fail('MAFIA_RULESET_DRAIN_REQUIRED', 409);
  const rulesetChanged = fromVersion !== toVersion;
  if (rulesetChanged) {
    const capturedAt = typeof drain?.capturedAt === 'string' ? Date.parse(drain.capturedAt) : NaN;
    if (drain?.scope !== 'all-mafia-rooms' || drain.acceptingNewMatches !== false
      || drain.activeMatches !== 0 || drain.pendingStarts !== 0
      || !Number.isFinite(now) || !Number.isFinite(capturedAt) || capturedAt > now
      || now - capturedAt > MAFIA_DRAIN_EVIDENCE_MAX_AGE_MS) fail('MAFIA_RULESET_DRAIN_REQUIRED', 409);
  }
  return { passed: true, rulesetChanged, fromVersion, toVersion, productionChanged: false };
}
