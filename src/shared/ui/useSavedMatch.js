import { useEffect, useState } from 'react';
import { loadGameContent } from '../../data/game-content.js';
import { contentStorage } from '../lib/content-storage.js';
import { contentVersionFor } from '../content-locale.mjs';

// A change in Settings must not hide a resumable match. Validate each save with
// the bank it belongs to; gameplay continues to write to its original slot.
export function useSavedMatch(game, storage, locale, key, read) {
  const [current] = useState(() => read(storage, locale));
  const [other, setOther] = useState(null);
  useEffect(() => {
    if (current || !locale) return;
    const otherLocale = locale === 'ar' ? 'en' : 'ar';
    const slot = contentStorage(game, { contentLocale: otherLocale });
    if (!slot.get(key)) return;
    let active = true;
    loadGameContent(game, otherLocale, contentVersionFor(otherLocale)).then(() => {
      if (active) setOther(read(slot, otherLocale));
    }).catch(() => {});
    return () => { active = false; };
  }, [current, game, key, locale, read]);
  return current || other;
}
