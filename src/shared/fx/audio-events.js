// Audio is a projection of already-authorized game state, never a new data channel.
export const AUDIO_EVENTS = Object.freeze({
  'ui.click': { cue: 'click', priority: 1, ttl: 250, cooldown: 70 },
  'ui.confirm': { cue: 'pop', priority: 2, ttl: 1000, cooldown: 120 },
  'ui.error': { cue: 'buzzer', priority: 2, ttl: 1000, cooldown: 1000 },
  'ui.transition': { cue: 'whoosh', priority: 1, ttl: 250, cooldown: 100 },
  'game.correct': { cue: 'correct', priority: 3, ttl: 1000, cooldown: 180 },
  'game.wrong': { cue: 'wrong', priority: 3, ttl: 1000, cooldown: 180 },
  'game.pass': { cue: 'pass', priority: 3, ttl: 1000, cooldown: 100 },
  'game.reveal': { cue: 'reveal', priority: 4, ttl: 1000, cooldown: 300 },
  'game.timeout': { cue: 'timeout', priority: 4, ttl: 400, cooldown: 400 },
  'game.complete': { cue: 'fanfare', priority: 5, ttl: 1000, cooldown: 1000 },
  'game.cancel': { cue: null, priority: 5, ttl: 0, cooldown: 0 },
  'social.message': { cue: 'pop', priority: 1, ttl: 1000, cooldown: 1500 },
  'social.invite': { cue: 'pop', priority: 1, ttl: 1000, cooldown: 1500 },
  // No generic death -> gunshot mapping. This cue stays silent until a reviewed
  // licensed asset is explicitly supplied by the asset registry.
  'mafia.assassination.public': { cue: 'mafiaAssassination', priority: 5, ttl: 1000, cooldown: 1500, publicOnly: true },
  'mafia.judgment.public': { cue: 'mafiaJudgment', priority: 5, ttl: 1000, cooldown: 1500, publicOnly: true },
});

export function createAudioEvents(play, { now = Date.now, available = () => true } = {}) {
  let scope = '', generation = 0, suspended = false;
  const seen = new Map(), last = new Map();
  function reset(next = '') { scope = String(next); generation++; seen.clear(); last.clear(); }
  return {
    reset,
    suspend(value = true) { suspended = !!value; generation++; },
    emit(type, { id, scope: requestedScope = scope, at = now(), initial = false, muted = false, publicEvent = false, guard } = {}) {
      const definition = AUDIO_EVENTS[type];
      if (!definition || requestedScope !== scope || !Number.isFinite(at)) return false;
      const clock = now();
      const key = id === undefined || id === null ? null : JSON.stringify([scope, type, String(id)]);
      if (key && seen.has(key)) return false;
      // Consume known events even when muted/hidden/initial. They must not replay.
      if (key) seen.set(key, clock);
      while (seen.size > 512) seen.delete(seen.keys().next().value);
      if (initial || muted || suspended || !available() || clock - at > definition.ttl || at > clock + 1000 || !definition.cue) return false;
      if (definition.publicOnly && !publicEvent) return false;
      if (clock - (last.get(type) ?? -Infinity) < definition.cooldown) return false;
      const token = generation;
      const valid = () => {
        // The sample bank or browser unlock may finish after this event's own
        // deadline. Its age starts at the event timestamp, not at prepare().
        const current = now();
        return Number.isFinite(current) && current - at <= definition.ttl && at <= current + 1000 &&
          token === generation && !suspended && available() && (typeof guard !== 'function' || guard());
      };
      if (!valid()) return false;
      const result = play(definition.cue, { source: 'semantic-event', guard: valid, priority: definition.priority });
      if (result !== false) last.set(type, clock);
      return result !== false;
    },
  };
}
