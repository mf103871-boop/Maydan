// Navigation/display capabilities only. Authoritative game rules still validate
// room settings and admission (for example Shadow Mafia needs more players).
const mode = (online, local, unit = 'players', onlineMin = null, onlineMax = null) =>
  Object.freeze({ online, local, unit, onlineMin, onlineMax });

export const GAME_MODE_SUPPORT = Object.freeze({
  badeeha: mode(true, true, 'teams', 2, 4),
  mafia: mode(true, false, 'players', 6, 12),
  // Its current Component is the online client, not a device-sharing engine.
  ersomha: mode(true, false, 'players', 2, 8),
  beep: mode(false, true),
  mamnoo: mode(false, true),
  jabeen: mode(false, true),
  fabraka: mode(true, true, 'players', 2, 8),
  meenfina: mode(true, true, 'players', 3, 12),
});

export function getGameModeSupport(id) {
  return Object.hasOwn(GAME_MODE_SUPPORT, id) ? GAME_MODE_SUPPORT[id] : null;
}
