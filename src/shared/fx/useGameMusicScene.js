import { useEffect, useRef } from 'react';

// The mounted game owns its actual public phase, above the outer Play shell.
// A stale shell stage must not leave lobby music under speech or secret turns.
export function useGameMusicScene(sound, game, phase, suspended = false) {
  const owner = useRef(Symbol('game-phase-music'));
  useEffect(() => {
    const lease = owner.current;
    sound?.music?.scene?.(lease, game, suspended ? 'paused' : phase, 25);
    return () => sound?.music?.releaseScene?.(lease);
  }, [sound, game, phase, suspended]);
}
