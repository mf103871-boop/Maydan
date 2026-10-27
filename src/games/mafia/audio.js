// Noir cues reuse the approved CC0 recordings in Maydan's shared sample bank.
// No faction, role, target, result or private report influences an audible cue.
export const MAFIA_CUES = Object.freeze({
  mafiaSelect: Object.freeze({ sample: 'click', gain: 0.5, rate: 0.82, offsets: [0] }),
  mafiaRole: Object.freeze({ sample: 'click', gain: 0.6, rate: 0.7, offsets: [0] }),
  mafiaNight: Object.freeze({ sample: 'tick', gain: 0.42, rate: 0.7, offsets: [0, 0.38, 0.76] }),
  mafiaDawn: Object.freeze({ sample: 'correct', gain: 0.36, rate: 0.88, offsets: [0] }),
  mafiaVerdict: Object.freeze({ sample: 'wrong', gain: 0.5, rate: 0.82, offsets: [0] }),
  mafiaFinal: Object.freeze({ sample: 'correct', gain: 0.35, rate: 0.72, offsets: [0] }),
});

export const MAFIA_PHASE_CUES = Object.freeze({
  night: 'mafiaNight', dawn: 'mafiaDawn', nomination: 'mafiaSelect',
  verdict: 'mafiaVerdict', over: 'mafiaFinal',
});

export function renderMafiaCue(context, name, meta = {}) {
  const cue = MAFIA_CUES[name];
  if (!cue) return null;
  let first = null;
  for (const at of cue.offsets) {
    const voice = context.sample(cue.sample, { ...meta, at, gain: (meta.gain ?? 1) * cue.gain, rate: cue.rate });
    first ||= voice;
  }
  return first;
}

// A new observer/reconnected screen consumes its initial snapshot silently.
// Subsequent phase transitions are identified by server phase IDs, not renders,
// deadlines, chat messages, the local timer, role or team changes.
export function createMafiaPhaseAudio(sound) {
  let currentKey = null;
  let initialized = false;
  let generation = 0;
  let disposed = false;
  let suspended = false;
  const stop = () => sound?.stopCues?.(Object.keys(MAFIA_CUES));
  return {
    update(state, { hidden = false, preview = false } = {}) {
      if (disposed) return;
      const key = state?.matchId && state?.phaseId ? `${state.matchId}:${state.phaseId}` : null;
      const unavailable = hidden || preview || !!state?.waiting || !key;
      if (unavailable && !suspended) { generation += 1; stop(); }
      suspended = unavailable;
      if (initialized && key === currentKey) return;
      const first = !initialized;
      initialized = true;
      currentKey = key;
      generation += 1;
      stop();
      const cue = MAFIA_PHASE_CUES[state?.phase];
      if (first || unavailable || !cue) return;
      const requestGeneration = generation;
      sound?.play?.(cue, { source: 'mafia-phase', guard: () => !disposed && !suspended && generation === requestGeneration });
    },
    suspend() { if (disposed) return; suspended = true; generation += 1; stop(); },
    dispose() { if (disposed) return; disposed = true; generation += 1; stop(); },
  };
}
