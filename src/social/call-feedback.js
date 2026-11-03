let sequence = 0;
// Explicit accepted user actions only, not snapshots, recovery, ringing lists,
// or private Mafia channel changes. Native CallKit owns its own call tones.
export function emitCallFeedback(sound, type, { isNative, current, privacy }) {
  if (!['call.connected', 'call.ended', 'call.muted', 'call.failed'].includes(type)) return false;
  const allowed = () => !isNative() && current() && !privacy().privateTurn && !privacy().communicationLocked;
  return allowed() ? sound?.emit?.(type, { id: `call-action:${++sequence}`, guard: allowed }) ?? false : false;
}
