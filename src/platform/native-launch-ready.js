// Opted-in simulator evidence only. The token is injected by the native shell
// for one process launch; ordinary web/iPhone builds never install it.
export function reportSimulatorHomeReady({ accountReady, gameCount, host = globalThis.window } = {}) {
  const token = host?.__maydanSimulatorLaunchToken;
  if (!accountReady || !Number.isInteger(gameCount) || gameCount < 1
      || typeof token !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(token)
      || typeof host?.webkit?.messageHandlers?.maydan?.postMessage !== 'function'
      || typeof host.requestAnimationFrame !== 'function' || typeof host.setTimeout !== 'function') return undefined;
  const now = () => host.performance?.now?.() ?? Date.now(), deadline = now() + 10000;
  let frame = 0, retry = 0, expiry = 0, cancelled = false;
  const stop = () => {
    cancelled = true;
    host.cancelAnimationFrame(frame); host.clearTimeout(retry); host.clearTimeout(expiry);
  };
  const active = () => {
    if (cancelled || host.__maydanSimulatorLaunchToken !== token
        || host.__maydanSimulatorLaunchReady === token || now() >= deadline) { stop(); return false; }
    return true;
  };
  const visible = node => {
    if (!node || node.hidden || node.closest('[hidden],[inert]')) return false;
    const rect = node.getBoundingClientRect();
    const style = host.getComputedStyle(node);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  };
  const measure = () => {
    if (!active()) return;
    frame = host.requestAnimationFrame(() => { if (active()) frame = host.requestAnimationFrame(() => {
      if (!active()) return;
      const home = host.document.querySelector('[data-design-screen="home"]');
      const navigation = host.document.querySelector('[data-testid="menu-navigation"]');
      const cards = [...(home?.querySelectorAll('button.game-card') || [])];
      // This effect is called only by the mounted Home component after the
      // splash and account initialization. A blank/error/recovery page cannot
      // produce this receipt merely by finishing its document navigation.
      if (host.document.visibilityState === 'visible' && visible(home) && visible(navigation)
          && cards.length === gameCount && cards.every(card => !card.disabled && visible(card))) {
        try {
          host.webkit.messageHandlers.maydan.postMessage({ type: 'simulatorGameReady', token,
            route: 'home', gameCardCount: cards.length, initialized: true });
        } catch { /* Missing diagnostics must fail the simulator gate, not the UI. */ }
      }
      // A transient hidden view or a native migration still committing must
      // not permanently lose the signal. Re-measure; never infer readiness.
      if (active()) retry = host.setTimeout(measure, 100);
    }); });
  };
  expiry = host.setTimeout(stop, 10000);
  measure();
  return stop;
}
