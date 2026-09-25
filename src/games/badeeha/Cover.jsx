import React, { useState } from 'react';
import { categoryCoverSource } from './covers.js';

function CoverImage({ src, icon }) {
  const [state, setState] = useState(src ? 'loading' : 'fallback');
  return (
    <span className="m-category-cover" data-state={state} aria-hidden="true">
      <span className="m-category-cover-fallback">{icon}</span>
      {src && state !== 'fallback' && (
        <img
          src={src} alt="" width="640" height="480" loading="lazy" decoding="async" draggable="false"
          onLoad={() => setState('ready')}
          onError={() => setState('fallback')}
        />
      )}
    </span>
  );
}

export function CategoryCover({ id, icon }) {
  const src = categoryCoverSource(id);
  return <CoverImage key={src || id} src={src} icon={icon} />;
}
