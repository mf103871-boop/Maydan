// Studio-only adapter. Render the real Store, then exercise its real controls;
// there is no replacement UI, live request, checkout or fabricated DOM node.
import React, { useEffect, useRef } from 'react';
import { Store } from '../platform/screens/Store.jsx';

export function StoreDesignPreview({ openPreview = false }) {
  const host = useRef(null);
  useEffect(() => {
    let next, compare;
    const first = requestAnimationFrame(() => {
      host.current?.querySelector('[data-design-id="store-tab-collections"]')?.click();
      if (openPreview) next = requestAnimationFrame(() => {
        const item = host.current?.querySelector('[data-item-id="sahra.profileSkin"] button')
          || host.current?.querySelector('[data-item-id] button');
        item?.click();
        compare = requestAnimationFrame(() => host.current?.querySelector('.studio-store-links [data-design-id="item-preview"]')?.click());
      });
    });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(next); cancelAnimationFrame(compare); };
  }, [openPreview]);
  return <div ref={host}><Store /></div>;
}
