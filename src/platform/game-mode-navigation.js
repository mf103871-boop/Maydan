import { getGameModeSupport } from '../shared/game-mode-support.mjs';

// The URL carries this nonprivate navigation choice through Back and reload.
// No game session, roster, round settings or tutorial completion is modified.
export function resolveGameMode(id, requested) {
  const support = getGameModeSupport(id);
  if (!support) return null;
  if (requested === 'online' || requested === 'local') return support[requested] ? requested : null;
  return support.local ? 'local' : 'online';
}

export function gameModePath(id, mode) {
  if (!getGameModeSupport(id)?.[mode] || !['local', 'online'].includes(mode)) return null;
  return mode === 'online' ? `/online/${id}?mode=online` : `/game/${id}?mode=local`;
}

export function gameInstructionsNextPath(id, requested) {
  const mode = resolveGameMode(id, requested);
  if (!mode) return null;
  return mode === 'online' ? `/online/${id}?mode=online` : `/play/${id}?mode=local`;
}
