import React, { useState } from 'react';
import { getCosmetic } from '../plus/catalog.js';

export function StickerMessage({ message }) {
  const [failed, setFailed] = useState(false);
  const item = getCosmetic(message.stickerId, { kind: 'sticker', now: Number.MAX_SAFE_INTEGER });
  if (!item || item.version !== message.stickerVersion || failed) return <p dir="auto">{message.text}</p>;
  return <figure className="social-sticker-message"><img src={item.assetUrl} width="144" height="144" alt={item.label} loading="lazy" decoding="async" onError={() => setFailed(true)} /><figcaption>{item.label}</figcaption></figure>;
}


// Kept as an inert compatibility export for older callers. New membership
// includes profile appearance and frames only; historical messages still render.
export function StickerPicker() { return null; }
