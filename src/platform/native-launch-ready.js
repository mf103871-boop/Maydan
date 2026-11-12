// Opted-in simulator evidence only. The token is injected by the native shell
// for one process launch; ordinary web/iPhone builds never install it.
export function reportSimulatorHomeReady({ accountReady, gameCount, host = globalThis.window } = {}) {
  const token = host?.__maydanSimulatorLaunchToken;
  if (!accountReady || !Number.isInteger(gameCount) || gameCount < 1
      || typeof token !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(token)
      || typeof host?.webkit?.messageHandlers?.maydan?.postMessage !== 'function'
      || typeof host.requestAnimationFrame !== 'function' || typeof host.setTimeout !== 'function') return undefined;
  startSimulatorLocaleProbe(host);
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

// A finite simulator-only scenario uses the real Settings select and its normal
// React change handler. It never writes storage, imports a locale setter, supplies
// translated output, or acknowledges itself. Device shells inject no scenario.
export function startSimulatorLocaleProbe(host = globalThis.window) {
  const token = host?.__maydanSimulatorLaunchToken, scenario = host?.__maydanSimulatorLocaleScenario;
  if (!/^(set|retain)-(ar|en)$/.test(scenario || '')
      || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(token || '')
      || host.__maydanSimulatorLocaleStarted === token) return undefined;
  host.__maydanSimulatorLocaleStarted = token;
  const target = scenario.slice(-2), changing = scenario.startsWith('set-');
  let phase = 'ready', timer, frame, expiry, stopped = false, settingsLabel = null;
  const visible = node => {
    if (!node || node.hidden || node.closest('[hidden],[inert]')) return false;
    const rect = node.getBoundingClientRect(), style = host.getComputedStyle(node);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  };
  const stop = () => { stopped = true; host.clearTimeout(timer); host.clearTimeout(expiry); host.cancelAnimationFrame(frame); };
  const alive = () => {
    if (stopped || host.__maydanSimulatorLaunchToken !== token || host.__maydanSimulatorLocaleReady === token) { stop(); return false; }
    return true;
  };
  const sample = () => {
    if (!alive()) return;
    const doc = host.document;
    if (doc.visibilityState !== 'visible' || host.__maydanSimulatorLaunchReady !== token) return;
    if (phase === 'ready') {
      phase = changing ? 'settings' : 'home';
      if (changing) { host.location.hash = '#/settings'; return; }
    }
    if (phase === 'settings') {
      const select = doc.querySelector('#ui-locale');
      if (!visible(select) || select.disabled) return;
      select.value = target;
      select.dispatchEvent(new host.Event('change', { bubbles: true }));
      phase = 'changed'; return;
    }
    const root = doc.documentElement;
    if (root.lang !== target || root.dir !== (target === 'en' ? 'ltr' : 'rtl')) return;
    if (phase === 'changed') {
      const select = doc.querySelector('#ui-locale'), label = doc.querySelector('label[for="ui-locale"]');
      const home = doc.querySelector('[data-design-screen="settings"] [data-design-id="home"]');
      if (select?.value !== target || !visible(label) || !visible(home) || home.disabled) return;
      settingsLabel = label.textContent.trim();
      phase = 'home'; home.click(); return;
    }
    const home = doc.querySelector('[data-design-screen="home"]');
    const nav = doc.querySelector('[data-testid="menu-navigation"]');
    const cards = [...(home?.querySelectorAll('button.game-card') || [])];
    const links = [...(nav?.querySelectorAll('a.menu-navigation-item') || [])];
    if (!visible(home) || !visible(nav) || cards.length !== 8 || links.length !== 4
        || ![...cards, ...links].every(node => visible(node) && !node.disabled)) return;
    // These are observed strings and attributes, checked independently in Python.
    // Neither the probe nor the native writer substitutes an expected label.
    host.webkit.messageHandlers.maydan.postMessage({ type: 'simulatorLocaleReady', token, scenario,
      rendered: { lang: root.lang, dir: root.dir, homeDir: host.getComputedStyle(home).direction, navDir: host.getComputedStyle(nav).direction,
        settingsLabel, navigation: links.map(link => link.textContent.trim()),
        games: cards.map(card => ({ id: card.getAttribute('data-game'), label: card.querySelector('.name')?.textContent.trim() })) } });
  };
  const loop = () => {
    if (!alive()) return;
    frame = host.requestAnimationFrame(() => {
      if (!alive()) return;
      frame = host.requestAnimationFrame(() => {
        if (!alive()) return;
        try { sample(); } catch { /* A missing measurement fails CI; it must not crash the app. */ }
        if (alive()) timer = host.setTimeout(loop, 100);
      });
    });
  };
  expiry = host.setTimeout(stop, 20000);
  loop();
  return stop;
}
