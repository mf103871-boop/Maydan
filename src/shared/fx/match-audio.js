// Completion belongs to the match controller, not each results component.
// IDs include room/mount identity: matchId starts over in every new room.
let localSequence = 0;

export function createLocalMatchAudio(sound, game, lifetime = '') {
  const newId = () => JSON.stringify(['local', game, lifetime, ++localSequence, 'complete']);
  let id = newId();
  let settled = false, disposed = false, generation = 0;
  return {
    activate() { disposed = false; },
    begin() { if (disposed) return; id = newId(); settled = false; generation++; },
    complete(completed) {
      if (disposed || settled) return false;
      settled = true;
      if (!completed) return false;
      const token = generation;
      sound.emit('game.complete', { id, guard: () => !disposed && token === generation });
      return true;
    },
    dispose() { disposed = true; generation++; },
  };
}

export function createOnlineMatchAudio(sound, room) {
  let previous = null, generation = 0, disposed = false;
  return {
    update(state, { connected = true, hidden = false } = {}) {
      if (disposed) return null;
      if (!state || !connected) { previous = null; generation++; return null; }
      const key = JSON.stringify([room, state.game, state.matchId, state.round, state.phase]);
      if (previous === key) return null;
      const initial = previous === null;
      previous = key;
      const token = ++generation;
      if (state.game === 'mafia') return null; // Its public phase controller owns its cues.
      const type = state.phase === 'over' && !state.reason ? 'game.complete'
        : state.phase === 'result' && !state.reason ? 'ui.confirm' : null;
      if (!type) return null;
      const muted = hidden || Boolean(state._designPreview);
      sound.emit(type, { id: key, initial, muted, guard: () => !disposed && token === generation });
      return initial || muted ? null : type;
    },
    dispose() { disposed = true; generation++; },
  };
}
