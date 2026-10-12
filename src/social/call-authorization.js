// Authorization is checked independently of LiveKit connectivity. A healthy
// media transport is not evidence that this account may still join the call.
export const CALL_AUTHORIZATION_GRACE_MS = 60_000;
const revoked = new Set(['NOT_FOUND', 'CALL_NOT_FOUND', 'CALL_UNAVAILABLE', 'CALL_FORBIDDEN', 'FORBIDDEN', 'BLOCKED',
  'AUTH_EXPIRED', 'AUTH_REQUIRED', 'ACCOUNT_SUSPENDED']);

export function createCallAuthorization({ now = Date.now } = {}) {
  let lastAuthorized = now(), failures = 0;
  const expired = () => failures >= 2 && now() - lastAuthorized >= CALL_AUTHORIZATION_GRACE_MS;
  return {
    expired,
    failure(error) {
      if (revoked.has(error?.code)) return 'authorization-revoked';
      failures++;
      return expired() ? 'authorization-timeout' : null;
    },
    response(call, userId, deviceId) {
      const own = call?.participants?.find(participant => participant.userId === userId);
      if (own?.deviceId && own.deviceId !== deviceId) return 'ownership-lost';
      if (!call || !['ringing', 'active'].includes(call.status)) return 'call-ended';
      if (!own || !['active', 'invited'].includes(own.state)) return 'authorization-revoked';
      lastAuthorized = now(); failures = 0;
      return null;
    },
  };
}
