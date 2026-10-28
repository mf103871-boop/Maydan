const FIELDS = Object.freeze({
  badeeha: ['mode', 'roundSize', 'timer', 'categories'],
  beep: ['mode', 'seconds', 'rounds'],
  mamnoo: ['seconds', 'rounds'],
  jabeen: ['seconds', 'categoryId', 'control'],
  meenfina: ['mode', 'rounds'],
  fabraka: ['rounds', 'mode', 'style', 'categories', 'writeSeconds', 'discussionSeconds', 'funnyVote', 'finalDouble', 'friendCycles'],
  ersomha: ['cycles', 'drawSeconds', 'difficulty', 'categories'],
  mafia: ['mode', 'capacity', 'visibility'],
});
export function presetSettings(game, settings = {}) {
  if (game === 'badeeha' && !Object.hasOwn(settings, 'timer') && Object.hasOwn(settings, 'timerLength')) settings = { ...settings, timer: settings.timerLength };
  return Object.fromEntries((FIELDS[game] || []).filter(key => Object.hasOwn(settings, key)).map(key => [key, Array.isArray(settings[key]) ? [...settings[key]] : settings[key]]));
}
