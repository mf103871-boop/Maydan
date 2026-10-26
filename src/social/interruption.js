// Independent of routing: opening social UI must never unmount a match.
export function createSocialInterruption() {
  let state = { open: false, paused: false, local: false, privateTurn: false, online: false, turnDeadline: null, communicationLocked: false };
  const listeners = new Set();
  const privateOwners = new Set();
  const communicationOwners = new Set();
  const update = patch => {
    if (Object.entries(patch).every(([key, value]) => state[key] === value)) return;
    state = { ...state, ...patch }; for (const fn of [...listeners]) fn();
  };
  return {
    subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    getSnapshot: () => state,
    open: () => update({ open: true, paused: state.local || state.paused }),
    close: () => update({ open: false }),
    resume: () => { if (!state.open) update({ paused: false }); },
    setContext: patch => update({ ...patch, ...(patch.local === false ? { paused: false } : {}) }),
    lockCommunication: owner => { communicationOwners.add(owner); update({ communicationLocked: true, open: false }); return () => {
      communicationOwners.delete(owner); update({ communicationLocked: communicationOwners.size > 0 });
    }; },
    private: owner => { privateOwners.add(owner); update({ privateTurn: true }); return () => {
      privateOwners.delete(owner); update({ privateTurn: privateOwners.size > 0 });
    }; },
  };
}
export const socialInterruption = createSocialInterruption();
