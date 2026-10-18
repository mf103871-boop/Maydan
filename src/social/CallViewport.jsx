import React, { useLayoutEffect } from 'react';
import callViewportCss from './call-viewport.css';

const owners = new Set();
let previousAttribute = null;

// Mark the shell for compact call-time controls without changing game width.
// Keeping the route wrapper mounted preserves matches and input drafts.
export function useCallDockLayout(active) {
  useLayoutEffect(() => {
    if (!active || typeof document === 'undefined') return undefined;
    const root = document.documentElement;
    const owner = Symbol('call-layout');
    if (!owners.size) previousAttribute = root.getAttribute('data-call-dock-active');
    owners.add(owner);
    root.setAttribute('data-call-dock-active', '');
    return () => {
      owners.delete(owner);
      if (!owners.size) {
        if (previousAttribute === null) root.removeAttribute('data-call-dock-active');
        else root.setAttribute('data-call-dock-active', previousAttribute);
        previousAttribute = null;
      }
    };
  }, [active]);
}

export function CallViewport({ children }) {
  return <><style>{callViewportCss}</style><div className="call-game-viewport" data-testid="call-game-viewport">{children}</div></>;
}
