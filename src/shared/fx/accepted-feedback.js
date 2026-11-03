import { useLayoutEffect, useRef } from 'react';
import { usePlatform } from '../../platform/context.js';

// Opaque, module-wide event IDs cannot expose the owner, receipt, image or code,
// or collide when different screens each perform their first accepted action.
let sequence = 0;
export function createAcceptedFeedback() {
  let owner, sound, mounted = false, generation = 0;
  return {
    bind(nextOwner, nextSound) {
      if (nextOwner !== owner || nextSound !== sound) generation++;
      owner = nextOwner; sound = nextSound;
    },
    mount() { mounted = true; },
    dispose() { mounted = false; generation++; },
    begin() {
      const epoch = ++generation;
      let consumed = false;
      const current = () => mounted && epoch === generation;
      const emit = type => {
        if (consumed || !current()) return false;
        consumed = true;
        return sound?.emit?.(type, { id: `accepted:${++sequence}`, guard: current }) ?? false;
      };
      return {
        current,
        confirm: () => emit('ui.confirm'),
        error: error => {
          const code = error?.code;
          if (error?.name === 'AbortError' || ['STALE','STALE_ACCOUNT','PURCHASE_CANCELLED','PURCHASE_PENDING','ACTIVATION_PENDING'].includes(code)) return false;
          return emit('ui.error');
        },
      };
    },
  };
}

export function useAcceptedFeedback(owner) {
  const platform = usePlatform();
  const controller = useRef(null);
  if (!controller.current) controller.current = createAcceptedFeedback();
  const feedback = controller.current;
  feedback.bind(owner, platform?.sound);
  useLayoutEffect(() => { feedback.mount(); return () => feedback.dispose(); }, [feedback]);
  return feedback;
}
