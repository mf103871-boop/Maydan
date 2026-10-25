// Opted-in simulator evidence only. The token is injected by the native shell
// for one process launch; ordinary web/iPhone builds never install it.
export function reportSimulatorHomeReady({ accountReady, gameCount, host = globalThis.window } = {}) {
  const token = host?.__maydanSimulatorLaunchToken;
  if (!accountReady || !Number.isInteger(gameCount) || gameCount < 1
      || typeof token !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(token)
      || typeof host?.webkit?.messageHandlers?.maydan?.postMessage !== 'function'
      || typeof host.requestAnimationFrame !== 'function') return undefined;
  let frame = 0, cancelled = false;
  const visible = node => {
    if (!node || node.hidden || node.closest('[hidden],[inert]')) return false;
    const rect = node.getBoundingClientRect();
    const style = host.getComputedStyle(node);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  };
  frame = host.requestAnimationFrame(() => {
    frame = host.requestAnimationFrame(() => {
      if (cancelled || host.__maydanSimulatorLaunchToken !== token || host.document.visibilityState !== 'visible') return;
      const home = host.document.querySelector('[data-design-screen="home"]');
      const navigation = host.document.querySelector('[data-testid="menu-navigation"]');
      const cards = [...(home?.querySelectorAll('button.game-card') || [])];
      // This effect is called only by the mounted Home component after the
      // splash and account initialization. A blank/error/recovery page cannot
      // produce this receipt merely by finishing its document navigation.
      if (!visible(home) || !visible(navigation) || cards.length !== gameCount
          || cards.some(card => card.disabled || !visible(card))) return;
      try {
        host.webkit.messageHandlers.maydan.postMessage({ type: 'simulatorGameReady', token,
          route: 'home', gameCardCount: cards.length, initialized: true });
      } catch { /* Missing diagnostics must fail the simulator gate, not the UI. */ }
    });
  });
  return () => { cancelled = true; host.cancelAnimationFrame(frame); };
}
