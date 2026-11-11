import { getGameModeSupport } from '../shared/game-mode-support.mjs';
import { createStorage } from '../shared/lib/storage.js';
import { environmentStorageKey } from '../shared/lib/environment.js';
import { entryPolicyEnabled, gameplayOffer, TICKET_POLICY } from '../shared/account/gameplay-policy.mjs';

export const gameEntryPath = game => getGameModeSupport(game) ? `/entry/${game}` : null;
export function gameEntryPolicyState(account, entered = false) {
  const expected = entered || entryPolicyEnabled(account.gameplayPolicy) ||
    entryPolicyEnabled(account.me?.gameplay?.policy) ||
    (typeof __MAYDAN_GAMEPLAY_POLICY__ !== 'undefined' && entryPolicyEnabled(__MAYDAN_GAMEPLAY_POLICY__));
  if (expected && !account.ready) return 'pending';
  if (entryPolicyEnabled(account.gameplayPolicy)) return 'entry';
  if (account.gameplayPolicy === TICKET_POLICY) return 'legacy';
  if (account.billing?.gameplay?.access === 'free' && !account.billing.gameplay.policy) return 'free';
  return expected ? 'pending' : 'free';
}
export function needsGameEntry(account, game) {
  if (!gameEntryPath(game)) return false;
  const policy = gameEntryPolicyState(account);
  return policy === 'pending' || policy === 'entry' && !account.premium &&
    (account.signedIn || account.gameAccess?.(game) !== 'trial');
}

// Recovery is a navigation hint, never an entitlement. Play validates the
// saved board and reuses its existing journal/claim before allowing any start.
// In particular an old completed match cannot be treated as a fresh ticket.
export function localEntryRecovery(account, game, backend) {
  const owner = account.signedIn ? account.user?.id : null;
  const offer = gameplayOffer(game, 'local');
  if (!owner || !offer) return null;
  const storage = createStorage(environmentStorageKey(`maydan:gameplay:${game}:`), backend);
  const valid = value => value?.version === 1 && value.owner === owner && value.offer === offer.id &&
    typeof value.matchId === 'string' && /^[a-zA-Z0-9_-]{8,100}$/.test(value.matchId);
  const path = `/play/${game}?mode=local`;
  const pending = storage.get(`pending:${owner}`);
  if (valid(pending) && !storage.get(`match:${pending.matchId}`)?.completed) return { kind: 'pending', path };
  const key = game === 'badeeha' ? 'active-game-v2' : game === 'fabraka' ? 'session-v2' : 'session-v1';
  const board = createStorage(game, backend).get(key);
  const marker = board?.profileSession?.gameplayAccess;
  // Existing pre-policy boards and a free-pack match stay resumable. This
  // only exposes Play's resume path, whose own validator owns compatibility.
  if ((board?.profileSession?.ownerUserId === owner && !marker) || (marker?.version === 1 &&
    marker.owner === owner && marker.offer === offer.id && ['legacy', 'free-packs'].includes(marker.source))) {
    return { kind: 'active', path };
  }
  if (!valid(marker)) return null;
  const recorded = storage.get(`match:${marker.matchId}`);
  return valid(recorded) && recorded.completed !== true && recorded.source === marker.source &&
    ['trial', 'ticket', 'plus'].includes(recorded.source) ? { kind: 'active', path } : null;
}
