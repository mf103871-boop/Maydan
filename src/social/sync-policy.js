// Realtime events carry updates immediately. These reads are a recovery net,
// not a second transport competing with the socket or native call watchdog.
export const LAMMA_POLL_MS = 15_000;
export const LAMMA_LIVE_POLL_MS = 60_000;
export const lammaPollDue = (lastRefreshAt, now, connected) => now - lastRefreshAt >= (connected ? LAMMA_LIVE_POLL_MS : LAMMA_POLL_MS);
export function refreshesLamma(event = {}) {
  if (['typing', 'pong'].includes(event.type)) return false;
  if (event.type === 'refresh' && event.reason === 'presence') return false;
  // Direct-message state belongs to SocialClient; a deletion still invalidates
  // private audio, but fetching every group/call/preference adds no information.
  if (event.type === 'message') return false;
  return true;
}
export function rechecksCall(event = {}, callId) {
  if (event.type === 'call') return !event.callId || event.callId === callId;
  if (event.type === 'refresh') return !['presence', 'read'].includes(event.reason);
  return event.type === 'group' && ['membership', 'removed', 'closed', 'deleted'].includes(event.reason);
}
