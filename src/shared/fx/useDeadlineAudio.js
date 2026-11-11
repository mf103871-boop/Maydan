import { useEffect, useRef } from 'react';
import { createDeadlineAudio } from './deadline-audio.js';
let candidateDeadlineSequence = 0;

export function useDeadlineAudio(sound, key, remaining, active, { warningOnly = false } = {}) {
  const controller = useRef(null);
  useEffect(() => {
    const audio = createDeadlineAudio(sound, { warningOnly }); controller.current = audio;
    const page = typeof document === 'undefined' ? null : document;
    const browser = typeof window === 'undefined' ? null : window;
    const suspend = () => audio.suspend();
    const visibility = () => { if (page?.hidden) suspend(); };
    page?.addEventListener('visibilitychange', visibility);
    browser?.addEventListener('pagehide', suspend);
    return () => {
      audio.dispose(); page?.removeEventListener('visibilitychange', visibility); browser?.removeEventListener('pagehide', suspend);
      if (controller.current === audio) controller.current = null;
    };
  }, [sound, warningOnly]);
  useEffect(() => { controller.current?.update(key, remaining, { active, hidden: typeof document === 'undefined' || document.hidden }); }, [sound, key, remaining, active, warningOnly]);
}

// Public countdowns only. Each game keeps its existing end-of-turn cue; the
// local audition adds one short clock warning and never replays missed ticks.
export function useCandidateDeadlineWarning(sound, key, remaining, active) {
  const instance = useRef(null);
  if (instance.current === null) instance.current = ++candidateDeadlineSequence;
  const turn = useRef({ key: null, sequence: 0 });
  if (turn.current.key !== key) turn.current = { key, sequence: turn.current.sequence + 1 };
  const candidate = sound?.localCandidateAudio === true;
  useDeadlineAudio(sound, candidate && key ? `candidate:${instance.current}:${turn.current.sequence}:${key}` : null, remaining, candidate && active, { warningOnly: true });
}
