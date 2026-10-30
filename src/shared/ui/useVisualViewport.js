import { useEffect } from 'react';

// The keyboard changes the visible viewport without necessarily resizing dvh.
// Keep overlays inside that space, but let a user's pinch zoom pan naturally.
export function observeVisualViewport(target, {
  heightProperty = '--dialog-viewport-height',
  topProperty = '--dialog-viewport-top',
  relativeToTarget = false,
} = {}, environment = typeof window === 'undefined' ? undefined : window) {
  const viewport = environment?.visualViewport;
  if (!target?.style || (!viewport && !relativeToTarget)) return () => {};
  const properties = [heightProperty, topProperty].filter(Boolean);
  const previous = properties.map(name => [name, target.style.getPropertyValue(name), target.style.getPropertyPriority(name)]);
  const requestFrame = environment.requestAnimationFrame.bind(environment);
  const cancelFrame = environment.cancelAnimationFrame.bind(environment);
  let frame = null;
  let active = true;
  const update = () => {
    frame = null;
    if (!active) return;
    const scale = Number(viewport?.scale ?? 1);
    if (!Number.isFinite(scale) || Math.abs(scale - 1) > .001) return;
    let height = Number(viewport?.height ?? environment?.innerHeight);
    let top = Number(viewport?.offsetTop ?? 0);
    if (!Number.isFinite(height) || height <= 0 || !Number.isFinite(top)) return;
    if (relativeToTarget) {
      const bottom = top + height;
      const style = element => environment.getComputedStyle?.(element);
      const pixels = value => parseFloat(value) || 0;
      const own = style(target);
      top = Math.max(top, target.getBoundingClientRect().top + pixels(own?.paddingTop) + pixels(own?.borderTopWidth));
      let reserved = pixels(own?.paddingBottom) + pixels(own?.borderBottomWidth) + pixels(own?.marginBottom);
      for (let node = target.parentElement; node; node = node.parentElement) {
        const computed = style(node);
        reserved += pixels(computed?.paddingBottom) + pixels(computed?.borderBottomWidth) + pixels(computed?.marginBottom);
      }
      height = Math.max(0, bottom - top - reserved);
    }
    for (const [name, value] of [[heightProperty, height], [topProperty, Math.max(0, top)]]) {
      if (name && target.style.getPropertyValue(name) !== `${value}px`) target.style.setProperty(name, `${value}px`);
    }
  };
  const schedule = () => { if (active && frame === null) frame = requestFrame(update); };
  let resize, mutation;
  if (relativeToTarget) {
    // A wrapping banner can move the page without resizing visualViewport.
    // Observe the flow ancestors and their siblings, never a hardcoded header.
    const observeFlow = () => {
      resize?.disconnect();
      for (let node = target; node; node = node.parentElement) {
        resize?.observe(node);
        for (const sibling of node.parentElement?.children || []) if (sibling !== node) resize?.observe(sibling);
      }
    };
    if (environment.ResizeObserver) resize = new environment.ResizeObserver(schedule);
    if (environment.MutationObserver) {
      mutation = new environment.MutationObserver(() => { observeFlow(); schedule(); });
      for (let node = target.parentElement; node; node = node.parentElement) mutation.observe(node, { childList: true, attributes: true, attributeFilter: ['style', 'class'] });
    }
    observeFlow();
    environment.addEventListener?.('resize', schedule);
    environment.addEventListener?.('scroll', schedule, true);
  }
  update();
  viewport?.addEventListener('resize', schedule);
  viewport?.addEventListener('scroll', schedule);
  return () => {
    active = false;
    if (frame !== null) cancelFrame(frame);
    viewport?.removeEventListener('resize', schedule);
    viewport?.removeEventListener('scroll', schedule);
    resize?.disconnect(); mutation?.disconnect();
    if (relativeToTarget) { environment.removeEventListener?.('resize', schedule); environment.removeEventListener?.('scroll', schedule, true); }
    for (const [name, value, priority] of previous) {
      if (value) target.style.setProperty(name, value, priority);
      else target.style.removeProperty(name);
    }
  };
}

export function useVisualViewport(targetOrRef, {
  heightProperty = '--dialog-viewport-height',
  topProperty = '--dialog-viewport-top',
  relativeToTarget = false,
} = {}) {
  useEffect(() => observeVisualViewport(targetOrRef?.current ?? targetOrRef, { heightProperty, topProperty, relativeToTarget }), [targetOrRef, heightProperty, topProperty, relativeToTarget]);
}
