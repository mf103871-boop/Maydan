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
  over: 'mafiaFinal',
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
  let viewerScope = null;
  const stop = () => sound?.stopCues?.(Object.keys(MAFIA_CUES));
  return {
    update(state, { hidden = false, preview = false, ownerId = '' } = {}) {
      if (disposed) return;
      const nextScope = JSON.stringify([ownerId,state?.code||'']);
      if(nextScope!==viewerScope){viewerScope=nextScope;initialized=false;currentKey=null;generation++;stop();}
      const key = state?.matchId && state?.phaseId ? `${state.matchId}:${state.phaseId}` : null;
      const unavailable = hidden || preview || !!state?.waiting || !key;
      const resuming = suspended;
      if (unavailable && !suspended) { generation += 1; stop(); }
      suspended = unavailable;
      if (initialized && key === currentKey) return;
      const first = !initialized || resuming;
      initialized = true;
      currentKey = key;
      generation += 1;
      stop();
      const cue = MAFIA_PHASE_CUES[state?.phase];
      if (first || unavailable || !cue) return;
      // A server cancellation is not a completed match. Keep older compatible
      // projections without a reason working, but never celebrate an abort.
      if (state?.phase === 'over' && state.reason && !['faction', 'day_limit', 'time_limit'].includes(state.reason)) return;
      const requestGeneration = generation;
      sound?.play?.(cue, { source: 'mafia-phase', guard: () => !disposed && !suspended && generation === requestGeneration });
    },
    suspend() { if (disposed) return; suspended = true; generation += 1; stop(); },
    dispose() { if (disposed) return; disposed = true; generation += 1; stop(); },
  };
}

// Only public events from the authorized projection can request these cues.
// The server's public sequence is monotonic; stale/reordered history cannot
// replay after a reconnect, and private reports are never inspected.
export function createMafiaPublicAudio(sound, { now = Date.now } = {}) {
  let match = null, phaseId = null, latest = 0, initialized = false, generation = 0, disposed = false, viewerScope = null;
  return {
    update(state, { hidden = false, preview = false, ownerId = '' } = {}) {
      if (disposed) return;
      const nextScope=JSON.stringify([ownerId,state?.code||'']);
      if(nextScope!==viewerScope){viewerScope=nextScope;initialized=false;latest=0;generation++;}
      const matchKey = state?.matchId ? `${state.code || ''}:${state.matchId}` : null;
      if (match !== matchKey) { match = matchKey; initialized = false; latest = 0; generation++; }
      if (phaseId !== state?.phaseId || hidden || preview) { phaseId = state?.phaseId; generation++; }
      const first = !initialized; initialized = true;
      const epoch = generation;
      const localNow = now();
      for (const event of state?.log || []) {
        if (!Number.isSafeInteger(event.id) || event.id <= latest) continue;
        latest = event.id;
        if (first || !matchKey || hidden || preview || state?.waiting) continue;
        const type = event.type === 'eliminated' && event.reason === 'night' ? 'mafia.assassination.public'
          : event.type === 'verdict_closed' ? 'mafia.judgment.public' : null;
        // Project server age onto the phone clock. A skewed phone must neither
        // drop a fresh event nor make historical events sound freshly received.
        // Without an event timestamp freshness is unknown, so consume silently.
        if (!type || !Number.isFinite(event.at)) continue;
        const at = Number.isFinite(state.serverNow) ? localNow - (state.serverNow - event.at) : event.at;
        sound?.emit?.(type, { id: `${matchKey}:${event.id}`, publicEvent: true, at,
          guard: () => !disposed && epoch === generation });
      }
    },
    suspend() { generation++; initialized = false; },
    dispose() { disposed = true; generation++; },
  };
}

// The supplied value comes from the same server-aligned clock shown by the UI.
// Sparse updates play one quiet tick, never a backlog of missed seconds.
export function createMafiaCountdownAudio(sound) {
  let key=null,last=null,initialized=false,generation=0,suspended=false,disposed=false;
  return {
    update(state,{remaining=null,hidden=false,preview=false,ownerId=''}={}) {
      if(disposed)return;
      const next=state?.matchId&&state?.phaseId?JSON.stringify([ownerId,state.code||'',state.matchId,state.phaseId]):null;
      if(next!==key){key=next;last=null;initialized=false;generation++;}
      const unavailable=hidden||preview||state?.waiting||!next;
      const baseline=!initialized||unavailable||suspended;
      if(unavailable||suspended)generation++;
      initialized=true;suspended=Boolean(unavailable);
      if(remaining===last)return;
      last=remaining;generation++;
      if(baseline||!Number.isInteger(remaining)||remaining<1||remaining>5)return;
      const epoch=generation;
      sound?.play?.('tick',{source:'mafia-clock',gain:.55,guard:()=>!disposed&&!suspended&&generation===epoch});
    },
    suspend(){suspended=true;generation++;},
    dispose(){disposed=true;generation++;},
  };
}
