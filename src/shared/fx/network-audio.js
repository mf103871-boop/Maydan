// Browser connectivity is not proof of a reachable game server. These are quiet
// device-link notices, outside matches/calls only, never a reconnect substitute.
export function bindNetworkAudio(sound, { target = window, documentTarget = document, navigatorTarget = navigator,
  available = () => true, schedule = setTimeout, cancel = clearTimeout } = {}) {
  let previous = navigatorTarget.onLine !== false, generation = 0, disposed = false, timer = null, sequence = 0;
  let announced = previous;
  const cancelPending = () => { generation++; if (timer !== null) { cancel(timer); timer = null; } };
  const change = () => {
    const online = navigatorTarget.onLine !== false;
    if (online === previous) return;
    previous = online; cancelPending();
    if (documentTarget.hidden || !available()) { announced = online; return; }
    const epoch = generation;
    timer = schedule(() => {
      timer = null;
      if (disposed || epoch !== generation || documentTarget.hidden || !available() || online !== (navigatorTarget.onLine !== false) || online === announced) return;
      announced = online;
      sound?.emit?.(online ? 'network.online' : 'network.offline', { id: `network:${++sequence}`,
        guard: () => !disposed && epoch === generation && !documentTarget.hidden && available() });
    }, 1200);
  };
  const hide = () => { if (documentTarget.hidden) cancelPending(); announced = previous = navigatorTarget.onLine !== false; };
  target.addEventListener('online', change); target.addEventListener('offline', change); documentTarget.addEventListener('visibilitychange', hide);
  return () => { disposed = true; cancelPending(); target.removeEventListener('online', change); target.removeEventListener('offline', change); documentTarget.removeEventListener('visibilitychange', hide); };
}
