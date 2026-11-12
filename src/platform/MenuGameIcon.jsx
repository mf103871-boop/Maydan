import React from 'react';
import { GameArtwork } from '../shared/brand/art.jsx';

// Menus and game headers share the approved Playful Studio artwork.
// The host controls size; GameArtwork preserves the original aspect ratio.
export function MenuGameIcon({ id, className = '' }) {
  return <span className={`menu-game-art ${className}`} aria-hidden="true"><GameArtwork game={id} /></span>;
}
