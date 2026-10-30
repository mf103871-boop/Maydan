import { useEffect, useRef } from 'react';
import { createMafiaPhaseAudio, createMafiaPublicAudio } from './audio.js';

// Shared-bus ownership keeps PlatformApp's home track silent in Mafia without
// changing saved music preferences; nested entry/match/preview owners are safe.
export function useMafiaAmbience(sound, active = true) {
  const owner = useRef(Symbol('mafia-noir'));
  useEffect(() => {
    if (!active || !sound?.music) return undefined;
    const lease = owner.current;
    if (sound.music.scene) {
      sound.music.scene(lease, 'mafia', 'lobby', 20);
      return () => sound.music.releaseScene(lease);
    }
    sound.music.setSuppressed?.(true, lease);
    return () => sound.music.setSuppressed?.(false, lease);
  }, [sound, active]);
}

export function useMafiaSound(state, { hidden = false, preview = false, sound } = {}) {
  useMafiaAmbience(sound, !preview);
  const controller = useRef(null);
  const sceneOwner = useRef(Symbol('mafia-phase-audio'));
  useEffect(() => {
    if (!sound?.music?.scene) return;
    const owner = sceneOwner.current;
    if (preview) { sound.music.releaseScene(owner); return; }
    sound.music.scene(owner, 'mafia', state?.phase || 'lobby', 30);
  }, [sound, preview, state?.phase]);
  useEffect(() => {
    const owner = sceneOwner.current;
    return () => sound?.music?.releaseScene?.(owner);
  }, [sound]);
  useEffect(() => {
    const phases = createMafiaPhaseAudio(sound), events = createMafiaPublicAudio(sound);
    const audio = {
      update(value, options) { phases.update(value, options); events.update(value, options); },
      suspend() { phases.suspend(); events.suspend(); },
      dispose() { phases.dispose(); events.dispose(); },
    };
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
