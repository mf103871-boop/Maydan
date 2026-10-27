import { useEffect, useRef } from 'react';
import { createMafiaPhaseAudio } from './audio.js';

// Shared-bus ownership keeps PlatformApp's home track silent in Mafia without
// changing saved music preferences; nested entry/match/preview owners are safe.
export function useMafiaAmbience(sound, active = true) {
  const owner = useRef(Symbol('mafia-noir'));
  useEffect(() => {
    if (!active || !sound?.music?.setSuppressed) return undefined;
    const lease = owner.current;
    sound.music.setSuppressed(true, lease);
    return () => sound.music.setSuppressed(false, lease);
  }, [sound, active]);
}

export function useMafiaSound(state, { hidden = false, preview = false, sound } = {}) {
  useMafiaAmbience(sound, !preview);
  const controller = useRef(null);
  useEffect(() => {
    const audio = createMafiaPhaseAudio(sound);
    controller.current = audio;
    const hide = () => audio.suspend();
    const visibility = () => { if (document.hidden) hide(); };
    const native = event => {
      if (['background', 'interruption-began', 'media-reset'].includes(event.detail?.state)) hide();
    };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', hide);
    window.addEventListener('maydan-audio-lifecycle', native);
    return () => {
      audio.dispose();
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('maydan-audio-lifecycle', native);
      if (controller.current === audio) controller.current = null;
    };
  }, [sound]);
  // Runs after controller installation, including when the sound bus changes.
  useEffect(() => { controller.current?.update(state, { hidden, preview }); }, [state, hidden, preview, sound]);
}
