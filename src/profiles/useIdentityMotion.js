import { useEffect, useState } from 'react';

// Decorative motion starts static and runs only while its surface is visible.
export function useIdentityMotion(ref, enabled) {
  const [running, setRunning] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!enabled || !element || typeof document === 'undefined') return;
    let visible = false;
    const update = () => setRunning(visible && !document.hidden);
    const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting);
      update();
    }) : null;
    observer?.observe(element);
    document.addEventListener('visibilitychange', update);
    return () => { observer?.disconnect(); document.removeEventListener('visibilitychange', update); };
  }, [ref, enabled]);
  return enabled && running;
}
