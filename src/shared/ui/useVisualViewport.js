import { useEffect } from 'react';

// The keyboard changes the visible viewport without necessarily resizing dvh.
// Keep overlays inside that space, but let a user's pinch zoom pan naturally.
export function observeVisualViewport(target, {
  heightProperty = '--dialog-viewport-height',
  topProperty = '--dialog-viewport-top',
} = {}, environment = typeof window === 'undefined' ? undefined : window) {
  const viewport = environment?.visualViewport;
  if (!target?.style || !viewport) return () => {};
  const properties = [heightProperty, topProperty].filter(Boolean);
  const previous = properties.map(name => [name, target.style.getPropertyValue(name), target.style.getPropertyPriority(name)]);
  const requestFrame = environment.requestAnimationFrame.bind(environment);
  const cancelFrame = environment.cancelAnimationFrame.bind(environment);
  let frame = null;
  let active = true;
  const update = () => {
    frame = null;
    if (!active) return;
    const scale = Number(viewport.scale ?? 1);
    if (!Number.isFinite(scale) || Math.abs(scale - 1) > .001) return;
    const height = Number(viewport.height);
    const top = Number(viewport.offsetTop ?? 0);
    if (!Number.isFinite(height) || height <= 0 || !Number.isFinite(top)) return;
    for (const [name, value] of [[heightProperty, height], [topProperty, Math.max(0, top)]]) {
      if (name && target.style.getPropertyValue(name) !== `${value}px`) target.style.setProperty(name, `${value}px`);
    }
  };
  const schedule = () => { if (active && frame === null) frame = requestFrame(update); };
  update();
  viewport.addEventListener('resize', schedule);
  viewport.addEventListener('scroll', schedule);
  return () => {
    active = false;
    if (frame !== null) cancelFrame(frame);
    viewport.removeEventListener('resize', schedule);
    viewport.removeEventListener('scroll', schedule);
    for (const [name, value, priority] of previous) {
      if (value) target.style.setProperty(name, value, priority);
      else target.style.removeProperty(name);
    }
  };
}

export function useVisualViewport(targetOrRef, {
  heightProperty = '--dialog-viewport-height',
  topProperty = '--dialog-viewport-top',
} = {}) {
  useEffect(() => observeVisualViewport(targetOrRef?.current ?? targetOrRef, { heightProperty, topProperty }), [targetOrRef, heightProperty, topProperty]);
}
