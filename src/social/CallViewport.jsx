import React, { useLayoutEffect } from 'react';
import callViewportCss from './call-viewport.css';

const owners = new Set();
let previousAttribute = null;

// The space belongs to the whole call, not to its expanded/collapsed UI. Keeping
// the route wrapper mounted also keeps a match and its input drafts intact.
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
