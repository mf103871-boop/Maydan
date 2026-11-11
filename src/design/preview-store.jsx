// Studio-only adapter. Render the real Store, then exercise its real controls;
// there is no replacement UI, live request, checkout or fabricated DOM node.
import React, { useEffect, useRef } from 'react';
import { Store } from '../platform/screens/Store.jsx';

export function StoreDesignPreview({ openPreview = false }) {
  const host = useRef(null);
  useEffect(() => {
    let next;
    const first = requestAnimationFrame(() => {
      host.current?.querySelector('[data-design-id="store-tab-collections"]')?.click();
      if (openPreview) next = requestAnimationFrame(() => (host.current?.querySelector('[data-item-id="sahra.profileSkin"] [data-design-id="item-preview"]') || host.current?.querySelector('[data-design-id="item-preview"]'))?.click());
    });
    return () => { cancelAnimationFrame(first); if (next) cancelAnimationFrame(next); };
  }, [openPreview]);
  return <div ref={host}><Store /></div>;
}
